/* FT-991A driver add-on for WebCAT (ASCII CAT) */
(function (global) {
  'use strict';
  const WebCAT = global.WebCAT;
  if (!WebCAT) throw new Error('webcat-base.js must be loaded first');

  const { clamp, interp1D } = WebCAT.utils;

  const te = new TextEncoder();
  const td = new TextDecoder('ascii', { fatal: false });

  function maxWattsFromHz(hz) {
    if (!Number.isFinite(hz)) return 100;
    const mhz = hz / 1e6;
    if (mhz >= 144 && mhz <= 148) return 50;
    if (mhz >= 420 && mhz <= 450) return 50;
    if (mhz >= 50 && mhz <= 54) return 100;
    return 100;
  }

  // FT-991A supports HF (160m-10m) + VHF/UHF (6m, 2m, 70cm)
  const BANDS = [
    { name: '160m', min: 1800000, max: 2000000 },
    { name: '80m', min: 3500000, max: 4000000 },
    { name: '60m', min: 5330000, max: 5403500 },
    { name: '40m', min: 7000000, max: 7300000 },
    { name: '30m', min: 10100000, max: 10150000 },
    { name: '20m', min: 14000000, max: 14350000 },
    { name: '17m', min: 18068000, max: 18168000 },
    { name: '15m', min: 21000000, max: 21450000 },
    { name: '12m', min: 24890000, max: 24990000 },
    { name: '10m', min: 28000000, max: 29700000 },
    { name: '6m', min: 50000000, max: 54000000 },
    { name: '2m', min: 144000000, max: 148000000 },
    { name: '70cm', min: 420000000, max: 450000000 }
  ];

  function getBandFromFreq(hz) {
    for (const band of BANDS) {
      if (hz >= band.min && hz <= band.max) return band.name;
    }
    return '?';
  }

  class YaesuFT991ADriver {
    constructor({
      // allow user to override calibration points
      swrPoints,
      voltPoints,
      ampPerRaw = 0.1,
      interCommandDelayMs = 20
    } = {}) {
      this.interCommandDelayMs = interCommandDelayMs;

      this.SWR_POINTS = swrPoints || [
        { x: 0, y: 1.0 },
        { x: 65, y: 1.7 },
        { x: 255, y: 3.75 }
      ];
      this.VOLT_POINTS = voltPoints || [
        { x: 176, y: 12.9 },
        { x: 186, y: 13.7 }
      ];
      this.AMP_PER_RAW = ampPerRaw;
    }

    serialOptions() { return { dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }; }

    // framing: ';'
    extractFrames(rxBuf) {
      const frames = [];
      while (true) {
        const end = rxBuf.indexOf(0x3B);
        if (end === -1) break;
        frames.push(Uint8Array.from(rxBuf.slice(0, end + 1)));
        rxBuf.splice(0, end + 1);
      }
      return frames;
    }

    toBytes(s) { return te.encode(s); }

    // Reads
    cmdReadRxTxStatus() { return this.toBytes('TX;'); }
    cmdReadFreq() { return this.toBytes('FA;'); }
    cmdReadMode() { return this.toBytes('MD0;'); }
    cmdReadRfPwrSetting() { return this.toBytes('PC;'); }
    cmdReadSmeter() { return this.toBytes('RM1;'); }
    cmdReadPoMeter() { return this.toBytes('RM5;'); }
    cmdReadSWR() { return this.toBytes('RM6;'); }
    cmdReadId() { return this.toBytes('RM7;'); }
    cmdReadVd() { return this.toBytes('RM8;'); }

    // Controls
    cmdSetFreqHz(hz) {
      const f = Math.round(hz);
      if (!Number.isFinite(f) || f <= 0) throw new Error('Bad frequency');
      const s = String(f).padStart(9, '0').slice(-9);
      return this.toBytes(`FA${s};`);
    }

    cmdSetMode(modeName) {
      const m = String(modeName || '').toUpperCase();
      const map = {
        'LSB': '1',
        'USB': '2',
        'CW': '3',
        'CW-U': '3',
        'FM': '4',
        'AM': '5',
        'RTTY': '6',
        'RTTY-LSB': '6',
        'CW-L': '7',
        'DATA-LSB': '8',
        'RTTY-USB': '9',
        'DATA-FM': 'A',
        'FM-N': 'B',
        'DATA-USB': 'C',
        'AM-N': 'D',
        'C4FM': 'E'
      };
      const code = map[m];
      if (!code) throw new Error(`FT-991A unsupported mode: ${modeName}`);
      return this.toBytes(`MD0${code};`);
    }

    cmdSetPTT(on) { return this.toBytes(`MX${on ? '1' : '0'};`); }

    cmdSetRFPower(watts) {
      const w = Math.round(clamp(watts, 0, 100));
      const pc = String(w).padStart(3, '0');
      return this.toBytes(`PC${pc};`);
    }

    pollSequence() {
      return [
        this.cmdReadRxTxStatus(), this.cmdReadFreq(), this.cmdReadMode(),
        this.cmdReadSmeter(), this.cmdReadSWR(), this.cmdReadRfPwrSetting(),
        this.cmdReadPoMeter(), this.cmdReadVd(), this.cmdReadId()
      ];
    }

    swrFromRaw(raw) { return interp1D(raw, this.SWR_POINTS); }
    voltsFromRaw(raw) { return interp1D(raw, this.VOLT_POINTS); }
    ampsFromRaw(raw) { return raw * this.AMP_PER_RAW; }
    rfSettingWattsFromPC(pc, hz) { return clamp(pc, 0, maxWattsFromHz(hz)); }
    poWattsFromRaw(raw, hz) { return (raw / 255) * maxWattsFromHz(hz); }

    parseFrame(frameBytes, ctx) {
      const msg = td.decode(frameBytes).trim();
      if (!msg.endsWith(';')) return [];
      const core = msg.slice(0, -1);

      if (core.startsWith('FA') && core.length >= 11) {
        const hz = parseInt(core.slice(2, 11), 10);
        return Number.isFinite(hz) ? [{ type: 'freq', hz }] : [];
      }

      if (core.startsWith('MD') && core.length >= 4) {
        const code = core[3].toUpperCase();
        const modeMap = {
          '1':'LSB','2':'USB','3':'CW-U','4':'FM','5':'AM','6':'RTTY-LSB','7':'CW-L','8':'DATA-LSB',
          '9':'RTTY-USB','A':'DATA-FM','B':'FM-N','C':'DATA-USB','D':'AM-N','E':'C4FM'
        };
        return [{ type: 'mode', modeText: modeMap[code] || code }];
      }

      if (core.startsWith('TX') && core.length >= 3) {
        return [{ type: 'ptt', isTx: core[2] === '2' }];
      }

      if (core.startsWith('PC') && core.length >= 5) {
        const pc = parseInt(core.slice(2, 5), 10);
        if (!Number.isFinite(pc)) return [];
        const hz = ctx?.lastFreqHz ?? NaN;
        return [{ type: 'rfpwr_setting_w', pc, watts: this.rfSettingWattsFromPC(pc, hz) }];
      }

      if (core.startsWith('RM') && core.length >= 6) {
        const id = core[2];
        const raw = parseInt(core.slice(3, 6), 10);
        if (!Number.isFinite(raw)) return [];
        const hz = ctx?.lastFreqHz ?? NaN;

        if (id === '1') return [{ type: 'smeter', raw }];
        if (id === '5') return [{ type: 'po_w', raw, watts: this.poWattsFromRaw(raw, hz) }];
        if (id === '6') return [{ type: 'swr', raw, swr: this.swrFromRaw(raw) }];
        if (id === '7') return [{ type: 'id', raw, amps: this.ampsFromRaw(raw) }];
        if (id === '8') return [{ type: 'vd', raw, volts: this.voltsFromRaw(raw) }];
      }

      return [];
    }

    formatTx(u8) { return `TX_991A: ${td.decode(u8)}`; }
    formatRx(u8) { return `RX_991A: ${td.decode(u8)}`; }

    // === UI SCHEMA ===
    availableModes() {
      // FT-991A ASCII CAT modes
      return [
        'LSB', 'USB', 'CW-U', 'FM', 'AM', 'RTTY-LSB', 'CW-L',
        'DATA-LSB', 'RTTY-USB', 'DATA-FM', 'FM-N', 'DATA-USB', 'AM-N', 'C4FM'
      ];
    }

    controlsSchema() {
      const readPath = (obj, path) => {
        const parts = path.split('.');
        let cur = obj; for (const p of parts) { if (!cur) return undefined; cur = cur[p]; }
        return cur;
      };
      return [
        // === PRIMARY CONTROLS ===
        {
          id: 'band', label: 'Band', kind: 'button-grid', group: 'primary', cols: 4,
          buttons: BANDS.map(b => ({ value: b.name, label: b.name })),
          read: (state) => state.freqHz ? getBandFromFreq(state.freqHz) : undefined,
          apply: async (radio, bandName) => {
            const band = BANDS.find(b => b.name === bandName);
            if (band) {
              const freq = (band.min + band.max) / 2;
              await radio.setFrequencyHz(freq);
            }
          }
        },
        {
          id: 'mode', label: 'Mode', kind: 'button-grid', group: 'primary', cols: 4,
          buttons: this.availableModes().map(m => ({ value: m, label: m })),
          read: (state) => state.mode,
          apply: async (radio, v) => radio.setMode(String(v))
        },

        // === TRANSMIT CONTROLS ===
        {
          id: 'ptt', label: 'PTT', kind: 'toggle', group: 'transmit',
          read: (state) => !!state.ptt,
          apply: async (radio, on) => radio.setPTT(!!on)
        },
        {
          id: 'rfpwr', label: 'RF Power', kind: 'range', group: 'transmit', min: 0, max: 100, step: 1,
          read: (state) => readPath(state, 'rfpwr_setting_w.pc'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetRFPower(Number(v)))
        }
      ];
    }
  }

  WebCAT.registerDriver(
    'yaesu.ft991a',
    (options) => new YaesuFT991ADriver(options),
    {
      label: 'Yaesu FT-991A (CAT ASCII)',
      defaultBaud: 38400,
      allowedBauds: [4800, 9600, 19200, 38400],
      needsAddr: false,
    }
  );
})(typeof window !== 'undefined' ? window : globalThis);
