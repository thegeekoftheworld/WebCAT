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
      const map = {
        'LSB': 0x00, 'USB': 0x01, 'AM': 0x02, 'CW': 0x03, 'RTTY': 0x04, 'FM': 0x05,
        'CW-R': 0x07, 'CWR': 0x07, 'RTTY-R': 0x08, 'DV': 0x17, 'DD': 0x22
      };
      const code = map[m];
      if (code == null) throw new Error(`IC-7300 unsupported mode: ${modeName}`);
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
        this.cmdReadATUStatus(), this.cmdReadMeterType()
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

      return [];
    }

    formatTx(u8) { return `TX_CIV: ${WebCAT.utils.bytesToHex(u8)}`; }
    formatRx(u8) { return `RX_CIV: ${WebCAT.utils.bytesToHex(u8)}`; }
  }

  WebCAT.registerDriver(
    'icom.ic7300',
    (options) => new IcomIC7300Driver(options),
    {
      label: 'Icom IC-7300 (CI-V)',
      defaultBaud: 19200,
      allowedBauds: WebCAT.COMMON_BAUDS,
      needsAddr: true,
      defaultAddrHex: '94'
    }
  );
})(window);
