# WebCAT Session Capture & Replay

This flow records real CAT traffic from a radio (e.g., COM3) into JSON fixtures and replays them in the browser for deterministic UI/driver tests.

## Prereqs
- Node 18+
- Install tooling: `npm install serialport minimist`

## Capture from a real radio
1) Connect the radio (example COM3). Ensure baud matches the rig.
2) Run the recorder:
   ```sh
   node tools/record-session.js --port COM3 --driver icom.ic7300 --baud 19200 --out data/sessions/ic7300-smoke.json --notes "stock mic, dummy load"
   ```
   Flags:
   - `--driver` one of `icom.ic7300`, `icom.ic9700`, `yaesu.ft991a`, `yaesu.ft857d`
   - `--baud` overrides driver default
   - `--freq`, `--mode`, `--txpwr`, `--comp`, `--filterbw`, `--polls`, `--pollDelay` optionally tweak the exercise
3) The fixture is written to `data/sessions/<driver>-capture.json` (or your `--out` path).

The recorder uses the real driver + RadioController, runs a short exercise (freq/mode/PTT/power/filter/etc.), and captures every outbound/inbound frame with timestamps.

## Replay in the browser (mock serial)
1) Ensure `tools/mock-serial.js` is loaded (already referenced in index.html).
2) Serve the app (e.g., `npx http-server .`), then open with a mock query:
   ```
   http://localhost:8080/index.html?mockSession=data/sessions/ic7300-smoke.json&mockSpeed=8
   ```
   Options:
   - `mockSession` (or `mock`) path to the JSON fixture
   - `mockRealtime=1` to respect recorded timing (default is accelerated)
   - `mockSpeed` divisor for timing when accelerated (8 = 8x faster)
3) Click Connect; the app will use the mock serial provider instead of hardware.

## Contributing new fixtures
- Record with: `node tools/record-session.js --port <COMx> --driver <id> --out data/sessions/<id>-<label>.json --notes "firmware X.Y, antenna"`
- Keep one short “smoke” capture per rig plus any special modes (digital, split, satellite) as separate files.
- Add a brief note in the filename or `--notes` so others know the context.

## Why this helps
- Deterministic UI/driver tests without hardware.
- Faster iteration: run against fixtures in CI and locally.
- Easy to expand coverage: same flow works for any new driver once registered.
