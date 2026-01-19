# WebCAT (WebSerial Ham Radio Control Library)

A small browser-side JavaScript library that lets you talk to radios over **WebSerial** using a **base controller** plus **driver add-ons**.

- Load `webcat-base.js` first.
- Load one or more driver files (e.g., `drivers/webcat-yaesu-ft991a.js`).
- Create a `WebCAT.RadioController` and control the radio through the controller API.

This is designed so you can reuse the same drivers across multiple pages/apps.

## Files

- `webcat-base.js` — base library (registry + controller)
- `drivers/webcat-icom-ic9700.js` — Icom IC-9700 CI-V driver
- `drivers/webcat-yaesu-ft991a.js` — Yaesu FT-991A ASCII CAT driver (includes your calibrations as defaults)
- `drivers/webcat-yaesu-ft857d.js` — Yaesu FT-857D 5-byte CAT driver (8N2)
- `demo.html` — simple test harness

## Quick Start

```html
<script src="webcat-base.js"></script>
<script src="drivers/webcat-yaesu-ft991a.js"></script>
<script>
  const RS = window.WebCAT;
  const store = new RS.SettingsStore('my_app');

  const radio = new RS.RadioController({
    driverId: 'yaesu.ft991a',
    driverOptions: {
      // optional overrides
      // swrPoints: [...], voltPoints: [...], ampPerRaw: 0.1,
    },
    store
  });

  radio.on('log', console.log);
  radio.on('update', (state) => console.log('state', state));

  // First time (requires user gesture):
  await radio.connectWithPicker({ baudRate: 38400, rememberPort: true });

  // Auto-poll
  radio.startPolling(200);

  // Control
  await radio.setFrequencyMHz(146.520);
  await radio.setMode('FM');
  await radio.setPTT(true);
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

Serve the folder with any static server:

```bash
cd radio-serial-lib
python3 -m http.server 8080
```

Then open:

- `http://localhost:8080/demo.html`

