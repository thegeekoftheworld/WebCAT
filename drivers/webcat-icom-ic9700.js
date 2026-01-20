/* IC-9700 driver add-on for WebCAT (CI-V) */
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

  // Ham radio bands (USA) - IC-9700 supports VHF/UHF primarily
  const BANDS = [
    { name: '2m', min: 144000000, max: 148000000 },
    { name: '70cm', min: 420000000, max: 450000000 },
    { name: '23cm', min: 1240000000, max: 1325000000 }
  ];

  function getBandFromFreq(hz) {
    for (const band of BANDS) {
      if (hz >= band.min && hz <= band.max) return band.name;
    }
    return '?';
  }

  class IcomCivTransport {
    constructor({ radioAddr = 0xA2, ctrlAddr = 0xE0 }) {
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

  class IcomIC9700Driver {
    constructor({ addrHex = 'A2' } = {}) {
      this.transport = new IcomCivTransport({ radioAddr: parseHexByte(addrHex), ctrlAddr: 0xE0 });
      this.interCommandDelayMs = 0;
    }

    serialOptions() { return { dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }; }

    // Reads
    cmdReadRxTxStatus() { return this.transport.buildFrame(Uint8Array.from([0x1C, 0x00])); }
    cmdReadFreq()       { return this.transport.buildFrame(Uint8Array.from([0x03])); }
    cmdReadMode()       { return this.transport.buildFrame(Uint8Array.from([0x04])); }
    cmdReadSmeter()     { return this.transport.buildFrame(Uint8Array.from([0x15, 0x02])); }
    cmdReadSWR()        { return this.transport.buildFrame(Uint8Array.from([0x15, 0x12])); }
    cmdReadPoMeter()    { return this.transport.buildFrame(Uint8Array.from([0x15, 0x11])); }
    cmdReadRfPwrSetting(){return this.transport.buildFrame(Uint8Array.from([0x14, 0x0A])); }
    cmdReadVd()         { return this.transport.buildFrame(Uint8Array.from([0x15, 0x15])); }
    cmdReadId()         { return this.transport.buildFrame(Uint8Array.from([0x15, 0x16])); }
    // Additional audio controls
    cmdReadAF()         { return this.transport.buildFrame(Uint8Array.from([0x14, 0x01])); }
    cmdReadRF()         { return this.transport.buildFrame(Uint8Array.from([0x14, 0x02])); }
    cmdReadSQL()        { return this.transport.buildFrame(Uint8Array.from([0x14, 0x03])); }
    cmdReadCompression() { return this.transport.buildFrame(Uint8Array.from([0x14, 0x0E])); }
    cmdReadMonitor()    { return this.transport.buildFrame(Uint8Array.from([0x14, 0x28])); }

    // Controls
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
      const map = {
        'LSB': 0x00, 'USB': 0x01, 'AM': 0x02, 'CW': 0x03, 'RTTY': 0x04, 'FM': 0x05,
        'CW-R': 0x07, 'CWR': 0x07, 'RTTY-R': 0x08, 'DV': 0x17, 'DD': 0x22
      };
      const code = map[m];
      if (code == null) throw new Error(`IC-9700 unsupported mode: ${modeName}`);
      return this.transport.buildFrame(Uint8Array.from([0x06, code]));
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

    cmdSetTXPower(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x0A, val]));
    }

    cmdSetCompression(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x0E, val]));
    }

    cmdSetMonitor(raw) {
      const val = Math.round(clamp(raw, 0, 255)) & 0xFF;
      return this.transport.buildFrame(Uint8Array.from([0x14, 0x28, val]));
    }

    pollSequence() {
      return [
        this.cmdReadRxTxStatus(), this.cmdReadFreq(), this.cmdReadMode(),
        this.cmdReadSmeter(), this.cmdReadSWR(), this.cmdReadRfPwrSetting(),
        this.cmdReadPoMeter(), this.cmdReadVd(), this.cmdReadId()
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
        0x07:'CW-R',0x08:'RTTY-R',0x17:'DV',0x22:'DD'
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
          // Vd
          let volts;
          if (raw <= 13) volts = (raw / 13) * 10.0;
          else volts = 10.0 + ((raw - 13) / (241 - 13)) * 6.0;
          return [{ type: 'vd', raw, volts }];
        }
        if (sub === 0x16) {
          let amps;
          if (raw <= 121) amps = (raw / 121) * 10.0;
          else amps = 10.0 + ((raw - 121) / (241 - 121)) * 10.0;
          return [{ type: 'id', raw, amps }];
        }
      }

      if (cmd === 0x14 && rest.length >= 1 && rest[0] === 0x0A) {
        const raw = this._decodeLevel0to255(rest.slice(1));
        return [{ type: 'rfpwr_setting', raw }];
      }

      return [];
    }

    formatTx(u8) { return `TX_CIV: ${WebCAT.utils.bytesToHex(u8)}`; }
    formatRx(u8) { return `RX_CIV: ${WebCAT.utils.bytesToHex(u8)}`; }

    // === UI SCHEMA ===
    availableModes() {
      // IC-9700 supports: LSB, USB, AM, CW, RTTY, FM, CW-R, RTTY-R, DV, DD
      return ['LSB', 'USB', 'AM', 'CW', 'RTTY', 'FM', 'CW-R', 'RTTY-R', 'DV', 'DD'];
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
          id: 'band', label: 'Band', kind: 'button-grid', group: 'primary', cols: 3,
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
          read: (state) => state.mode,
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
        }
      ];
    }
  }

  WebCAT.registerDriver(
    'icom.ic9700',
    (options) => new IcomIC9700Driver(options),
    {
      label: 'Icom IC-9700 (CI-V)',
      defaultBaud: 115200,
      allowedBauds: WebCAT.COMMON_BAUDS,
      needsAddr: true,
      defaultAddrHex: 'A2'
    }
  );
})(typeof window !== 'undefined' ? window : globalThis);
