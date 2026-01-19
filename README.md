# WebCAT - Distributed Ham Radio Control & Logging

A browser-based, hardware-agnostic ham radio control system optimized for field operations, contesting, and multi-operator events.

## Vision

**WebCAT** (Web-based Communications and Amateur Transceiver) enables:
- **Distributed-first**: Multiple stations share a unified log over LAN (MQTT)
- **Hardware-agnostic**: Works with any radio via pluggable drivers (Icom CI-V, Yaesu CAT, Hamlib)
- **Field-ready**: Optimized for Field Day, SOTA, POTA, contesting
- **Platform-neutral**: Browser-based (Windows/Linux/Mac) or native (Electron/Tauri)

See [agents.md](agents.md) for full architecture and roadmap.

## Quick Start

### 1. Install
```bash
npm install
```

### 2. Start the server
```bash
npm start
# Runs on http://localhost:8080
```

### 3. Open the UI
```
http://localhost:8080
```

Then:
- Select your radio driver from the dropdown
- Click "Connect" and choose your serial port
- Use the Radio tab to tune frequency, change mode, adjust controls
- Use the Log tab to enter QSOs
- Use the Console tab for debug messages

## Architecture

```
Browser (Vue 3 app)
    ↓
webcat-base.js (RadioController + driver registry)
    ↓
drivers/ (Radio-specific CAT protocol handlers)
    ↓
WebSerial API → USB/Serial port → Radio
```

**Data flow:**
1. User selects driver + baud, clicks "Connect"
2. RadioController opens WebSerial port
3. Driver's `parseFrame()` decodes responses
4. `update` events fire with new radio state
5. Vue UI displays frequency, mode, controls
6. User clicks controls → `cmd*()` functions generate commands → bytes sent to radio
7. Each QSO logged to SQLite + MQTT broadcast to other stations (LAN sync)

## Files

| File | Purpose |
|------|---------|
| `webcat-base.js` | Core library: RadioController, driver registry |
| `drivers/webcat-*.js` | Radio drivers (Icom IC-7300/9700, Yaesu FT-991A/857D) |
| `index.html` | Main Vue 3 app (radio control + logging) |
| `components/*.js` | Vue components (radio-panel, qso-form, console-panel) |
| `server.js` | Node.js backend: Express + SQLite + MQTT broker |
| `tests/` | Playwright test suite (session capture/replay) |
| `tools/` | Utilities (record-session.js, mock-serial.js, validate-session.js) |
| `ARCHITECTURE.md` | Detailed codebase guide |
| `docs/testing.md` | Session fixture capture/replay guide |

## Drivers

| Driver | Radio | Protocol | Status |
|--------|-------|----------|--------|
| `icom.ic7300` | Icom IC-7300 | CI-V (0xFE...) | ✅ Complete |
| `icom.ic9700` | Icom IC-9700 | CI-V | ✅ Complete |
| `yaesu.ft991a` | Yaesu FT-991A | ASCII CAT | ✅ Complete |
| `yaesu.ft857d` | Yaesu FT-857D | Binary CAT | ✅ Complete |
| `hamlib.*` | ~300 radios | Hamlib rigctl bridge | 🔄 Planned |

## Testing

Run the Playwright test suite (validates UI + drivers without hardware):

```bash
npm test              # Run all tests
npm run test:ui       # Interactive test UI
npm run test:headed   # Browser visible
```

Tests use **session fixtures** (real CAT traffic captured from radios):
```bash
node tools/record-session.js --port COM3 --driver icom.ic7300 --out data/sessions/ic7300-full.json
```

See [docs/testing.md](docs/testing.md) for full details.

## Multi-Station Sync (LAN)

Each station runs its own server. QSOs and radio state sync via MQTT:

```
Station A              Station B              Station C
[server]──MQTT───────[server]──────MQTT─────[server]
  ↓                     ↓                       ↓
[UI]                  [UI]                    [UI]
  ↓                     ↓                       ↓
[IC-7300]           [FT-991A]              [IC-9700]
```

Real-time duplicate checking and unified log view (planned in v0.3).

## Browser Support

- ✅ Chrome 89+
- ✅ Edge 89+
- ✅ Firefox 102+ (partial, WebSerial via manifest)
- ❌ Safari (no WebSerial API yet)

## Development

### Add a new driver

1. Create `drivers/webcat-vendor-model.js`
2. Implement `parseFrame()`, `cmdSetFreq()`, `cmdSetMode()`, `controlsSchema()`
3. Call `registerDriver('vendor.model', factory, { label, defaultBaud })`
4. Test with: `npm test`

Example: [drivers/webcat-icom-ic7300.js](drivers/webcat-icom-ic7300.js)

### Code structure

See [ARCHITECTURE.md](ARCHITECTURE.md) for:
- RadioController lifecycle
- Driver interface contract
- Error handling patterns
- Contributing guidelines

## Troubleshooting

**"No ports available"** → Check USB cable, restart browser

