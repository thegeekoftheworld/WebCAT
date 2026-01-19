# WebCAT Architecture & Codebase Guide

## Overview

WebCAT is a distributed ham radio control and logging system. The codebase is organized into:

- **Core Library** (`webcat-base.js`) - Radio controller, driver registry, WebSerial bridge
- **Drivers** (`drivers/`) - Radio-specific CAT protocol handlers (Icom CI-V, Yaesu ASCII/binary)
- **Server** (`server.js`) - Node.js backend for SQLite logging, REST API, MQTT broker
- **UI** (`index.html`, `components/`) - Vue 3 app for radio control + QSO logging
- **Testing** (`tests/`, `tools/`) - Playwright test suite, session capture/replay fixtures

## Directory Structure

```
webcat/
├── webcat-base.js              ← Core library (registry + RadioController)
├── webcat-mqtt.js              ← MQTT utilities (future: multi-station sync)
├── server.js                   ← Express + SQLite + Aedes MQTT broker
├── index.html                  ← Main Vue 3 app
├── demo.html                   ← Deprecated test harness (REMOVE)
├── package.json
├── playwright.config.js        ← Browser automation test config
│
├── drivers/
│   ├── webcat-icom-ic7300.js   ← IC-7300 CI-V driver
│   ├── webcat-icom-ic9700.js   ← IC-9700 CI-V driver
│   ├── webcat-yaesu-ft991a.js  ← FT-991A ASCII CAT driver
│   └── webcat-yaesu-ft857d.js  ← FT-857D 5-byte CAT driver
│
├── components/
│   ├── radio-panel.js          ← Radio control UI (freq, mode, PTT, controls)
│   ├── qso-form.js             ← QSO log entry + dupe check
│   └── console-panel.js        ← Debug console output
│
├── tools/
│   ├── record-session.js       ← Record real CAT traffic for fixtures
│   ├── mock-serial.js          ← Browser-side synthetic navigator.serial
│   └── validate-session.js     ← Parse fixture to verify driver coverage
│
├── tests/
│   └── mock-session.spec.js    ← Playwright test suite (6 tests, all passing)
│
├── data/
│   └── sessions/
│       └── ic7300-full.json    ← Session fixture (343 frames from IC-7300)
│
├── docs/
│   ├── ARCHITECTURE.md         ← This file
│   └── testing.md              ← Session capture/replay guide
│
└── logs/                       ← Runtime logs (JSONL) + SQLite DB
```

## Core Concepts

### RadioController

The main class that manages a radio connection. Located in `webcat-base.js`.

```javascript
const radio = new WebCAT.RadioController({
  driverId: 'icom.ic7300',
  verbose: true
});

radio.on('update', state => console.log(state)); // {freqHz, mode, ptt, ...}
radio.on('error', err => console.error(err));

await radio.connectWithPicker({ baudRate: 19200 });
await radio.setFrequencyHz(14074000);
await radio.setPTT(true);
radio.startPolling(200); // ms
```

**Events:**
- `'log'` - debug messages
- `'update'` - radio state changed {freqHz, mode, ptt, power, ...}
- `'error'` - connection/protocol error
- `'connected'` - serial port opened successfully
- `'disconnected'` - serial port closed

### Driver Architecture

Each driver is a factory function registered globally via `registerDriver()`.

**Driver interface:**
```javascript
{
  // Protocol parsing
  parseFrame(buffer) -> events: [{type, payload: {freq, mode, ...}}, ...]
  
  // Command generation
  cmdReadFreq() -> Uint8Array
  cmdSetFreq(freqHz) -> Uint8Array
  cmdSetMode(mode) -> Uint8Array
  cmdSetPTT(on) -> Uint8Array
  
  // Dynamic UI schema
  controlsSchema() -> [{id, label, kind, options/min/max, read(), apply()}]
  
  // Metadata
  availableModes() -> ['USB', 'LSB', 'AM', 'CW', ...]
}
```

**Examples:**
- `webcat-icom-ic7300.js` - Icom CI-V protocol (0xFE 0xFE 0x94 ...)
- `webcat-yaesu-ft991a.js` - Yaesu ASCII CAT (serial strings)
- `webcat-yaesu-ft857d.js` - Yaesu 5-byte binary CAT

### Web UI (Vue 3)

The app in `index.html` creates a Vue instance with:

**Data:**
- `radio` - connection state {connected, driver, freq, mode, ptt, state}
- `qso` - current contact form {call, freq, mode, rst_sent, rst_rcvd}
- `config` - UI settings {driver, baud, poll}
- `logs` - console output
- `controls` - dynamic controls from driver.controlsSchema()

**Tabs:**
1. **Radio** - Frequency adjustment, mode, PTT, dynamic controls
2. **Log** - QSO entry, dupe checking, recent contacts
3. **Console** - Real-time log messages

### Server API

Node.js backend (`server.js`) provides:

