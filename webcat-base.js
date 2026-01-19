/*
  WebCAT Base Library
  - WebSerial controller + driver registry
  - Drivers are loaded as separate JS files and registered via WebCAT.registerDriver()

  UMD-style global: window.WebCAT
*/
(function (global) {
  'use strict';

  const WebCAT = global.WebCAT || {};

  WebCAT.version = '0.2.0';

  // ---------- Utilities ----------
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function hex2(n) { return (n & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }
  function bytesToHex(u8) { return Array.from(u8).map(hex2).join(' '); }
  function parseHexByte(s) {
    const t = String(s || '').trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{1,2}$/.test(t)) throw new Error(`Bad hex byte: ${s}`);
    return parseInt(t, 16) & 0xFF;
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function interp1D(x, points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const pts = points.slice().sort((p, q) => p.x - q.x);
    if (x <= pts[0].x) return pts[0].y;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      if (x <= p1.x) {
        const t = (x - p0.x) / (p1.x - p0.x);
        return lerp(p0.y, p1.y, t);
      }
    }
    return pts[pts.length - 1].y;
  }

  // Common baud list convenience
  WebCAT.COMMON_BAUDS = [4800, 9600, 19200, 38400, 57600, 115200];

  // ---------- Storage helper ----------
  class SettingsStore {
    constructor(namespace = 'radio_serial') {
      this.ns = namespace;
      this.keyUI = `${namespace}:ui`;
      this.keyPort = `${namespace}:port`;
    }
    loadUI() {
      try {
        const raw = localStorage.getItem(this.keyUI);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
    saveUI(patch) {
      const cur = this.loadUI() || {};
      const next = { ...cur, ...patch, savedAt: Date.now() };
      localStorage.setItem(this.keyUI, JSON.stringify(next));
      return next;
    }
    clearAll() {
      localStorage.removeItem(this.keyUI);
      localStorage.removeItem(this.keyPort);
    }
    savePortHint(info) {
      const hint = {
        usbVendorId: info?.usbVendorId ?? null,
        usbProductId: info?.usbProductId ?? null,
        savedAt: Date.now(),
      };
      localStorage.setItem(this.keyPort, JSON.stringify(hint));
    }
    loadPortHint() {
      try {
        const raw = localStorage.getItem(this.keyPort);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }
  }

  // ---------- Driver registry ----------
  const _drivers = new Map();

  /**
   * Register a driver.
   * @param {string} id unique id (e.g. "icom.ic9700")
   * @param {function} factory function(options) -> driver instance
   * @param {object} meta metadata (label, defaultBaud, allowedBauds, needsAddr, etc.)
   */
  function registerDriver(id, factory, meta = {}) {
    if (!id || typeof id !== 'string') throw new Error('driver id must be a string');
    if (typeof factory !== 'function') throw new Error('driver factory must be a function');
    _drivers.set(id, { id, factory, meta: { ...meta } });
  }

  function listDrivers() {
    return Array.from(_drivers.values()).map(d => ({ id: d.id, ...d.meta }));
  }

  function getDriverMeta(id) {
    return _drivers.get(id)?.meta || null;
  }

  function createDriver(id, options = {}) {
    const entry = _drivers.get(id);
    if (!entry) throw new Error(`Unknown driver: ${id}`);
    return entry.factory(options);
  }

  // ---------- RadioController ----------
  class RadioController {
    /**
     * @param {object} opts
     * @param {string} opts.driverId
     * @param {object} [opts.driverOptions]
     * @param {SettingsStore} [opts.store]
     */
    constructor({ driverId, driverOptions = {}, store = new SettingsStore() }) {
      this.store = store;
      this.driverId = driverId;
      this.driverOptions = driverOptions;
      this.driver = createDriver(driverId, driverOptions);

      this.port = null;
      this.reader = null;
      this.writer = null;

      this.rxBuf = [];
      this.running = false;
      this.writeLock = Promise.resolve();

      this.polling = false;
      this.pollTask = null;
      this._pollRunId = 0;
      this._pollStopLogged = false;
      this.pollIntervalMs = 250;

      this.ctx = { lastFreqHz: null };

      this.state = {
        connected: false,
        ptt: null,
        freqHz: null,
        mode: null,
        smeterRaw: null,
        swr: null,
        po: null,
        rfpwr: null,
        vd: null,
        id: null,
        extras: {},
      };

      this._listeners = new Map();
    }

    _ensureConnected() {
      // "Connected" means we have an open port and an active writer.
      if (!this.state.connected || !this.port || !this.writer) {
        throw new Error('Not connected');
      }
    }

    // --- eventing ---
    on(evt, fn) {
      if (!this._listeners.has(evt)) this._listeners.set(evt, []);
      this._listeners.get(evt).push(fn);
      return () => this.off(evt, fn);
    }
    off(evt, fn) {
      const arr = this._listeners.get(evt) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    _emit(evt, payload) {
      const arr = this._listeners.get(evt) || [];
      for (const fn of arr) {
        try { fn(payload); } catch (e) { console.error(e); }
      }
    }

    static portInfo(port) {
      try { return port.getInfo ? port.getInfo() : {}; } catch { return {}; }
    }

    async connectWithPicker({ baudRate, rememberPort = true } = {}) {
      if (!('serial' in navigator)) throw new Error('WebSerial not supported');
      const port = await navigator.serial.requestPort();
      await this._connectInternal({ port, baudRate, rememberPort });
    }

    async connectRemembered({ baudRate } = {}) {
      if (!('serial' in navigator)) throw new Error('WebSerial not supported');
      const hint = this.store.loadPortHint();
      if (!hint) throw new Error('No remembered port');

      const ports = await navigator.serial.getPorts();
      if (!ports.length) throw new Error('No authorized ports');

      let selected = null;
      for (const p of ports) {
        const info = RadioController.portInfo(p);
        if (info && info.usbVendorId === hint.usbVendorId && info.usbProductId === hint.usbProductId) {
          selected = p;
          break;
        }
      }
      if (!selected && ports.length === 1) selected = ports[0];
      if (!selected) throw new Error('Could not match remembered port; use picker');

      await this._connectInternal({ port: selected, baudRate, rememberPort: true });
    }

    async _connectInternal({ port, baudRate, rememberPort }) {
      await this.disconnect().catch(() => {});

      this.port = port;
      this.driver = createDriver(this.driverId, this.driverOptions); // fresh driver per connect

      const meta = getDriverMeta(this.driverId) || {};
      const defaultBaud = meta.defaultBaud || 9600;
      const br = Number.isFinite(baudRate) ? baudRate : defaultBaud;

      const opt = (typeof this.driver.serialOptions === 'function')
        ? this.driver.serialOptions()
        : { dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' };

      await this.port.open({
        baudRate: br,
        dataBits: opt.dataBits ?? 8,
        stopBits: opt.stopBits ?? 1,
        parity: opt.parity ?? 'none',
        flowControl: opt.flowControl ?? 'none',
        bufferSize: 4096,
      });

      // Safety: drop RTS/DTR to avoid accidental PTT for some cables.
      try { await this.port.setSignals({ requestToSend: false, dataTerminalReady: false, break: false }); } catch {}

      this.writer = this.port.writable.getWriter();
      this.reader = this.port.readable.getReader();
      this.running = true;

      this.state.connected = true;
      this._emit('connected', { baudRate: br, driverId: this.driverId });

      if (rememberPort) {
        const info = RadioController.portInfo(this.port);
        if (info && (info.usbVendorId || info.usbProductId)) this.store.savePortHint(info);
      }

      this._readLoop().catch(err => {
        this._emit('error', err);
        this.running = false;
      });
    }

    async disconnect() {
      // best effort unkey
      try {
        // Only attempt to unkey if we still have an active writer.
        if (this.state.connected && this.writer && typeof this.driver?.cmdSetPTT === 'function') {
          await this.setPTT(false);
        }
      } catch {}

      this.stopPolling();
      this.running = false;

      try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch {}
      try { if (this.writer) { this.writer.releaseLock(); } } catch {}
      try { if (this.port) { await this.port.close(); } } catch {}

      this.port = null;
      this.reader = null;
      this.writer = null;
      this.rxBuf = [];

      // Clear driver + context so future calls fail fast with "Not connected".
      this.driver = null;
      this.ctx = { lastFreqHz: null };
      this.writeLock = Promise.resolve();

      // Reset state (keep object shape)
      this.state = {
        connected: false,
        ptt: null,
        freqHz: null,
        mode: null,
        smeterRaw: null,
        swr: null,
        po: null,
        rfpwr: null,
        vd: null,
        id: null,
        extras: {},
      };
      this._emit('disconnected', null);
    }

    async send(u8) {
      this.writeLock = this.writeLock.then(async () => {
        this._ensureConnected();

        try { if (typeof this.driver.onCommandSent === 'function') this.driver.onCommandSent(u8, this.ctx); } catch {}

        await this.writer.write(u8);

        if (typeof this.driver.formatTx === 'function') this._emit('log', this.driver.formatTx(u8));
        else this._emit('log', `TX: ${bytesToHex(u8)}`);
      });
      return this.writeLock;
    }

    async _readLoop() {
      this._emit('log', 'Read loop started');
      while (this.running && this.reader) {
        const { value, done } = await this.reader.read();
        if (!this.running) break;
        if (done) break;
        if (!value || !value.length) continue;

        for (const b of value) this.rxBuf.push(b);

        if (!this.driver) break;
        const frames = this.driver.extractFrames(this.rxBuf, this.ctx);
        for (const f of frames) {
          // Drivers can return Uint8Array or {bytes, exp,...}
          const bytes = (f instanceof Uint8Array) ? f : (f && f.bytes instanceof Uint8Array ? f.bytes : null);
          if (!bytes) continue;

          if (typeof this.driver.formatRx === 'function') this._emit('log', this.driver.formatRx(bytes));
          else this._emit('log', `RX: ${bytesToHex(bytes)}`);

          const events = (this.driver.parseFrame.length >= 2)
            ? this.driver.parseFrame(f, this.ctx)
            : this.driver.parseFrame(bytes);

          if (Array.isArray(events)) {
            for (const ev of events) this._applyEvent(ev);
          }
        }
      }
      this._emit('log', 'Read loop ended');
    }

    _applyEvent(ev) {
      if (!ev || typeof ev !== 'object') return;

      if (ev.type === 'ptt') this.state.ptt = !!ev.isTx;

      if (ev.type === 'freq') {
        this.state.freqHz = ev.hz;
        this.ctx.lastFreqHz = ev.hz;
      }

      if (ev.type === 'mode') this.state.mode = ev.modeText;

      if (ev.type === 'smeter') this.state.smeterRaw = ev.raw;

      if (ev.type === 'swr') this.state.swr = ev;

      if (ev.type === 'po' || ev.type === 'po_w') this.state.po = ev;

      if (ev.type === 'rfpwr_setting' || ev.type === 'rfpwr_setting_w') this.state.rfpwr = ev;

      if (ev.type === 'vd') this.state.vd = ev;
      if (ev.type === 'id') this.state.id = ev;

      if (ev.type === 'extra') {
        this.state.extras = { ...this.state.extras, ...(ev.data || {}) };
      }

      this._emit('update', { ...this.state });
    }

    startPolling(intervalMs) {
      this._ensureConnected();

      // Always update interval; never create a second polling loop.
      this.pollIntervalMs = clamp(Number(intervalMs) || this.pollIntervalMs, 20, 10000);

      if (this.polling) {
        this._emit('log', `Polling interval updated -> ~${this.pollIntervalMs}ms`);
        return;
      }

      this.polling = true;
      this._pollStopLogged = false;
      const runId = ++this._pollRunId;

      const perCmdDelay = clamp(this.driver.interCommandDelayMs || 0, 0, 250);

      this.pollTask = (async () => {
        this._emit('log', `Polling started @ ~${this.pollIntervalMs}ms (id=${runId})`);
        try {
          while (this.polling && this._pollRunId === runId) {
            if (!this.state.connected || !this.writer || !this.driver) break;

            const t0 = performance.now();
            const seq = (typeof this.driver?.pollSequence === 'function') ? this.driver.pollSequence(this.ctx) : [];

            for (const cmd of seq) {
              if (!this.polling || this._pollRunId !== runId) break;
              try {
                await this.send(cmd);
              } catch (e) {
                // Connection lost mid-poll. Stop cleanly.
                this.polling = false;
                this._emit('error', e);
                break;
              }
              if (perCmdDelay) await sleep(perCmdDelay);
            }

            const dt = performance.now() - t0;
            await sleep(Math.max(0, this.pollIntervalMs - dt));
          }
        } finally {
          // Only log once; stopPolling() also logs.
          if (!this._pollStopLogged) {
            this._pollStopLogged = true;
            this._emit('log', 'Polling stopped');
          }
        }
      })();
    }

    stopPolling() {
      // Idempotent stop; invalidate any running loop by bumping run id.
      if (!this.polling) return;
      this.polling = false;
      this._pollRunId++;
      this.pollTask = null;

      if (!this._pollStopLogged) {
        this._pollStopLogged = true;
        this._emit('log', 'Polling stopped');
      }
    }


    async _withPollingPaused(fn) {
      const was = this.polling;
      const ms = this.pollIntervalMs;
      if (was) this.stopPolling();
      try { return await fn(); }
      finally {
        if (was && this.state.connected && this.writer) {
          try { this.startPolling(ms); } catch {}
        }
      }
    }

    async setFrequencyHz(hz) {
      this._ensureConnected();
      if (typeof this.driver.cmdSetFreqHz !== 'function') throw new Error('Driver does not support setFrequencyHz');
      await this._withPollingPaused(async () => {
        await this.send(this.driver.cmdSetFreqHz(hz, this.ctx));
        if (typeof this.driver.cmdReadFreq === 'function') await this.send(this.driver.cmdReadFreq());
        if (typeof this.driver.cmdReadFreqMode === 'function') await this.send(this.driver.cmdReadFreqMode());
      });
    }

    async setFrequencyMHz(mhz) {
      const hz = Math.round(Number(mhz) * 1e6);
      await this.setFrequencyHz(hz);
    }

    async setMode(modeName) {
      this._ensureConnected();
      if (typeof this.driver.cmdSetMode !== 'function') throw new Error('Driver does not support setMode');
      await this._withPollingPaused(async () => {
        await this.send(this.driver.cmdSetMode(modeName, this.ctx));
        if (typeof this.driver.cmdReadMode === 'function') await this.send(this.driver.cmdReadMode());
        if (typeof this.driver.cmdReadFreqMode === 'function') await this.send(this.driver.cmdReadFreqMode());
      });
    }

    async setPTT(on) {
      this._ensureConnected();
      if (typeof this.driver.cmdSetPTT !== 'function') throw new Error('Driver does not support setPTT');
      await this._withPollingPaused(async () => {
        await this.send(this.driver.cmdSetPTT(!!on, this.ctx));
        if (typeof this.driver.cmdReadRxTxStatus === 'function') await this.send(this.driver.cmdReadRxTxStatus());
        if (typeof this.driver.cmdReadTxStatus === 'function') await this.send(this.driver.cmdReadTxStatus());
      });
    }
  }

  // ---------- Public API ----------
  WebCAT.utils = { clamp, hex2, bytesToHex, parseHexByte, sleep, lerp, interp1D };
  WebCAT.SettingsStore = SettingsStore;

  WebCAT.registerDriver = registerDriver;
  WebCAT.listDrivers = listDrivers;
  WebCAT.getDriverMeta = getDriverMeta;
  WebCAT.createDriver = createDriver;
  WebCAT.RadioController = RadioController;

  global.WebCAT = WebCAT;

  // Back-compat alias (optional): allow older pages to keep using window.RadioSerial
  if (!global.RadioSerial) global.RadioSerial = global.WebCAT;

})(typeof window !== 'undefined' ? window : globalThis);
