# WebCAT Drivers Quick Reference

## Overview

All four drivers follow the same interface pattern defined in [DRIVER_STANDARDS.md](DRIVER_STANDARDS.md). Each driver encapsulates a radio's protocol and provides unified access to frequency, mode, and transmit controls through a common API.

---

## Driver Comparison

| Property | IC-7300 | IC-9700 | FT-991A | FT-857D |
|----------|---------|---------|---------|---------|
| **Type** | Icom HF/VHF | Icom VHF/UHF | Yaesu HF/VHF | Yaesu HF/VHF Portable |
| **Protocol** | CI-V (binary) | CI-V (binary) | ASCII CAT | 5-byte CAT |
| **Default Baud** | 19200 | 115200 | 38400 | 9600 |
| **Bands Supported** | 13 | 3 | 13 | 13 |
| **Modes Supported** | 16 | 10 | 14 | 10 |
| **Serial Config** | 8N1 | 8N1 | 8N1 | 8N2 |
| **Audio Controls** | Yes | Yes | No | No |
| **Power Control** | 0-255 | 0-255 | 0-100W | None |

---

## Quick Start: Using a Driver

### Loading a Driver
```html
<script src="webcat-base.js"></script>
<script src="drivers/webcat-icom-ic7300.js"></script>
<script src="drivers/webcat-icom-ic9700.js"></script>
<script src="drivers/webcat-yaesu-ft991a.js"></script>
<script src="drivers/webcat-yaesu-ft857d.js"></script>
```

### Connecting to a Radio
```javascript
const radio = new WebCAT.Radio({
  driverId: 'icom.ic9700',  // or 'yaesu.ft991a', 'yaesu.ft857d', etc.
  baudRate: 115200,
  // Additional options based on driver...
});

await radio.connect();
```

### Accessing Driver Methods
```javascript
// Read radio state
await radio.pollState();
console.log(radio.state.freqHz);  // Frequency in Hz
console.log(radio.state.mode);     // Mode name (LSB, USB, FM, etc.)
console.log(radio.state.ptt);      // TX/RX status

// Set frequency
await radio.setFrequencyHz(14074000);

// Change mode
await radio.setMode('USB');

// Control PTT
await radio.setPTT(true);   // Transmit
await radio.setPTT(false);  // Receive

// Access driver-specific methods
const maxWatts = radio.driver.rfSettingWattsFromPC(200, 14074000);
```

### Using Control Schema for UI
```javascript
const schema = radio.driver.controlsSchema();
// Returns array of control descriptors for dynamic UI generation
// Each control has: id, label, kind, read(), apply()
```

---

## Driver Details

### IC-7300 (Reference Implementation)
**File**: `drivers/webcat-icom-ic7300.js`  
**Status**: Production-ready, full-featured

**Key Commands**:
- Read: RxTxStatus, Freq, Mode, S-meter, SWR, Power, Voltage, ID, AF/RF/SQL levels
- Write: Freq, Mode, PTT, AF, RF, SQL, TX Power, Compression, Monitor, Filter BW
- Data: 30+ read/write commands, 18 UI controls

**Unique Features**:
- Digital mode toggling (LSB-D, USB-D, etc. via separate data mode flag)
- Band selection with automatic frequency centering
- Filter bandwidth control (0-3000Hz range)
- Comprehensive audio controls

**Example**: 160m CW on IC-7300
```javascript
await radio.setFrequencyHz(1810000);  // 160m CW band
await radio.setMode('CW');
```

---

### IC-9700 (VHF/UHF Specialist)
**File**: `drivers/webcat-icom-ic9700.js`  
**Status**: Enhanced with full control schema

**Key Commands**:
- Read: RxTxStatus, Freq, Mode, S-meter, SWR, Power, Voltage, ID, audio levels
- Write: Freq, Mode, PTT, AF, RF, SQL, TX Power, Compression, Monitor

**Supported Bands**:
- 2m (144-148 MHz) - Most popular
- 70cm (420-450 MHz) - Secondary
- 23cm (1240-1325 MHz) - Advanced

**Example**: 2m FM on IC-9700
```javascript
await radio.setFrequencyHz(146520000);  // 2m national simplex frequency
await radio.setMode('FM');
await radio.sendCommand(radio.driver.cmdSetAF(200));  // AF gain
```

---

### FT-991A (HF/VHF ASCII CAT)
**File**: `drivers/webcat-yaesu-ft991a.js`  
**Status**: Enhanced with full control schema

**Key Commands**:
- ASCII text-based protocol (terminated by semicolon)
- Read: TX status, Frequency, Mode, Power, S-meter, SWR, Current, Voltage
- Write: Frequency (9-digit Hz), Mode (single hex code), PTT, RF Power (watts)

**Supported Bands**: All HF (160m-10m) + 6m, 2m, 70cm  
**Unique Feature**: Power control in actual Watts (0-100), not raw 0-255

**Example**: 20m SSB on FT-991A
```javascript
const driver = radio.driver;
await radio.sendCommand(driver.cmdSetFreqHz(14274000));  // 20m USB phone
await radio.sendCommand(driver.cmdSetMode('USB'));
await radio.sendCommand(driver.cmdSetRFPower(50));      // 50 watts
```

---

### FT-857D (Portable HF/VHF)
**File**: `drivers/webcat-yaesu-ft857d.js`  
**Status**: Enhanced with control schema

**Key Commands**:
- 5-byte binary protocol (4 data + 1 opcode)
- Read: Frequency, Mode, RX status, TX status
- Write: Frequency, Mode, PTT
- **Note**: Limited power control (status only, no adjustable transmit power in this protocol)

**Serial Config**: **Unique 8N2** (2 stop bits required)  
**Supported Bands**: All HF (160m-10m) + 6m, 2m, 70cm

