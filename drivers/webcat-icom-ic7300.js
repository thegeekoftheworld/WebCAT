/* IC-7300 driver add-on for WebCAT (CI-V) */
(function (global) {
  'use strict';
  const WebCAT = global.WebCAT;
  if (!WebCAT) throw new Error('webcat-base.js must be loaded first');

  const { clamp, hex2, parseHexByte, interp1D } = WebCAT.utils;

  function bcdByteToDigits(b) {
    const lo = b & 0x0F;
    const hi = (b >> 4) & 0x0F;
    return { lo, hi };
  }

  class IcomCivTransport {
    constructor({ radioAddr = 0x94, ctrlAddr = 0xE0 }) {
      this.radioAddr = radioAddr;
      this.ctrlAddr = ctrlAddr;
    }
    buildFrame(payloadBytes) {
      const out = new Uint8Array(2 + 2 + payloadBytes.length + 1);
      out[0] = 0xFE; out[1] = 0xFE;
      out[2] = this.radioAddr;
      out[3] = this.ctrlAddr;
      out.set(payloadBytes, 4);
      out[out.length - 1] = 0xFD;
      return out;
    }
  }

  // Ham radio bands (USA)
  const BANDS = [
    { name: '160m', min: 1800000, max: 2000000 },
    { name: '80m', min: 3500000, max: 4000000 },
    { name: '60m', min: 5330500, max: 5406500 },
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

  class IcomIC7300Driver {
    constructor({ addrHex = '94' } = {}) {
      this.transport = new IcomCivTransport({ radioAddr: parseHexByte(addrHex), ctrlAddr: 0xE0 });
      this.interCommandDelayMs = 0;
    }

    serialOptions() { return { dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }; }

    // Read commands
    cmdReadRxTxStatus() { return this.transport.buildFrame(Uint8Array.from([0x1C, 0x00])); }
    cmdReadFreq()       { return this.transport.buildFrame(Uint8Array.from([0x03])); }
    cmdReadMode()       { return this.transport.buildFrame(Uint8Array.from([0x04])); }
    cmdReadSmeter()     { return this.transport.buildFrame(Uint8Array.from([0x15, 0x02])); }
    cmdReadSWR()        { return this.transport.buildFrame(Uint8Array.from([0x15, 0x12])); }
    cmdReadPoMeter()    { return this.transport.buildFrame(Uint8Array.from([0x15, 0x11])); }
    cmdReadRfPwrSetting(){ return this.transport.buildFrame(Uint8Array.from([0x14, 0x0A])); }
    cmdReadVd()         { return this.transport.buildFrame(Uint8Array.from([0x15, 0x15])); }
    cmdReadId()         { return this.transport.buildFrame(Uint8Array.from([0x15, 0x16])); }
    cmdReadAF()         { return this.transport.buildFrame(Uint8Array.from([0x14, 0x01])); }
    cmdReadRF()         { return this.transport.buildFrame(Uint8Array.from([0x14, 0x02])); }
    cmdReadSQL()        { return this.transport.buildFrame(Uint8Array.from([0x14, 0x03])); }
    cmdReadRIT()        { return this.transport.buildFrame(Uint8Array.from([0x14, 0x07])); }
    cmdReadXIT()        { return this.transport.buildFrame(Uint8Array.from([0x14, 0x08])); }
    cmdReadWaterfall()  { return this.transport.buildFrame(Uint8Array.from([0x27, 0x00])); }
    // Additional feature reads
    cmdReadCompression() { return this.transport.buildFrame(Uint8Array.from([0x14, 0x0E])); }
    cmdReadTXPower()    { return this.transport.buildFrame(Uint8Array.from([0x14, 0x0A])); }
    cmdReadATUStatus()  { return this.transport.buildFrame(Uint8Array.from([0x1C, 0x08])); }
    cmdReadFilterBW()   { return this.transport.buildFrame(Uint8Array.from([0x14, 0x21])); }
    cmdReadNoiseBlanker() { return this.transport.buildFrame(Uint8Array.from([0x14, 0x22])); }
    cmdReadAutoNotch()  { return this.transport.buildFrame(Uint8Array.from([0x14, 0x24])); }
    cmdReadManualNotch() { return this.transport.buildFrame(Uint8Array.from([0x14, 0x25])); }
    cmdReadPreamp()     { return this.transport.buildFrame(Uint8Array.from([0x14, 0x26])); }
    cmdReadAGC()        { return this.transport.buildFrame(Uint8Array.from([0x14, 0x27])); }
    cmdReadMonitor()    { return this.transport.buildFrame(Uint8Array.from([0x14, 0x28])); }
    cmdReadVFOLock()    { return this.transport.buildFrame(Uint8Array.from([0x1F, 0x05])); }
    cmdReadTuningStep() { return this.transport.buildFrame(Uint8Array.from([0x1F, 0x10])); }
    cmdReadSplitTxFreq() { return this.transport.buildFrame(Uint8Array.from([0x0F])); }
    cmdReadMeterType()  { return this.transport.buildFrame(Uint8Array.from([0x15, 0x07])); }
    // Data mode status (function group)
    cmdReadDataMode()   { return this.transport.buildFrame(Uint8Array.from([0x1A, 0x06])); }

    // Control commands
    cmdSetFreqHz(hz) {
      const f = Math.round(hz);
      if (!Number.isFinite(f) || f <= 0) throw new Error('Bad frequency');
      const digits = [];
      let n = f;
      for (let i = 0; i < 10; i++) { digits.push(n % 10); n = Math.floor(n / 10); }
      const data = new Uint8Array(1 + 5);
      data[0] = 0x05;
      for (let i = 0; i < 5; i++) {
        const lo = digits[i*2];
        const hi = digits[i*2 + 1];
        data[1 + i] = ((hi & 0x0F) << 4) | (lo & 0x0F);
      }
      return this.transport.buildFrame(data);
    }

    cmdSetMode(modeName) {
      const m = String(modeName || '').toUpperCase();
      // IC-7300 notes: Set base mode via 0x06, toggle data mode via 0x1A 0x06 {00|01}
      // We map DATA-* aliases to base modes and explicitly toggle data mode.
      const isDigital = (mm) => (
        mm === 'LSB-D' || mm === 'USB-D' || mm === 'AM-D' || mm === 'CW-D' || mm === 'RTTY-D' || mm === 'FM-D'
      );

      const baseModeFor = (mm) => {
        const table = {
          'LSB': 0x00, 'USB': 0x01, 'AM': 0x02, 'CW': 0x03, 'RTTY': 0x04, 'FM': 0x05,
          'CW-R': 0x07, 'RTTY-R': 0x08, 'DV': 0x17, 'DD': 0x22,
          'LSB-D': 0x00, 'USB-D': 0x01, 'AM-D': 0x02, 'CW-D': 0x03, 'RTTY-D': 0x04, 'FM-D': 0x05
        };
        return table[mm];
      };

      const baseMode = baseModeFor(m);
      if (baseMode == null) throw new Error(`IC-7300 unsupported mode: ${modeName}`);

      const frames = [];
      // Set base mode first (filter byte omitted for now)
      frames.push(this.transport.buildFrame(Uint8Array.from([0x06, baseMode])));

      // Toggle data mode explicitly
      const dataOn = isDigital(m) ? 0x01 : 0x00;
      frames.push(this.transport.buildFrame(Uint8Array.from([0x1A, 0x06, dataOn])));

      return frames;
    }

    cmdSetPTT(on) {
      return this.transport.buildFrame(Uint8Array.from([0x1C, 0x00, on ? 0x01 : 0x00]));
    }

    cmdSetAF(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x01, val]));
    }

    cmdSetRF(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x02, val]));
    }

    cmdSetSQL(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x03, val]));
    }

    cmdSetRIT(raw) {
      // RIT offset in Hz, encoded as signed 16-bit little-endian
      const offset = Math.round(clamp(raw, -9999, 9999));
      const lo = (offset & 0xFF);
      const hi = ((offset >> 8) & 0xFF);
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x07, lo, hi]));
    }

    cmdSetXIT(raw) {
      // XIT offset in Hz, encoded as signed 16-bit little-endian
      const offset = Math.round(clamp(raw, -9999, 9999));
      const lo = (offset & 0xFF);
      const hi = ((offset >> 8) & 0xFF);
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x08, lo, hi]));
    }

    // Additional feature control commands
    cmdSetCompression(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x0E, val]));
    }

    cmdSetTXPower(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x0A, val]));
    }

    cmdSetATUTune() {
      return this.transport.buildFrame(Uint8Array.from([0x1C, 0x08, 0x01]));
    }

    cmdSetFilterBW(value) {
      const val = Math.round(clamp(value, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x21, val]));
    }

    cmdSetNoiseBlanker(value) {
      const val = Math.round(clamp(value, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x22, val]));
    }

    cmdSetAutoNotch(on) {
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x24, on ? 0x01 : 0x00]));
    }

    cmdSetManualNotch(freqHz) {
      const f = Math.round(clamp(freqHz, 0, 9999));
      const lo = (f & 0xFF);
      const hi = ((f >> 8) & 0xFF);
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x25, lo, hi]));
    }

    cmdSetPreamp(level) {
      // 0=off, 1=+10dB, 2=-10dB, 3=-20dB
      const val = Math.round(clamp(level, 0, 3)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x26, val]));
    }

    cmdSetAGC(mode) {
      // 0=Fast, 1=Mid, 2=Slow
      const val = Math.round(clamp(mode, 0, 2)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x27, val]));
    }

    cmdSetMonitor(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x28, val]));
    }

    cmdSetVFOLock(on) {
      return this.transport.buildFrame(Uint8Array.from([0x1F, 0x05, on ? 0x01 : 0x00]));
    }

    cmdSetTuningStep(step) {
      // 0=1Hz, 1=10Hz, 2=100Hz, 3=1kHz
      const val = Math.round(clamp(step, 0, 3)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x1F, 0x10, val]));
    }

    cmdSetSplitTxFreq(hz) {
      const f = Math.round(hz);
      if (!Number.isFinite(f) || f <= 0) throw new Error('Bad frequency');
      const digits = [];
      let n = f;
      for (let i = 0; i < 10; i++) { digits.push(n % 10); n = Math.floor(n / 10); }
      const data = new Uint8Array(1 + 5);
      data[0] = 0x0F;
      for (let i = 0; i < 5; i++) {
        const lo = digits[i*2];
        const hi = digits[i*2 + 1];
        data[1 + i] = ((hi & 0x0F) << 4) | (lo & 0x0F);
      }
      return this.transport.buildFrame(data);
    }

    cmdSetMeterType(type) {
      // 0=S-meter, 1=SWR, 2=Power out
      const val = Math.round(clamp(type, 0, 2)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x15, 0x07, val]));
    }

    pollSequence() {
      return [
        this.cmdReadRxTxStatus(), this.cmdReadFreq(), this.cmdReadMode(),
        this.cmdReadSmeter(), this.cmdReadSWR(), this.cmdReadRfPwrSetting(),
        this.cmdReadPoMeter(), this.cmdReadVd(), this.cmdReadId(),
        this.cmdReadAF(), this.cmdReadRF(), this.cmdReadSQL(),
        this.cmdReadCompression(), this.cmdReadFilterBW(), this.cmdReadNoiseBlanker(),
        this.cmdReadAutoNotch(), this.cmdReadPreamp(), this.cmdReadAGC(),
        this.cmdReadMonitor(), this.cmdReadVFOLock(), this.cmdReadTuningStep(),
        this.cmdReadATUStatus(), this.cmdReadMeterType(), this.cmdReadDataMode()
      ];
    }

    extractFrames(rxBuf) {
      const frames = [];
      while (rxBuf.length >= 4) {
        let start = -1;
        for (let i = 0; i < rxBuf.length - 1; i++) {
          if (rxBuf[i] === 0xFE && rxBuf[i+1] === 0xFE) { start = i; break; }
        }
        if (start === -1) { rxBuf.length = 0; break; }
        if (start > 0) rxBuf.splice(0, start);
        const end = rxBuf.indexOf(0xFD, 2);
        if (end === -1) break;
        frames.push(Uint8Array.from(rxBuf.slice(0, end + 1)));
        rxBuf.splice(0, end + 1);
      }
      return frames;
    }

    _parseFrame(frameBytes) {
      if (frameBytes.length < 6) return null;
      if (frameBytes[0] !== 0xFE || frameBytes[1] !== 0xFE) return null;
      if (frameBytes[frameBytes.length - 1] !== 0xFD) return null;
      return frameBytes.slice(4, frameBytes.length - 1);
    }

    _decodeFreqHz(data) {
      if (!data || data.length < 5) return null;
      const digits = [];
      for (let i = 0; i < 5; i++) {
        const { lo, hi } = bcdByteToDigits(data[i]);
        digits.push(lo, hi);
      }
      let hz = 0;
      for (let pos = 0; pos < digits.length; pos++) hz += digits[pos] * Math.pow(10, pos);
      return hz;
    }

    _decodeMode(data) {
      if (!data || data.length < 1) return null;
      const mode = data[0];
      const modeMap = {
        0x00:'LSB',0x01:'USB',0x02:'AM',0x03:'CW',0x04:'RTTY',0x05:'FM',
        0x07:'CW-R',0x08:'RTTY-R',0x17:'DV',0x22:'DD',
        // Digital modes
        0x80:'LSB-D', 0x81:'USB-D', 0x82:'AM-D', 0x83:'CW-D',
        0x84:'RTTY-D', 0x85:'FM-D', 0x87:'CWR-D', 0x88:'RTTY-R-D'
      };
      return modeMap[mode] || `0x${hex2(mode)}`;
    }

    _decodeLevel0to255(data) {
      if (!data || data.length < 1) return null;
      // 2-byte BCD sometimes
      if (data.length >= 2) {
        const a = bcdByteToDigits(data[0]);
        const b = bcdByteToDigits(data[1]);
        const digits = [a.hi, a.lo, b.hi, b.lo];
        if (digits.every(d => d >= 0 && d <= 9)) {
          const v = digits.reduce((acc, d) => acc * 10 + d, 0);
          if (v >= 0 && v <= 255) return v;
        }
      }
      return clamp(data[0], 0, 255);
    }

    _decodeOffset16(data) {
      if (!data || data.length < 2) return null;
      // Signed 16-bit little-endian
      let val = (data[0] & 0xFF) | ((data[1] & 0xFF) << 8);
      if (val & 0x8000) val = val - 0x10000; // sign extend
      return val;
    }

    parseFrame(frameBytes) {
      const body = this._parseFrame(frameBytes);
      if (!body) return [];

      // OK/NG
      if (body.length === 1 && (body[0] === 0xFB || body[0] === 0xFA)) return [];

      const cmd = body[0];
      const rest = body.slice(1);

      if (cmd === 0x03) {
        const hz = this._decodeFreqHz(rest);
        return (hz != null) ? [{ type: 'freq', hz }] : [];
      }
      if (cmd === 0x04) {
        const modeText = this._decodeMode(rest);
        return modeText ? [{ type: 'mode', modeText }] : [];
      }
      if (cmd === 0x1C && rest.length >= 2 && rest[0] === 0x00) {
        return [{ type: 'ptt', isTx: rest[1] === 0x01 }];
      }

      if (cmd === 0x15 && rest.length >= 1) {
        const sub = rest[0];
        const raw = this._decodeLevel0to255(rest.slice(1));
        if (sub === 0x02) return [{ type: 'smeter', raw }];
        if (sub === 0x11) return [{ type: 'po', raw }];
        if (sub === 0x12) {
          // piecewise reference points from CI-V docs
          const swr = interp1D(raw, [
            { x:0, y:1.0 }, { x:48, y:1.5 }, { x:80, y:2.0 }, { x:120, y:3.0 }, { x:255, y:10.0 }
          ]);
          return [{ type: 'swr', raw, swr }];
        }
        if (sub === 0x15) {
          // Vd (supply voltage)
          let volts;
          if (raw <= 13) volts = (raw / 13) * 10.0;
          else volts = 10.0 + ((raw - 13) / (241 - 13)) * 6.0;
          return [{ type: 'vd', raw, volts }];
        }
        if (sub === 0x16) {
          // Id (supply current)
          let amps;
          if (raw <= 121) amps = (raw / 121) * 10.0;
          else amps = 10.0 + ((raw - 121) / (241 - 121)) * 10.0;
          return [{ type: 'id', raw, amps }];
        }
      }

      if (cmd === 0x14 && rest.length >= 1) {
        const sub = rest[0];
        const raw = this._decodeLevel0to255(rest.slice(1));
        
        if (sub === 0x0A) return [{ type: 'txpwr', raw }];
        if (sub === 0x01) return [{ type: 'af', raw }];
        if (sub === 0x02) return [{ type: 'rf', raw }];
        if (sub === 0x03) return [{ type: 'sql', raw }];
        if (sub === 0x07) {
          const offset = this._decodeOffset16(rest.slice(1));
          return offset != null ? [{ type: 'rit', offset }] : [];
        }
        if (sub === 0x08) {
          const offset = this._decodeOffset16(rest.slice(1));
          return offset != null ? [{ type: 'xit', offset }] : [];
        }
        if (sub === 0x0E) return [{ type: 'compression', raw }];
        if (sub === 0x21) return [{ type: 'filterbw', raw }];
        if (sub === 0x22) return [{ type: 'nb', raw }];
        if (sub === 0x24) return [{ type: 'autonotch', raw }];
        if (sub === 0x25) {
          const offset = this._decodeOffset16(rest.slice(1));
          return offset != null ? [{ type: 'manualnotch', offset }] : [];
        }
        if (sub === 0x26) return [{ type: 'preamp', raw }];
        if (sub === 0x27) return [{ type: 'agc', raw }];
        if (sub === 0x28) return [{ type: 'monitor', raw }];
      }

      if (cmd === 0x1C && rest.length >= 2) {
        if (rest[0] === 0x00) return [{ type: 'ptt', isTx: rest[1] === 0x01 }];
        if (rest[0] === 0x08) return [{ type: 'atu', status: rest[1] }];
      }

      // Function group responses
      if (cmd === 0x1A && rest.length >= 1) {
        const sub = rest[0];
        if (sub === 0x06) {
          const on = rest.length >= 2 ? (rest[1] === 0x01) : undefined;
          if (on != null) return [{ type: 'extra', data: { datamode: !!on } }];
        }
      }

      if (cmd === 0x1F && rest.length >= 2) {
        if (rest[0] === 0x05) return [{ type: 'vfolock', on: rest[1] === 0x01 }];
        if (rest[0] === 0x10) return [{ type: 'tuningstep', step: rest[1] }];
      }

      if (cmd === 0x0F) {
        const hz = this._decodeFreqHz(rest);
        return (hz != null) ? [{ type: 'splittxfreq', hz }] : [];
      }

      if (cmd === 0x15 && rest.length >= 2 && rest[0] === 0x07) {
        const meterType = rest[1];
        return [{ type: 'metertype', meterType }];
      }

      // Waterfall/Scope data (0x27)
      if (cmd === 0x27 && rest.length >= 1) {
        if (rest[0] === 0x00) {
          // Waterfall data: 0x27 0x00 [data_array]
          // IC-7300 returns 101 bytes of spectrum data (0-100 dB range)
          const waterfallData = rest.slice(1);
          if (waterfallData.length > 0) {
            return [{ type: 'waterfall', raw: waterfallData }];
          }
        }
      }

      return [];
    }

    formatTx(u8) { return `TX_CIV: ${WebCAT.utils.bytesToHex(u8)}`; }
    formatRx(u8) { return `RX_CIV: ${WebCAT.utils.bytesToHex(u8)}`; }

    // ---- Dynamic UI support ----
    availableModes() {
      return [
        'LSB','USB','AM','CW','RTTY','FM',
        'CW-R','RTTY-R','DV','DD',
        'LSB-D','USB-D','AM-D','CW-D','RTTY-D','FM-D'
      ];
    }

    controlsSchema() {
      // Each control provides a descriptor with how to read current value from state and how to apply a new one
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
          id: 'mode', label: 'Mode', kind: 'button-grid', group: 'primary', cols: 3,
          buttons: this.availableModes().map(m => ({ value: m, label: m })),
          read: (state) => {
            const base = state.mode;
            const d = !!(state.extras && state.extras.datamode);
            if (d && base === 'LSB') return 'LSB-D';
            if (d && base === 'USB') return 'USB-D';
            if (d && base && base !== 'FM' && base !== 'AM') return 'DIG';
            return base;
          },
          apply: async (radio, v) => radio.setMode(String(v))
        },

        // === AUDIO CONTROLS ===
        {
          id: 'af', label: 'AF Gain', kind: 'range', group: 'audio', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'af.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetAF(Number(v)))
        },
        {
          id: 'rf', label: 'RF Gain', kind: 'range', group: 'audio', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'rf.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetRF(Number(v)))
        },
        {
          id: 'sql', label: 'Squelch', kind: 'range', group: 'audio', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'sql.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetSQL(Number(v)))
        },

        // === TRANSMIT CONTROLS ===
        {
          id: 'ptt', label: 'PTT', kind: 'toggle', group: 'transmit',
          read: (state) => !!state.ptt,
          apply: async (radio, on) => radio.setPTT(!!on)
        },
        {
          id: 'txpwr', label: 'TX Power', kind: 'range', group: 'transmit', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'txpwr.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetTXPower(Number(v)))
        },
        {
          id: 'compression', label: 'Speech Comp', kind: 'range', group: 'transmit', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'compression.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetCompression(Number(v)))
        },
        {
          id: 'monitor', label: 'Monitor', kind: 'range', group: 'transmit', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'monitor.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetMonitor(Number(v)))
        },

        // === FILTER & DSP ===
        {
          id: 'filterbw', label: 'Filter Width', kind: 'range', group: 'filter', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'filterbw.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetFilterBW(Number(v)))
        },
        {
          id: 'nb', label: 'Noise Blanker', kind: 'range', group: 'filter', min: 0, max: 255, step: 1,
          read: (state) => readPath(state, 'nb.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetNoiseBlanker(Number(v)))
        },
        {
          id: 'autonotch', label: 'Auto Notch', kind: 'toggle', group: 'filter',
          read: (state) => !!readPath(state, 'autonotch.raw'),
          apply: async (radio, on) => radio.sendCommand(radio.driver.cmdSetAutoNotch(!!on))
        },
        {
          id: 'preamp', label: 'Preamp/Atten', kind: 'button-grid', group: 'filter', cols: 2,
          buttons: [
            { value: 0, label: 'Off' }, { value: 1, label: 'P.AMP +10dB' }, 
            { value: 2, label: 'ATT -10dB' }, { value: 3, label: 'ATT -20dB' }
          ],
          read: (state) => readPath(state, 'preamp.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetPreamp(Number(v)))
        },
        {
          id: 'agc', label: 'AGC Speed', kind: 'button-grid', group: 'filter', cols: 3,
          buttons: [
            { value: 0, label: 'Fast' }, { value: 1, label: 'Mid' }, { value: 2, label: 'Slow' }
          ],
          read: (state) => readPath(state, 'agc.raw'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetAGC(Number(v)))
        },

        // === OFFSET CONTROLS ===
        {
          id: 'rit', label: 'RIT Offset (Hz)', kind: 'number', group: 'offset', step: 10, min: -9999, max: 9999,
          read: (state) => readPath(state, 'rit.offset'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetRIT(Number(v)))
        },
        {
          id: 'xit', label: 'XIT Offset (Hz)', kind: 'number', group: 'offset', step: 10, min: -9999, max: 9999,
          read: (state) => readPath(state, 'xit.offset'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetXIT(Number(v)))
        },

        // === ADVANCED ===
        {
          id: 'vfolock', label: 'VFO Lock', kind: 'toggle', group: 'advanced',
          read: (state) => !!readPath(state, 'vfolock.on'),
          apply: async (radio, on) => radio.sendCommand(radio.driver.cmdSetVFOLock(!!on))
        },
        {
          id: 'tuningstep', label: 'Tuning Step', kind: 'button-grid', group: 'advanced', cols: 2,
          buttons: [
            { value: 0, label: '1 Hz' }, { value: 1, label: '10 Hz' }, 
            { value: 2, label: '100 Hz' }, { value: 3, label: '1 kHz' }
          ],
          read: (state) => readPath(state, 'tuningstep.step'),
          apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetTuningStep(Number(v)))
        }
      ];
    }
  }

  WebCAT.registerDriver(
    'icom.ic7300',
    (options) => new IcomIC7300Driver(options),
    {
      label: 'Icom IC-7300 (CI-V)',
      defaultBaud: 115000,
      allowedBauds: WebCAT.COMMON_BAUDS,
      needsAddr: true,
      defaultAddrHex: '94'
    }
  );
})(typeof window !== 'undefined' ? window : globalThis);
