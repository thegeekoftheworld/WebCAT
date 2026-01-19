/* FT-857D driver add-on for WebCAT (5-byte CAT, 8N2) */
(function (global) {
  'use strict';
  const WebCAT = global.WebCAT;
  if (!WebCAT) throw new Error('webcat-base.js must be loaded first');

  const { hex2 } = WebCAT.utils;

  class YaesuFT857DDriver {
    constructor({ interCommandDelayMs = 25 } = {}) {
      this.interCommandDelayMs = interCommandDelayMs;
      this._expect = [];
    }

    serialOptions() {
      return { dataBits: 8, stopBits: 2, parity: 'none', flowControl: 'none' };
    }

    _cmd5(b1, b2, b3, b4, op) { return new Uint8Array([b1&0xFF, b2&0xFF, b3&0xFF, b4&0xFF, op&0xFF]); }

    cmdReadFreqMode() { return this._cmd5(0,0,0,0,0x03); }
    cmdReadRxStatus() { return this._cmd5(0,0,0,0,0xE7); }
    cmdReadTxStatus() { return this._cmd5(0,0,0,0,0xF7); }

    cmdSetPTT(on) { return this._cmd5(0,0,0,0, on ? 0x08 : 0x88); }

    cmdSetMode(modeName) {
      const m = String(modeName || '').toUpperCase();
      const map = {
        'LSB':0x00,'USB':0x01,'CW':0x02,'CWR':0x03,'AM':0x04,
        'WFM':0x06,'FM':0x08,'FM-N':0x88,'NFM':0x88,'DIG':0x0A,'PKT':0x0C
      };
      const code = map[m];
      if (code == null) throw new Error(`FT-857D unsupported mode: ${modeName}`);
      return this._cmd5(code,0,0,0,0x07);
    }

    cmdSetFreqHz(hz) {
      const f = Math.round(hz);
      if (!Number.isFinite(f) || f <= 0) throw new Error('Bad frequency');

      // frequency in 10Hz units as 8 digits, BCD packed.
      const tenHz = Math.round(f / 10);
      const s = String(tenHz).padStart(8,'0').slice(-8);

      const p1 = parseInt(s.slice(0,2),10);
      const p2 = parseInt(s.slice(2,4),10);
      const p3 = parseInt(s.slice(4,6),10);
      const p4 = parseInt(s.slice(6,8),10);

      const bcd = (n) => (((Math.floor(n/10)&0x0F)<<4) | (n%10)) & 0xFF;
      return this._cmd5(bcd(p1), bcd(p2), bcd(p3), bcd(p4), 0x01);
    }

    pollSequence() {
      return [this.cmdReadFreqMode(), this.cmdReadRxStatus(), this.cmdReadTxStatus()];
    }

    onCommandSent(u8) {
      if (!(u8 instanceof Uint8Array) || u8.length !== 5) return;
      const op = u8[4];
      if (op === 0x03) this._expect.push({ type: 'freqmode', len: 5 });
      if (op === 0xE7) this._expect.push({ type: 'rxstatus', len: 1, altLen: 5 });
      if (op === 0xF7) this._expect.push({ type: 'txstatus', len: 1, altLen: 5 });
    }

    extractFrames(rxBuf) {
      const frames = [];
      while (this._expect.length) {
        const exp = this._expect[0];
        if (rxBuf.length >= exp.len) {
          frames.push({ bytes: Uint8Array.from(rxBuf.slice(0, exp.len)), exp });
          rxBuf.splice(0, exp.len);
          this._expect.shift();
          continue;
        }
        if (exp.altLen && rxBuf.length >= exp.altLen) {
          frames.push({ bytes: Uint8Array.from(rxBuf.slice(0, exp.altLen)), exp: { ...exp, len: exp.altLen } });
          rxBuf.splice(0, exp.altLen);
          this._expect.shift();
          continue;
        }
        break;
      }
      return frames;
    }

    _decodeBcdPairByte(b) {
      const hi = (b >> 4) & 0x0F;
      const lo = b & 0x0F;
      if (hi > 9 || lo > 9) return null;
      return hi * 10 + lo;
    }

    parseFrame(frameObj) {
      const bytes = frameObj.bytes;
      const exp = frameObj.exp;

      if ((exp.type === 'rxstatus' || exp.type === 'txstatus') && bytes.length > 1) {
        return this._parseStatusByte(exp.type, bytes[0]);
      }

      if (exp.type === 'rxstatus') return this._parseStatusByte('rxstatus', bytes[0]);
      if (exp.type === 'txstatus') return this._parseStatusByte('txstatus', bytes[0]);

      if (exp.type === 'freqmode' && bytes.length === 5) {
        const p1 = this._decodeBcdPairByte(bytes[0]);
        const p2 = this._decodeBcdPairByte(bytes[1]);
        const p3 = this._decodeBcdPairByte(bytes[2]);
        const p4 = this._decodeBcdPairByte(bytes[3]);
        if (p1==null||p2==null||p3==null||p4==null) return [];

        const tenHzStr = String(p1).padStart(2,'0') + String(p2).padStart(2,'0') + String(p3).padStart(2,'0') + String(p4).padStart(2,'0');
        const tenHz = parseInt(tenHzStr,10);
        const hz = tenHz * 10;

        const modeCode = bytes[4];
        const modeMap = {
          0x00:'LSB',0x01:'USB',0x02:'CW',0x03:'CWR',0x04:'AM',
          0x06:'WFM',0x08:'FM',0x88:'NFM',0x0A:'DIG',0x0C:'PKT',0x82:'CW-N'
        };
        const modeText = modeMap[modeCode] || `0x${hex2(modeCode)}`;

        return [{ type: 'freq', hz }, { type: 'mode', modeText }];
      }

      return [];
    }

    _parseStatusByte(kind, b) {
      const ev = [];
      if (kind === 'rxstatus') {
        const sNib = b & 0x0F;
        ev.push({ type: 'smeter', raw: sNib * 17 });
      }
      if (kind === 'txstatus') {
        const poNib = b & 0x0F;
        ev.push({ type: 'po', raw: poNib * 17, raw4: poNib });
        const hiSWR = ((b >> 6) & 0x01) === 1;
        const pttOff = ((b >> 7) & 0x01) === 1; // 0=TX, 1=RX
        ev.push({ type: 'ptt', isTx: !pttOff });
        ev.push({ type: 'extra', data: { hiSWR } });
      }
      return ev;
    }

    formatTx(u8) { return `TX_857D: ${WebCAT.utils.bytesToHex(u8)}`; }
    formatRx(u8) { return `RX_857D: ${WebCAT.utils.bytesToHex(u8)}`; }
  }

  WebCAT.registerDriver(
    'yaesu.ft857d',
    (options) => new YaesuFT857DDriver(options),
    {
      label: 'Yaesu FT-857D (CAT 5-byte, 8N2)',
      defaultBaud: 9600,
      allowedBauds: [4800, 9600, 19200, 38400],
      needsAddr: false,
    }
  );
})(window);