**"Frequency not updating"** → Enable verbose mode (checkbox in UI), check console for parse errors

**"Mode list is empty"** → Driver's `availableModes()` may not match radio; file an issue

## License

MIT - Use for any ham radio purpose.

## References

- [ARRL](https://www.arrl.org/) - Amateur Radio Relay League
- [Hamlib](https://github.com/Hamlib/Hamlib) - Radio control library
- [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API)
- [ADIF Spec](https://adif.org/) - Amateur Data Interchange Format
  await radio.setPTT(false);
</script>
```

## Base Library API

### `WebCAT.registerDriver(id, factory, meta)`
Registers a driver.

- `id` string like `"yaesu.ft991a"`
- `factory(options) => driverInstance`
- `meta` is shown in the demo UI and used for defaults:
  - `label`
  - `defaultBaud`
  - `allowedBauds`
  - `needsAddr` (true/false)
  - `defaultAddrHex` (if `needsAddr`)

### `WebCAT.listDrivers()`
Returns array of registered drivers.

### `WebCAT.getDriverMeta(id)`
Returns meta for a driver.

### `new WebCAT.SettingsStore(namespace)`
Persists UI + port-hint in localStorage.

- `loadUI()`, `saveUI(patch)`
- `savePortHint(info)`, `loadPortHint()`
- `clearAll()`

### `new WebCAT.RadioController({ driverId, driverOptions, store })`
Main class you use.

#### Events
- `radio.on('log', (line) => {})`
- `radio.on('update', (state) => {})`
- `radio.on('connected', (info) => {})`
- `radio.on('disconnected', () => {})`
- `radio.on('error', (err) => {})`

#### Connection
- `await radio.connectWithPicker({ baudRate, rememberPort=true })`
- `await radio.connectRemembered({ baudRate })`
- `await radio.disconnect()`

#### Polling
- `radio.startPolling(intervalMs)`
- `radio.stopPolling()`

#### Control
- `await radio.setFrequencyHz(hz)`
- `await radio.setFrequencyMHz(mhz)`
- `await radio.setMode(modeName)`
- `await radio.setPTT(true|false)`

## Driver Interface

A driver is an object created by the factory. It must implement:

- `serialOptions() -> { dataBits, stopBits, parity, flowControl }` *(optional; defaults to 8N1)*
- `extractFrames(rxBuf, ctx) -> Array<Uint8Array | {bytes:Uint8Array,...}>`
- `parseFrame(frame, ctx) -> Array<events>`
- `pollSequence(ctx) -> Array<Uint8Array>`

Optional:

- `interCommandDelayMs` number (helps with CAT pacing)
- `onCommandSent(u8, ctx)` (useful when replies are fixed-length and need expectation tracking)
- `formatTx(u8)` / `formatRx(u8)` for nicer logs

Control helpers (controller uses these if present):

- `cmdSetFreqHz(hz, ctx) -> Uint8Array`
- `cmdSetMode(modeName, ctx) -> Uint8Array`
- `cmdSetPTT(on, ctx) -> Uint8Array`

Read helpers (optional, used for quick refresh after setting):

- `cmdReadFreq()` / `cmdReadMode()` / `cmdReadRxTxStatus()`
- `cmdReadFreqMode()` (used by FT-857D)

## Notes

- WebSerial requires **https** or **http://localhost**.
- Remembered ports: browsers do **not** allow serial port objects to be stored directly. The library stores a *vendor/product hint* and uses `navigator.serial.getPorts()` for already-authorized devices.

## Running the demo

Option A — Minimal Node server (static + MQTT over WebSocket):

```bash
cd WebCAT
npm install
npm start
```

Open `http://localhost:8080/app.html` (new dynamic UI) or `demo.html`. A built-in MQTT broker is available at `ws://localhost:8080/mqtt`. The page will automatically publish state and logs if reachable.

Option B — Any static server (no MQTT features):

```bash
cd WebCAT
python3 -m http.server 8080
```

Then open `http://localhost:8080/app.html` or `demo.html`.

### Presets and On-Connect Behavior (app.html)

- Choose "Load from Radio" to start polling state immediately after connect.
- Choose "Apply Preset" to load a JSON preset of control values, apply those to the radio first, then start polling.
- Use "Save Current as Preset" to export the current state as a JSON file.

Preset JSON format:

```json
{
  "controls": {
    "frequencyMHz": 7.074,
    "mode": "USB-D",
    "txpwr": 180,
    "agc": 2
  }
}
```

### MQTT in the Browser

If you run the Node server, the UI includes a tiny MQTT shim (`webcat-mqtt.js`) and the MQTT.js CDN. It will:

- Connect to `ws://<host>:<port>/mqtt`
- Publish `webcat/state` on every radio update
- Publish `webcat/logs` for UI log lines
- Publish `webcat/events` for connect/disconnect

You can subscribe from another browser tab or host using MQTT over WebSockets (e.g., via another app or a simple page using MQTT.js).

