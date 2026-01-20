# WebCAT Driver Standards & Specification

**STATUS**: Complete with reference implementations applied to IC-9700, FT-991A, and FT-857D drivers.

This document defines the interface, architecture, and best practices for creating new ham radio drivers for WebCAT. Use this as a template and reference when implementing drivers for new radio models.

---

## Table of Contents

1. [Overview](#overview)
2. [Driver Architecture](#driver-architecture)
3. [Required Interface Methods](#required-interface-methods)
4. [Control Schema System](#control-schema-system)
5. [Band Support](#band-support)
6. [Mode Support](#mode-support)
7. [Radio State Object](#radio-state-object)
8. [Protocol Implementations](#protocol-implementations)
9. [Testing & Validation](#testing--validation)
10. [Reference Implementations](#reference-implementations)

---

## Overview

A WebCAT driver is a JavaScript class that encapsulates:
- **Serial Protocol**: How to encode/decode radio commands (CI-V, CAT, etc.)
- **Command Set**: Frequency, mode, PTT, power, audio controls, etc.
- **State Parsing**: Converting raw radio responses to application state
- **Control Schema**: UI definitions for dynamic control panels

### Driver Registration

All drivers must be registered with WebCAT at startup:

```javascript
WebCAT.registerDriver(id, factory, metadata);
```

**Parameters:**
- `id` (string): Unique identifier, e.g., `"icom.ic7300"`, `"yaesu.ft991a"`
- `factory` (function): `(options) => driverInstance`
- `metadata` (object): Label, baud rates, address hint, etc.

**Example:**
```javascript
WebCAT.registerDriver(
  'icom.ic7300',
  (opts) => new IcomIC7300Driver(opts),
  {
    label: 'Icom IC-7300',
    defaultBaud: 19200,
    allowedBauds: [9600, 19200, 38400],
    needsAddr: true,
    addrHint: '94'
  }
);
```

---

## Driver Architecture

### Class Structure

Every driver must be a class with the following lifecycle:

```javascript
class RadioDriver {
  constructor(options) {
    // Initialize with baud rate, address, calibration points, etc.
  }

  serialOptions()        // → { dataBits, stopBits, parity, flowControl }
  availableModes()       // → ['LSB', 'USB', 'AM', ...]
  controlsSchema()       // → [ { id, label, kind, group, apply, read }, ... ]

  // Read commands (return Uint8Array)
  cmdReadFreq()
  cmdReadMode()
  cmdReadRxTxStatus()
  cmdReadSmeter()
  // ... more reads

  // Write commands (return Uint8Array or Uint8Array[])
  cmdSetFreqHz(hz)
  cmdSetMode(modeName)
  cmdSetPTT(on)
  // ... more writes

  // Frame handling
  extractFrames(rxBuf)   // → Uint8Array[] (parse incoming data)
  parseFrame(u8)         // → state updates { type, value, ... }

  // Optional
  pollSequence(ctx)      // → [cmdRead1, cmdRead2, ...] for continuous polling
  formatTx(u8)           // → string (for logging)
  formatRx(u8)           // → string (for logging)
}
```

### State Context Object

The `ctx` parameter passed to methods contains:

```javascript
{
  state: {
    freqHz: number,
    mode: string,
    ptt: boolean,
    rxTxStatus: boolean,
    smeter: { raw: 0-255, dbm: number },
    txpwr: { raw: 0-100 },
    af: { raw: 0-255 },
    // ... etc
  },
  radio: RadioController instance
}
```

---

## Required Interface Methods

### Serial Configuration

```javascript
serialOptions() {
  return {
    dataBits: 8,
    stopBits: 1 | 2,
    parity: 'none' | 'odd' | 'even',
    flowControl: 'none' | 'hardware'
  };
}
```

**Notes:**
- CI-V (Icom): 8N1, no flow control
- ASCII CAT (Yaesu): 8N1, no flow control
- 5-byte CAT (Yaesu FT-857D): 8N2, no flow control

### Command Methods

All command methods return a `Uint8Array` (or array of them for multi-frame commands):

#### Read Commands

```javascript
cmdReadFreq()        // Current VFO frequency
cmdReadMode()        // Current mode (LSB, USB, etc.)
cmdReadRxTxStatus()  // RX/TX state, PTT status
cmdReadSmeter()      // Signal meter value
cmdReadPowerMeter()  // TX power output
cmdReadAF()          // AF gain (volume)
cmdReadRF()          // RF gain
cmdReadSQL()         // Squelch level
// ... add more as radio supports
```

#### Write Commands

```javascript
cmdSetFreqHz(hz)        // Set frequency in Hz (number)
cmdSetMode(modeName)    // Set mode ('LSB', 'USB', 'AM', 'CW', 'FM', etc.)
cmdSetPTT(on)           // Transmit on/off (boolean)
cmdSetAF(raw)           // Set AF gain (0-255 or 0-100)
cmdSetRF(raw)           // Set RF gain
cmdSetSQL(raw)          // Set squelch
cmdSetTXPower(raw)      // Set transmit power
// ... add more as radio supports
```

**Return Value Contract:**
- Single command: `Uint8Array`
- Multiple frames: `Uint8Array[]` (e.g., when setting mode requires two commands)

### Frame Processing

```javascript
extractFrames(rxBuf) {
  // Parse incoming serial data buffer
  // Remove processed bytes from rxBuf in-place
  // Return array of complete frames as Uint8Array[]
  
  const frames = [];
  // ... find frame boundaries
  return frames;
}

parseFrame(u8) {
  // Decode a single frame
  // Return state update object:
  // { type: 'freq', hz: number } or
  // { type: 'mode', mode: 'USB' } or
  // { type: 'ptt', ptt: true } etc.
  
  return [];  // empty if not recognized
}
```

### Mode Support

```javascript
availableModes() {
  return [
    'LSB', 'USB', 'AM', 'CW', 'RTTY', 'FM',
    'CW-R', 'RTTY-R',  // reverse modes
    'FM-N',            // narrow FM
    'LSB-D', 'USB-D',  // data modes
    // ... etc
  ];
}
```

**Standard Abbreviations:**
- LSB/USB: Lower/Upper Sideband
- AM/FM: Amplitude/Frequency Modulation
- CW: Continuous Wave (morse)
- CW-R: CW reverse
- RTTY: Radio Teletype
- RTTY-R: RTTY reverse
- DIG/DV/DD: Data/Digital Voice/Digital Data
- FM-N/NFM: Narrow FM
- WFM: Wideband FM
- PKT: Packet

### Polling Sequence

```javascript
pollSequence(ctx) {
  // Return array of read commands to execute periodically
  // WebCAT will space them according to interCommandDelayMs
  
  return [
    this.cmdReadRxTxStatus(),
    this.cmdReadFreq(),
    this.cmdReadMode(),
    this.cmdReadSmeter(),
    this.cmdReadAF(),
    this.cmdReadRF(),
    this.cmdReadSQL()
  ];
}
```

### Logging/Formatting

```javascript
formatTx(u8) {
  // Return human-readable format of transmitted frame
  // Example: "TX_CIV: FE FE 94 E0 03 FD"
  return `TX: ${bytesToHex(u8)}`;
}

formatRx(u8) {
  // Return human-readable format of received frame
  return `RX: ${bytesToHex(u8)}`;
}
```

---

## Control Schema System

The `controlsSchema()` method returns an array of control descriptors that define the UI and logic for radio controls.

### Control Descriptor Structure

```javascript
{
  // Required
  id: 'af',                    // Unique control ID
  label: 'AF Gain',           // UI label
  kind: 'range'|'toggle'|'button-grid'|'select',
  group: 'primary'|'audio'|'transmit'|'filter'|'offset'|'advanced',

  // For range controls
  min: 0,                      // minimum value
  max: 255,                    // maximum value
  step: 1,                     // increment step

  // For button-grid controls
  buttons: [
    { value: 'LSB', label: 'LSB' },
    { value: 'USB', label: 'USB' },
    // ...
  ],
  cols: 3,                     // grid columns

  // For select controls
  options: [
    { value: 'opt1', label: 'Option 1' },
    // ...
  ],

  // Required functions
  read: (state) => {
    // Extract current value from radio state
    // Return undefined if not available
    return state.af.raw;
  },

  apply: async (radio, newValue) => {
    // Apply user input to radio
    // radio parameter is the RadioController instance
    await radio.sendCommand(radio.driver.cmdSetAF(newValue));
  }
}
```

### Control Groups

Controls are organized by group, which maps to tabs in the UI:

- **primary**: Band, Mode, Frequency (main controls)
- **audio**: AF Gain, RF Gain, Squelch (receive audio)
- **transmit**: PTT, TX Power, Speech Comp, Monitor (transmission)
- **filter**: Filter Width, AGC, Noise Blanker (DSP/filtering)
- **offset**: RIT, XIT, Split (frequency offsets)
- **advanced**: VFO Lock, Tuning Step, ATU, Meter Type

### Example Control Definitions

```javascript
// Range slider
{
  id: 'af', label: 'AF Gain', kind: 'range', group: 'audio',
  min: 0, max: 255, step: 1,
  read: (state) => state.af?.raw,
  apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetAF(v))
}

// Toggle checkbox
{
  id: 'ptt', label: 'PTT', kind: 'toggle', group: 'transmit',
  read: (state) => !!state.ptt,
  apply: async (radio, on) => radio.setPTT(on)
}

// Button grid
{
  id: 'mode', label: 'Mode', kind: 'button-grid', group: 'primary', cols: 3,
  buttons: this.availableModes().map(m => ({ value: m, label: m })),
  read: (state) => state.mode,
  apply: async (radio, mode) => radio.setMode(mode)
}

// Select dropdown
{
  id: 'filtertype', label: 'Filter', kind: 'select', group: 'filter',
  options: [
    { value: 'wide', label: 'Wide' },
    { value: 'mid', label: 'Mid' },
    { value: 'narrow', label: 'Narrow' }
  ],
  read: (state) => state.filtertype,
  apply: async (radio, v) => radio.sendCommand(radio.driver.cmdSetFilter(v))
}
```

---

## Band Support

### Standard Amateur Radio Bands (USA)

All drivers should support detection and quick-switching between these bands:

```javascript
const BANDS = [
  { name: '160m', min: 1800000, max: 2000000 },
  { name: '80m',  min: 3500000, max: 4000000 },
  { name: '60m',  min: 5330500, max: 5406500 },
  { name: '40m',  min: 7000000, max: 7300000 },
  { name: '30m',  min: 10100000, max: 10150000 },
  { name: '20m',  min: 14000000, max: 14350000 },
  { name: '17m',  min: 18068000, max: 18168000 },
  { name: '15m',  min: 21000000, max: 21450000 },
  { name: '12m',  min: 24890000, max: 24990000 },
  { name: '10m',  min: 28000000, max: 29700000 },
  { name: '6m',   min: 50000000, max: 54000000 },
  { name: '2m',   min: 144000000, max: 148000000 },
  { name: '70cm', min: 420000000, max: 450000000 }
];

function getBandFromFreq(hz) {
  for (const band of BANDS) {
    if (hz >= band.min && hz <= band.max) return band.name;
  }
  return '?';
}
```

### Radio-Specific Bands

If your radio supports additional bands (e.g., satellite, microwave), add them to your band list:

```javascript
const BANDS = [
  // ... standard bands ...
  { name: 'SAT', min: 420000000, max: 430000000 },
  { name: '23cm', min: 1240000000, max: 1325000000 }
];
```

---

## Mode Support

### Mode Encoding Strategy

Radios use different mode encoding. Common patterns:

**Icom CI-V:**
```
0x00 = LSB
0x01 = USB
0x02 = AM
0x03 = CW
0x04 = RTTY
0x05 = FM
0x07 = CW-R (reverse)
0x08 = RTTY-R
0x17 = DV
```

**Yaesu ASCII CAT:**
```
"1" = LSB
"2" = USB
"3" = CW-U
"4" = CW-L
"5" = AM
"6" = WFM
"7" = FM
"A" = RTTY-L
"B" = RTTY-U
"C" = DIG-L
"D" = DIG-U
```

Always create a bidirectional mode map:

```javascript
const MODE_MAP = {
  // Named mode → Radio code
  toRadio: {
    'LSB': 0x00,
    'USB': 0x01,
    'AM': 0x02,
    // ...
  },
  // Radio code → Named mode
  fromRadio: {
    0x00: 'LSB',
    0x01: 'USB',
    0x02: 'AM',
    // ...
  }
};
```

---

## Radio State Object

The radio state is built incrementally as frames are parsed. Standard state properties:

```javascript
{
  freqHz: number,                    // VFO A frequency in Hz
  mode: string,                      // 'LSB', 'USB', 'AM', etc.
  ptt: boolean,                      // True if transmitting
  rxTxStatus: boolean,               // RX when false, TX when true
  
  smeter: {
    raw: 0-255,                      // Raw ADC value
    dbm: number                      // Converted dBm (if calibrated)
  },
  
  txpwr: {
    raw: 0-255 or 0-100,             // Raw power value
    watts: number                    // Converted watts (optional)
  },
  
  af: { raw: 0-255 },                // AF (volume) gain
  rf: { raw: 0-255 },                // RF gain
  sql: { raw: 0-255 },               // Squelch level
  
  compression: { raw: 0-255 },       // Speech compressor
  monitor: { raw: 0-255 },           // Monitor level
  
  filterbw: { raw: 0-255 },          // Filter bandwidth
  agc: { raw: 0-3, mode: string },   // AGC mode
  
  rit: { hz: number, on: boolean },  // RIT offset
  xit: { hz: number, on: boolean },  // XIT offset
  
  vfolock: { on: boolean },          // VFO lock
  atu: { on: boolean, tuned: boolean }, // Antenna tuner
  
  extras: {
    datamode: boolean,               // Digital mode active
    // ... radio-specific
  }
}
```

---

## Protocol Implementations

### Icom CI-V (Common Interface - Voice)

**Frame Format:**
```
[0xFE 0xFE] [RADIO_ADDR] [CTRL_ADDR] [PAYLOAD...] [0xFD]
```

**Example:** Read frequency from IC-7300 (0x94):
```
TX: FE FE 94 E0 03 FD
RX: FE FE E0 94 03 00 40 07 14 00 FD
```

**Implementation Template:**

```javascript
class IcomCivTransport {
  constructor({ radioAddr = 0x94, ctrlAddr = 0xE0 } = {}) {
    this.radioAddr = radioAddr;
    this.ctrlAddr = ctrlAddr;
  }

  buildFrame(payloadBytes) {
    const out = new Uint8Array([
      0xFE, 0xFE,
      this.radioAddr,
      this.ctrlAddr,
      ...payloadBytes,
      0xFD
    ]);
    return out;
  }
}

class IcomRadioDriver {
  extractFrames(rxBuf) {
    const frames = [];
    while (true) {
      // Look for [FE FE ... FD]
      const start = rxBuf.indexOf(0xFE);
      if (start === -1 || start + 1 >= rxBuf.length) break;
      if (rxBuf[start + 1] !== 0xFE) {
        rxBuf.splice(0, start + 1);
        continue;
      }
      
      const end = rxBuf.indexOf(0xFD, start + 2);
      if (end === -1) break;
      
      frames.push(rxBuf.slice(start, end + 1));
      rxBuf.splice(0, end + 1);
    }
    return frames;
  }

  parseFrame(u8) {
    if (u8.length < 6 || u8[0] !== 0xFE || u8[1] !== 0xFE) return [];
    
    const radioAddr = u8[2];
    const ctrlAddr = u8[3];
    const cmd = u8[4];
    const rest = u8.slice(5, -1);  // exclude [FE FE] prefix and [FD] suffix
    
    if (cmd === 0x03) {  // Frequency read response
      const hz = this._decodeFreqHz(rest);
      return hz != null ? [{ type: 'freq', hz }] : [];
    }
    // ... more command handlers
    
    return [];
  }

  _decodeFreqHz(bcdBytes) {
    // Convert BCD-packed bytes to Hz
    // IC-7300: 5 bytes, little-endian, 10Hz resolution
    if (!bcdBytes || bcdBytes.length < 5) return null;
    
    let hz = 0;
    for (let i = 0; i < 5; i++) {
      const byte = bcdBytes[i];
      const lo = byte & 0x0F;
      const hi = (byte >> 4) & 0x0F;
      hz += (lo * Math.pow(10, i * 2));
      hz += (hi * Math.pow(10, i * 2 + 1));
    }
    return hz * 10;  // multiply by 10 for 10Hz resolution
  }
}
```

### Yaesu ASCII CAT (FT-991A)

**Frame Format:**
```
[COMMAND_STRING];
```

**Example:** Read frequency:
```
TX: IF;
RX: IF00014230000+0000000;
```

**Implementation Template:**

```javascript
class YaesuAsciiDriver {
  extractFrames(rxBuf) {
    const frames = [];
    const textDecoder = new TextDecoder('ascii', { fatal: false });
    
    while (true) {
      const text = textDecoder.decode(rxBuf);
      const end = text.indexOf(';');
      if (end === -1) break;
      
      const frame = text.substring(0, end);
      frames.push(frame);
      rxBuf.splice(0, (new TextEncoder().encode(frame + ';')).length);
    }
    return frames;
  }

  parseFrame(frameStr) {
    const responses = [];
    
    if (frameStr.startsWith('IF')) {
      // IF response: IF[freq(11)][+/-][mode(1)][filter][mode2] ;
      const freqStr = frameStr.substring(2, 13);
      const freq = parseInt(freqStr, 10) * 10;  // 10Hz resolution
      const mode = frameStr[15];
      responses.push({ type: 'freq', hz: freq });
      responses.push({ type: 'mode', mode: this._modeFromCode(mode) });
    }
    // ... more response handlers
    
    return responses;
  }
}
```

### Yaesu 5-Byte CAT (FT-857D)

**Frame Format:**
```
[BYTE1] [BYTE2] [BYTE3] [BYTE4] [OPCODE]
```

**Example:** Set frequency:
```
TX: 70 40 10 00 01  (7.040 MHz, opcode 0x01)
RX: (no response for SET commands)
```

---

## Testing & Validation

### Unit Tests

Test each driver method independently:

```javascript
test('IC-7300 mode command', () => {
  const driver = new IcomIC7300Driver();
  
  const lsb = driver.cmdSetMode('LSB');
  expect(lsb[0]).toEqual(Uint8Array.from([0xFE, 0xFE, 0x94, 0xE0, 0x06, 0x00, 0xFD]));
  
  const usb = driver.cmdSetMode('USB');
  expect(usb[0]).toEqual(Uint8Array.from([0xFE, 0xFE, 0x94, 0xE0, 0x06, 0x01, 0xFD]));
});
```

### Session Recording & Replay

Record real radio interactions:

```bash
node tools/record-session.js --driver icom.ic7300 --port COM3 --duration 10000
# Produces: data/sessions/ic7300-full.json
```

Use recorded session for E2E testing:

```javascript
test('IC-7300 E2E with real session', async ({ page }) => {
  await page.goto('/?mockSession=data/sessions/ic7300-full.json');
  // ... assertions
});
```

### Validation Checklist

- [ ] All `cmdRead*()` methods implemented
- [ ] All `cmdSet*()` methods implemented for supported features
- [ ] `extractFrames()` handles incomplete/malformed data
- [ ] `parseFrame()` handles all expected response types
- [ ] `availableModes()` returns all supported modes
- [ ] `controlsSchema()` has read/apply functions for all controls
- [ ] Band detection works via `getBandFromFreq()`
- [ ] `pollSequence()` returns safe, non-blocking commands
- [ ] Unit tests pass
- [ ] E2E tests pass with recorded session
- [ ] Console output is readable (formatTx/formatRx)

---

## Reference Implementations

### Minimal Driver (Skeleton)

```javascript
(function (global) {
  'use strict';
  const WebCAT = global.WebCAT;
  if (!WebCAT) throw new Error('webcat-base.js must be loaded first');

  class MinimalRadioDriver {
    constructor(options = {}) {
      this.interCommandDelayMs = 20;
    }

    serialOptions() {
      return { dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' };
    }

    availableModes() {
      return ['LSB', 'USB', 'AM', 'CW', 'FM'];
    }

    // Read commands
    cmdReadFreq() { /* TODO */ }
    cmdReadMode() { /* TODO */ }
    cmdReadRxTxStatus() { /* TODO */ }

    // Write commands
    cmdSetFreqHz(hz) { /* TODO */ }
    cmdSetMode(modeName) { /* TODO */ }
    cmdSetPTT(on) { /* TODO */ }

    extractFrames(rxBuf) { return []; }
    parseFrame(u8) { return []; }
    pollSequence(ctx) { return []; }

    controlsSchema() {
      return [
        {
          id: 'freq', label: 'Frequency', kind: 'range', group: 'primary',
          min: 1800000, max: 450000000, step: 10,
          read: (state) => state.freqHz,
          apply: async (radio, hz) => radio.setFrequencyHz(hz)
        }
      ];
    }

    formatTx(u8) { return `TX: ${WebCAT.utils.bytesToHex(u8)}`; }
    formatRx(u8) { return `RX: ${WebCAT.utils.bytesToHex(u8)}`; }
  }

  WebCAT.registerDriver(
    'example.minimal',
    (opts) => new MinimalRadioDriver(opts),
    { label: 'Minimal Example', defaultBaud: 19200 }
  );
})(typeof window !== 'undefined' ? window : global);
```

### Full Featured Driver

See `webcat-icom-ic7300.js` for a complete, production-ready example with:
- CI-V protocol implementation
- 30+ read/write commands
- Full state parsing
- 18 control schema definitions
- All bands and modes
- Meter calibration
- Advanced features (RIT, XIT, ATU, etc.)

---

## Best Practices

1. **Error Handling**: Gracefully handle invalid responses, timeouts, and malformed frames
2. **Logging**: Use `formatTx()` and `formatRx()` for readability
3. **State Caching**: Minimize unnecessary reads; use polling strategy efficiently
4. **Command Queueing**: Respect `interCommandDelayMs` between commands
5. **Defaults**: Always provide sensible defaults for constructor options
6. **Documentation**: Include radio manual references and CI-V command sheets
7. **Testing**: Record real sessions and use for replay testing
8. **Extensibility**: Design controls to be easily extended for firmware variants

---

## Related Documentation

- [README.md](../README.md) - Project overview
- [ARCHITECTURE.md](../ARCHITECTURE.md) - System architecture
- [docs/testing.md](testing.md) - Testing strategy
- Radio manuals (linked from each driver)

---

**Last Updated:** January 2026  
**Version:** 1.0  
**Audience:** Driver developers, contributors, CI/CD systems
