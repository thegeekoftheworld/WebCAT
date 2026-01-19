# WebCAT Vision & Architecture

**WebCAT** (Web-based Communications and Amateur Transceiver) is a distributed ham radio control and logging system designed for field operations, contesting, and multi-operator events.

## Core Philosophy

- **Distributed-first**: Multiple stations, one unified log
- **Hardware-agnostic**: Works with any radio via plugin drivers
- **Platform-neutral**: Runs on Windows, Linux, Raspberry Pi, and potentially Android
- **Leverage existing**: Integrate with Hamlib, remote radio projects, and open standards
- **Not browser-locked**: Web UI for portability, but can run as Electron/Tauri for native feel
- **Event-focused**: Optimized for Field Day, SOTA, POTA, contesting

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser / Native App                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Radio Control│  │ Logging UI   │  │ Station List │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP/WebSocket
┌────────────────────────┴────────────────────────────────────┐
│                    Node.js Server (per station)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ REST API     │  │ WebSerial    │  │ SQLite DB    │      │
│  │ /api/qsos    │  │ Driver Mgr   │  │ (local log)  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │         MQTT Broker (Aedes over WebSocket)        │      │
│  │  Topics: webcat/{event}/qsos, /state, /presence   │      │
│  └──────────────────────────────────────────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │ MQTT sync
┌────────────────────────┴────────────────────────────────────┐
│              Other Stations on LAN (mesh sync)               │
│         Each runs own server, shares via MQTT pub/sub        │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. Driver Architecture (existing, keep)
- **webcat-base.js**: Core controller, WebSerial bridge, event system
- **drivers/**: Pluggable radio-specific protocol handlers
  - Icom CI-V (IC-7300, IC-9700)
  - Yaesu CAT (FT-991A, FT-857D)
  - Future: Hamlib bridge driver for ~300 radios
- Each driver exposes:
  - `controlsSchema()`: Dynamic UI control definitions
  - `pollSequence()`: Status read commands
  - `cmdSet*()`: Write commands for freq/mode/power/etc.

### 2. Node Server (enhanced)
- **Express REST API**:
  - `POST /api/qsos` - Log a contact
  - `GET /api/qsos?event=...` - Query log
  - `GET /api/stations` - List active stations on network
  - `GET /api/health` - Status
- **MQTT Broker** (Aedes):
  - Multi-station coordination
  - Real-time QSO sync across LAN
  - Presence detection (who's online)
- **SQLite Database**:
  - Local durable log
  - ADIF export
  - Sync state tracking
- **Static file serving**: Web UI

### 3. Web UI (rebuild needed)
- **Modern stack**: Vue 3 or React + Vite
- **Components**:
  - Radio control panel (dynamic from driver schema)
  - QSO entry form (call, freq, mode, RST, notes)
  - Live log viewer (filterable, sortable)
  - Station map (who's on LAN, their status)
  - Event config (Field Day class, POTA ref, etc.)
- **Performance**:
  - Virtual scrolling for logs
  - Debounced polling updates
  - Trimmed console (max 200 lines)
- **Offline-capable**: Service worker, IndexedDB cache

### 4. Logging & Event Support
- **ADIF-compatible** contact records
- **Event types**:
  - Field Day (class, section, bonus points)
  - SOTA (summit reference, activator/chaser)
  - POTA (park reference, park-to-park)
  - General contest (exchange fields)
- **Multi-operator**:
  - Operator name per QSO
  - Station ID (for Field Day multi-transmitter)
  - Real-time duplicate checking across all stations

### 5. Multi-Station Coordination
- **MQTT topics**:
  - `webcat/{eventId}/qsos` - New contacts
  - `webcat/{eventId}/state` - Radio state updates
  - `webcat/{eventId}/presence` - Station online/offline
  - `webcat/{eventId}/dupes` - Duplicate warnings
- **Conflict resolution**: Last-write-wins with timestamp
- **Merge strategy**: Each station keeps full log, dedupes on sync

## Technology Choices

### Current Stack
- **Backend**: Node.js, Express, Aedes (MQTT), better-sqlite3
- **Frontend**: Vanilla JS → **Migrate to Vue 3 + Vite**
- **Serial**: Web Serial API (browser) + Node serialport (fallback)
- **Database**: SQLite (local), MQTT (sync)
- **Protocols**: CI-V, Yaesu CAT, future Hamlib bridge

### Future Portability Options
- **Electron**: Native desktop app (Windows/Linux/Mac)
- **Tauri**: Rust-based native (smaller binary)
- **Capacitor**: Android/iOS app (with USB serial)
- **SSH tunnel**: Remote operation over VPN/internet

## Hamlib Integration Strategy

Hamlib supports ~300 radios but is C-based. Integration options:
1. **Rigctl bridge**: Node spawns `rigctld`, talks via TCP (localhost:4532)
2. **Native binding**: Use `node-ffi` to call libhamlib directly
3. **Wrapper driver**: WebCAT driver that proxies to rigctl

**Recommendation**: Start with rigctl TCP bridge for maximum compatibility.

## Deployment Scenarios

### Single Station
- Runs local Node server on localhost:8080
- Browser connects via http://localhost:8080
- Logs to local SQLite
- No MQTT needed (single operator)

### Multi-Station LAN (Field Day)
- Each station runs own server on local network
- Auto-discover via mDNS or manual IP entry
- MQTT mesh: all stations subscribe to `webcat/{eventId}/#`
- Unified log view across all stations
- Real-time dupe checking

### Remote Operation
- Run server on station PC (Windows/Linux/RPI)
- VPN or SSH tunnel to remote operator
- Browser connects via tunnel
- Full radio control + logging

### Headless/RPI
- Server runs as systemd service
- Web UI accessed from phone/tablet on LAN
- Lightweight: works on Pi Zero 2 W

## Performance Requirements

- **Log viewer**: Support 10,000+ QSOs without lag (virtual scroll)
- **Console**: Trim to 200 lines max
- **Polling**: 200ms default, tunable
- **MQTT**: <50ms latency for QSO sync on LAN
- **UI responsiveness**: <100ms to apply radio changes

## Security Considerations

- **Local-first**: No cloud dependency
- **LAN-only by default**: No internet exposure
- **Optional auth**: Basic auth for multi-op scenarios
- **HTTPS**: Let's Encrypt for remote access setups

## Data Formats

### QSO Record (ADIF + extensions)
```json
{
  "id": "uuid",
  "timestamp": "2026-01-19T12:34:56Z",
  "call": "W1AW",
  "freq": 7074000,
  "mode": "FT8",
  "rst_sent": "599",
  "rst_rcvd": "599",
  "operator": "K1ABC",
  "station_id": "1A",
  "event_type": "field_day",
  "event_data": {
    "class": "1A",
    "section": "CT"
  },
  "notes": "Nice signal!",
  "synced": true
}
```

### Radio State
```json
{
  "station_id": "station1",
  "driver": "icom.ic7300",
  "freq": 14074000,
  "mode": "USB-D",
  "ptt": false,
  "power": 100,
  "timestamp": 1737291296000
}
```

## Development Roadmap

### Phase 1: Foundation (current)
- ✅ Driver architecture
- ✅ Node server with MQTT
- ✅ Basic WebSerial integration
- ⏳ Modern web UI
- ⏳ SQLite logging

### Phase 2: Multi-Station
- MQTT QSO sync
- Station discovery
- Duplicate checking
- Event configuration UI

### Phase 3: Field Operations
- SOTA/POTA templates
- Field Day scoring
- Offline mode
- Mobile/tablet optimization

### Phase 4: Advanced Features
- Hamlib rigctl bridge
- Cluster integration (DX spots)
- ADIF import/export
- Log analysis & statistics

### Phase 5: Native Apps
- Electron packaging
- Android app (Capacitor)
- Raspberry Pi image

## Contributing

Drivers welcome for additional radios! Each driver should implement:
- `availableModes()` - List of supported modes
- `controlsSchema()` - UI control definitions
- `pollSequence()` - Status read loop
- `cmdSet*()` methods for writes
- `parseFrame()` - Protocol decoder

## License

MIT - Use for any ham radio purpose.

## References

- **Hamlib**: https://github.com/Hamlib/Hamlib
- **ADIF Spec**: https://adif.org/
- **Web Serial API**: https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API
- **MQTT**: https://mqtt.org/
- **WSJT-X**: Inspiration for distributed logging
- **N1MM+**: Windows contest logging reference

---

*WebCAT: Modern distributed ham radio control and logging for the field operator.*
