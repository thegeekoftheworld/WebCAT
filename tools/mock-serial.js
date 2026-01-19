/*
 * WebCAT mock serial provider for replaying recorded sessions in-browser.
 * Activate by loading this script and adding ?mockSession=relative/path/to/session.json
 */
(function (global) {
  if (typeof window === 'undefined') return;

  function hexToU8(hex) {
    const clean = String(hex || '').trim();
    if (!clean) return new Uint8Array();
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      out[i / 2] = parseInt(clean.slice(i, i + 2), 16) & 0xFF;
    }
    return out;
  }

  function u8ToHex(u8) {
    return Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class QueueReader {
    constructor() {
      this.queue = [];
      this.waiters = [];
      this.canceled = false;
    }
    push(u8) {
      if (this.canceled) return;
      if (this.waiters.length) {
        const next = this.waiters.shift();
        next({ value: u8, done: false });
      } else {
        this.queue.push(u8);
      }
    }
    async read() {
      if (this.queue.length) return { value: this.queue.shift(), done: false };
      if (this.canceled) return { value: undefined, done: true };
      return new Promise((resolve) => this.waiters.push(resolve));
    }
    async cancel() {
      this.canceled = true;
      while (this.waiters.length) {
        const w = this.waiters.shift();
        w({ value: undefined, done: true });
      }
    }
    releaseLock() {}
  }

  class MockSerialPort {
    constructor(session, opts = {}) {
      this.session = session || { frames: [], meta: {} };
      this.opts = { realtime: false, speed: 8, validateOut: false, ...opts };
      this.reader = new QueueReader();
      this.writer = {
        async write(u8) {
          this.written.push(u8ToHex(u8));
          if (this.opts.validateOut) this._validateOut(u8);
        },
        releaseLock() {}
      };
      this.written = [];
      this.opened = false;
      this.closed = false;
      this._playTask = null;
      this._outIdx = 0;
    }

    get readable() { return { getReader: () => this.reader }; }
    get writable() { return { getWriter: () => this.writer }; }

    async open({ baudRate } = {}) {
      this.baudRate = baudRate;
      this.opened = true;
      this.closed = false;
      this._startPlayback();
    }

    async close() {
      this.closed = true;
      if (this.reader) await this.reader.cancel();
    }

    async setSignals() {}
    getInfo() { return { mock: true, driverId: this.session?.meta?.driverId || 'mock' }; }

    _startPlayback() {
      const frames = Array.isArray(this.session.frames) ? this.session.frames : [];
      const inFrames = frames.filter((f) => f.dir === 'in');
      const realtime = this.opts.realtime;
      const speed = Number(this.opts.speed) || 1;

      let lastT = inFrames.length ? inFrames[0].t : null;
      const enqueueFrame = async (frame) => {
        const u8 = hexToU8(frame.data);
        this.reader.push(u8);
      };

      this._playTask = (async () => {
        for (const f of inFrames) {
          if (this.closed) break;
          if (lastT != null && realtime) {
            const dt = Math.max(0, (f.t - lastT) / speed);
            if (dt) await sleep(dt);
          }
          await enqueueFrame(f);
          lastT = f.t;
        }
        // Signal end-of-stream to consumers so read loops can exit cleanly
        try {
          if (!this.closed && this.reader) await this.reader.cancel();
        } catch {}
      })();
    }

    _validateOut(u8) {
      const frames = Array.isArray(this.session.frames) ? this.session.frames : [];
      while (this._outIdx < frames.length && frames[this._outIdx].dir !== 'out') this._outIdx++;
      const expect = frames[this._outIdx];
      if (!expect) return;
      const got = u8ToHex(u8);
      if (got !== expect.data) {
        console.warn('MockSerial: outbound mismatch', { expected: expect.data, got });
      }
      this._outIdx++;
    }
  }

  class MockSerialProvider {
    constructor(session, opts = {}) {
      this.session = session;
      this.opts = opts;
      this.port = new MockSerialPort(session, opts);
    }
    async requestPort() { 
      console.log('[WebCAT Mock] requestPort() called - returning mock port');
      return this.port; 
    }
    async getPorts() { 
      console.log('[WebCAT Mock] getPorts() called - returning mock port');
      return [this.port]; 
    }
  }

  async function installFromUrl(url, opts = {}) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load mock session: ${url}`);
    const session = await res.json();
    return install(session, opts);
  }

  function install(session, opts = {}) {
    const provider = new MockSerialProvider(session, opts);
    if (!global.navigator) global.navigator = {};
    global.navigator.serial = provider;
    global.__WEB_CAT_MOCK__ = { session, provider };
    console.log('[WebCAT] Mock serial installed', session?.meta || {});
    return provider;
  }

  // Auto-bootstrap if query param present (runs immediately, synchronously if possible)
  (function bootstrap() {
    try {
      const qs = new URLSearchParams(global.location ? global.location.search : '');
      const sessionUrl = qs.get('mockSession') || qs.get('mock');
      if (!sessionUrl) return;
      
      const realtime = qs.get('mockRealtime') === '1';
      const speed = qs.get('mockSpeed') ? Number(qs.get('mockSpeed')) : 8;
      
      // Pre-install a placeholder that will load async
      const provider = new MockSerialProvider({ frames: [], meta: { driverId: 'pending' } }, { realtime, speed });
      if (!global.navigator) global.navigator = {};
      global.navigator.serial = provider;
      global.__WEB_CAT_MOCK__ = { session: null, provider, loading: true };
      
      // Load session async and update
      fetch(sessionUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${sessionUrl}`);
          return res.json();
        })
        .then((session) => {
          provider.session = session;
          provider.port.session = session;
          global.__WEB_CAT_MOCK__.session = session;
          global.__WEB_CAT_MOCK__.loading = false;
          global.__TEST_MOCK_INSTALLED__ = true;
          console.log('[WebCAT] Mock serial loaded:', session.meta);
        })
        .catch((e) => {
          console.error('[WebCAT] Mock serial load failed:', e);
          global.__WEB_CAT_MOCK__.error = e;
          global.__WEB_CAT_MOCK__.loading = false;
          global.__TEST_MOCK_INSTALLED__ = false;
        });
    } catch (e) {
      console.error('[WebCAT] Mock serial bootstrap failed', e);
    }
  })();

  global.MockSerial = { install, installFromUrl, MockSerialPort, MockSerialProvider };
})(typeof window !== 'undefined' ? window : globalThis);