**Example**: 70cm FM on FT-857D
```javascript
await radio.setFrequencyHz(445000000);   // 70cm band
await radio.setMode('FM');
// Note: No power adjustment available in 5-byte CAT mode
```

---

## Protocol Deep Dive

### CI-V (Icom)
Used by: IC-7300, IC-9700

**Frame Structure**:
```
FE FE <addr> <ctrl> <payload...> FD
```

**Frequency Encoding** (5 bytes, little-endian BCD):
```
14.074 MHz = 0x74 0x07 0x14 0x00 0x00
            = 14, 07, 74, 00, 00 (BCD digits)
```

**Read Frequency**:
```
Command:  FE FE 94 E0 03 FD
Response: FE FE E0 94 03 74 07 14 00 00 FD
```

---

### ASCII CAT (Yaesu FT-991A)
Used by: FT-991A

**Command Format**: Text with semicolon terminator
```
FA000014074000;    // Set frequency to 14.074 MHz
MD01;              // Set mode to USB (mode code 1, query index 0)
TX1;               // Transmit
PC050;             // Set power to 50 watts
```

**Response Format**: Echo or query result
```
Command:  FA;
Response: FA000014074000;   // Current frequency
```

---

### 5-byte CAT (Yaesu FT-857D)
Used by: FT-857D

**Command Structure**: 5 bytes exactly
```
[byte0] [byte1] [byte2] [byte3] [opcode]
```

**Example: Set frequency to 146.520 MHz**
```
Frequency encoding: 146520000 Hz = 14652000 (10Hz units)
BCD: 01 46 52 00 → [0x01, 0x46, 0x52, 0x00, 0x01]
                    opcode 0x01 = Set Frequency
```

**Status Response** (1-5 bytes depending on mode):
```
Byte format for TX status:
[PTTX SSSSX] where TTXX = TX status, XXXX = Power nibble, SSSS = SWR/Signal
```

---

## API Reference

### Common Interface (all drivers)

```javascript
// === REQUIRED BY ALL DRIVERS ===
driver.serialOptions()              // Returns {dataBits, stopBits, parity, flowControl}
driver.extractFrames(rxBuf)         // Parse raw buffer → array of frames
driver.parseFrame(frame)            // Parse frame → array of state updates
driver.pollSequence()               // Returns array of read commands
driver.formatTx(bytes)              // Format TX for logging
driver.formatRx(bytes)              // Format RX for logging

// === CONTROL COMMANDS (varies by radio) ===
driver.cmdReadFreq()                // Read current frequency
driver.cmdReadMode()                // Read current mode
driver.cmdReadRxTxStatus()          // Read TX/RX status
driver.cmdSetFreqHz(hz)             // Set frequency in Hz
driver.cmdSetMode(modeName)         // Set mode by name
driver.cmdSetPTT(on)                // Set PTT status

// === OPTIONAL COMMANDS (if supported) ===
driver.cmdSetAF(raw)                // Set AF gain (0-255)
driver.cmdSetRF(raw)                // Set RF gain (0-255)
driver.cmdSetSQL(raw)               // Set squelch (0-255)
driver.cmdSetTXPower(watts)         // Set transmit power

// === UI SCHEMA (for control panels) ===
driver.availableModes()             // Returns [list of mode names]
driver.controlsSchema()             // Returns [{id, label, kind, read, apply}, ...]
```

### Driver-Specific Methods

**IC-7300/IC-9700 (CI-V)**:
- `cmdSetCompression(raw)` - Speech compression (0-255)
- `cmdSetMonitor(raw)` - Monitor level (0-255)
- `cmdReadId()` - Read current drain (amps)

**FT-991A (ASCII CAT)**:
- `rfSettingWattsFromPC(pc, hz)` - Convert power code to watts
- `poWattsFromRaw(raw, hz)` - Convert PO meter to watts

**FT-857D (5-byte CAT)**:
- `swrFromRaw(raw)` - Convert SWR meter raw to ratio
- `voltsFromRaw(raw)` - Convert voltage meter raw to volts

---

## Creating a New Driver

Use the [DRIVER_STANDARDS.md](DRIVER_STANDARDS.md) template. Key steps:

1. **Define serialOptions()** - Configure serial port for your radio
2. **Implement extractFrames()** - Split raw RX buffer into frames
3. **Implement parseFrame()** - Decode frame into state updates
4. **Add cmdRead*/cmdSet* methods** - Command generators
5. **Define BANDS and modes** - Band/mode definitions
6. **Implement availableModes()** - Return mode list
7. **Implement controlsSchema()** - Return UI control descriptors
8. **Register the driver** - Call `WebCAT.registerDriver()`

---

## Troubleshooting

| Issue | Possible Cause | Solution |
|-------|----------------|----------|
| "Unsupported mode" | Mode not in driver's mode list | Check `availableModes()`, use supported mode |
| Frequency not set | Radio model doesn't support band | Check BANDS definition, try different band |
| No UI controls | controlsSchema() not implemented | Implement controlsSchema() method |
| "Bad frequency" | Frequency out of radio's range | Check band limits in BANDS constant |
| Serial timeout | Wrong baud rate | Check `serialOptions()`, use correct baud |
| 8N2 error (FT-857D only) | Using wrong stop bits | Use 2 stop bits (8N2), not 8N1 |

---

## References

- [DRIVER_STANDARDS.md](DRIVER_STANDARDS.md) - Full specification
- [ENHANCEMENT_SUMMARY.md](ENHANCEMENT_SUMMARY.md) - Detailed changes
- [webcat-base.js](../webcat-base.js) - Core WebCAT library
- Icom CI-V Manual: https://www.icomamerica.com/
- Yaesu CAT Manual: https://www.yaesu.com/