```
GET  /api/health              → {ok, time}
POST /api/qsos                → {id, timestamp, ...} (create QSO)
GET  /api/qsos?limit=50       → {ok, total, qsos: [...]}
GET  /api/qsos/dupe/:call     → {dupe: boolean}
POST /api/logs                → {source, ...}
WS   /mqtt                    → Aedes MQTT broker
```

**Database:** SQLite with `qsos` table (id, call, freq, mode, operator, timestamp, synced, ...)

### Testing: Session Capture & Replay

The test harness captures real CAT traffic into JSON fixtures, then replays them deterministically.

**Capture:**
```bash
node tools/record-session.js --port COM3 --driver icom.ic7300 --out data/sessions/ic7300-full.json
```

**Fixture format:**
```json
{
  "driver": "icom.ic7300",
  "frames": [
    {"dir": "out", "data": "FEFEXX94E005FD", "time": 10},
    {"dir": "in",  "data": "FEFEXX9405HHHHHFDD", "time": 20},
    ...
  ]
}
```

**Replay (browser):**
- `tools/mock-serial.js` injects synthetic `navigator.serial` 
- Playwright test loads fixture via `addInitScript`
- Tests validate UI without real hardware

## Alignment with Vision

**Distributed-first:** MQTT sync (webcat-mqtt.js) not yet complete. Requires:
- [ ] Multi-station discovery via MQTT
- [ ] Real-time QSO sync across LAN
- [ ] Duplicate checking across all stations
- [ ] Presence detection (who's online)

**Hardware-agnostic:** Driver system is extensible. To add a new radio:
1. Create `drivers/webcat-<mfg>-<model>.js`
2. Implement parseFrame(), cmd* functions, controlsSchema()
3. Call `registerDriver('vendor.model', factory, meta)`
4. UI automatically discovers it

**Field Day ready:** Event-specific features pending:
- [ ] Event type selector (Field Day, SOTA, POTA, generic)
- [ ] Exchange field definitions per event
- [ ] Class/section tracking for Field Day
- [ ] Export to ADIF

## Code Quality Checklist

### Files to Review/Clean

- ✅ `webcat-base.js` - Well-documented, solid driver registry
- ⚠️ `webcat-mqtt.js` - Exists but not integrated; needs implementation
- ✅ `index.html` - Clean Vue 3 app, good tab structure
- ⚠️ `components/` - Working but minimal; radio-panel lacks PTT visual
- ✅ `server.js` - Functional, good SQLite/MQTT integration
- ✅ `drivers/` - All 4 drivers implemented, parsing correct
- ⚠️ `tools/mock-serial.js` - Infinite read() loop; see testing.md workaround
- ✅ `tests/mock-session.spec.js` - 6 tests, all passing
- ❌ `demo.html` - DEPRECATED; remove
- 🔧 `.gitignore` - Add test-results/, playwright-report/, logs/

### Documentation

- ✅ `README.md` - Quick start good, but vague on testing
- ✅ `ARCHITECTURE.md` - This document
- ✅ `docs/testing.md` - Session capture guide (complete)
- ⚠️ `agents.md` - Vision doc; move to `docs/VISION.md`
- ❌ JSDoc comments on WebCAT exports (add)
- ❌ Error handling patterns (document)

### Testing

- ✅ Playwright test suite (6 tests, 100% pass)
- ✅ Session fixtures captured
- ⚠️ No unit tests for drivers (parse/command generation)
- ⚠️ No end-to-end tests with real radio
- ⚠️ No integration tests for server API

## Next Steps (Priority Order)

### P0 - Vision Alignment
1. Implement MQTT multi-station sync (webcat-mqtt.js)
2. Add event type UI (Field Day, SOTA, POTA)
3. Hamlib rigctl bridge driver for ~300 radios

### P1 - Code Quality
1. Add JSDoc to WebCAT.* exports
2. Document error handling patterns
3. Add unit tests for driver parse/command functions
4. Move agents.md → docs/VISION.md
5. Remove demo.html

### P2 - UI/UX
1. Add PTT visual indicator (LED)
2. Implement real-time frequency/mode display
3. Add keyboard shortcuts (PTT, mode switch, freq +/-)
4. Mobile-friendly responsive design

### P3 - Field Operations
1. Offline mode (IndexedDB cache)
2. ADIF export
3. Cluster integration (DX spot feed)
4. Performance optimization (virtual scroll for 10k+ QSOs)

## Contributing

When adding a new driver:
1. Create `drivers/webcat-<id>.js` following existing patterns
2. Implement `parseFrame()`, all `cmd*()` methods, `controlsSchema()`
3. Add metadata: `registerDriver(id, factory, { label, defaultBaud, ... })`
4. Record a session fixture: `node tools/record-session.js --driver <id>`
5. Add tests to `tests/mock-session.spec.js`
6. Document in README.md

When modifying the core:
1. Ensure backward compatibility with existing drivers
2. Add JSDoc for new exports
3. Run test suite: `npm test`
4. Update ARCHITECTURE.md if structure changes
