# @canboat/canboatjs

[![npm version](https://img.shields.io/npm/v/@canboat/canboatjs.svg)](https://www.npmjs.com/@canboat/canboatjs)
[![Node.js CI & Test](https://github.com/canboat/canboatjs/actions/workflows/test.yml/badge.svg)](https://github.com/canboat/canboatjs/actions/workflows/test.yml)
[![Test Canboat json Changes](https://github.com/canboat/canboatjs/actions/workflows/test_canboat_changes.yml/badge.svg)](https://github.com/canboat/canboatjs/actions/workflows/test_canboat_changes.yml)
[![Test canboatjs dependents](https://github.com/canboat/canboatjs/actions/workflows/test_canboatjs_dependencies.yml/badge.svg)](https://github.com/canboat/canboatjs/actions/workflows/test_canboatjs_dependencies.yml)

A comprehensive JavaScript library for parsing, encoding, and interfacing with NMEA 2000 marine electronics networks. This is a pure JavaScript port of the [canboat project](https://github.com/canboat/canboat) with extensive device support and multiple data format compatibility.

## 📋 Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Supported Devices](#supported-devices)
- [Command Line Tools](#command-line-tools)
- [API Reference](#api-reference)
- [Usage Examples](#usage-examples)
- [Device Integration](#device-integration)
- [Data Formats](#data-formats)
- [Contributing](#contributing)
- [License](#license)

## ✨ Features

- **🔌 Multi-Device Support**: Direct interface with popular NMEA 2000 gateways and CAN bus devices
- **📡 Multiple Data Formats**: Parse and generate various N2K data formats (Actisense, iKonvert, YDWG, etc.)
- **🔄 Bidirectional**: Both decode incoming N2K messages and encode/transmit outgoing messages
- **⚡ Real-time Processing**: Stream-based processing for live data feeds
- **🛠️ Command Line Tools**: Ready-to-use CLI utilities for data conversion and analysis
- **🎯 Type Safety**: Built with TypeScript and includes comprehensive type definitions
- **🌊 Marine Focus**: Specifically designed for marine electronics and navigation systems
- **📊 JSON Output**: Standardized JSON format compatible with Signal K and other marine data systems

## 📦 Installation

### For Command Line Usage

```bash
sudo npm install -g @canboat/canboatjs
```

### For Node.js Projects

```bash
npm install @canboat/canboatjs
```

### Requirements

- **Node.js**: Version 20 or higher
- **Optional Dependencies**:
  - `serialport`: For serial device communication
  - `socketcan`: For direct CAN bus access on Linux

## 🚀 Quick Start

### Basic Message Parsing

```javascript
const { FromPgn } = require('@canboat/canboatjs')

// Create parser instance
const parser = new FromPgn()

// Handle warnings
parser.on('warning', (pgn, warning) => {
  console.log(`[WARNING] PGN ${pgn.pgn}: ${warning}`)
})

// Parse an Actisense format message
const message = "2017-03-13T01:00:00.146Z,2,127245,204,255,8,fc,f8,ff,7f,ff,7f,ff,ff"
const json = parser.parseString(message)

if (json) {
  console.log('Parsed PGN:', JSON.stringify(json, null, 2))
}
```

### Generate N2K Messages

```javascript
const { pgnToActisenseSerialFormat } = require('@canboat/canboatjs')

// Create a rudder position message
const message = {
  pgn: 127245,
  prio: 2,
  src: 204,
  dst: 255,
  fields: {
    'Instance': 252,
    'Direction Order': 0,
    'Reserved1': '62'
  }
}

const actisenseString = pgnToActisenseSerialFormat(message)
console.log('Generated:', actisenseString)
```

## 🔌 Supported Devices

### NMEA 2000 Gateways
- **Actisense NGT-1** & **W2K-1** - USB and WiFi NMEA 2000 gateways
- **Digital Yacht iKonvert** - Serial to NMEA 2000 converter
- **Yacht Devices YDWG-02** & **YDEN-02** - WiFi and Ethernet gateways
- **Shipmodul MiniPlex-3-N2K** - Multi-protocol marine data multiplexer

### CAN Bus Interfaces
- **SocketCAN devices** - Direct Linux CAN bus interface
- **Various CAN adapters** - Hardware CAN interfaces compatible with SocketCAN

### Supported Data Formats
- **Actisense Serial Format** - Standard Actisense ASCII format
- **iKonvert Format** - Digital Yacht proprietary format
- **YDWG Raw Format** - Yacht Devices raw binary format
- **PCDIN Format** - Chetco Digital Instruments format
- **MXPGN Format** - MiniPlex-3 format
- **SocketCAN** - Linux CAN bus native format

## 🛠️ Command Line Tools

Canboatjs includes several powerful command-line utilities:

### `analyzerjs` - Message Analysis
Convert various N2K formats to standardized JSON:

```bash
# From Actisense NGT-1
actisense-serialjs /dev/ttyUSB0 | analyzerjs

# From iKonvert
ikonvert-serial /dev/ttyUSB0 | analyzerjs

# From YDWG-02 over network
nc ydgw-ip 1475 | analyzerjs

# From W2K-1 WiFi gateway  
nc w2k-1-ip 60002 | analyzerjs

# From SocketCAN
candumpjs can0
```

### `to-pgn` - Message Generation
Convert JSON to various N2K formats:

```bash
echo '{"pgn":127245,"fields":{"Instance":0}}' | to-pgn --format=actisense
```

### `candumpjs` - Direct CAN Access
Read from SocketCAN without installing can-utils:

```bash
candumpjs can0
```

### `ydvr-file` - YDVR File Processing
Process Yacht Devices recorder files:

```bash
ydvr-file recording.ydvr | analyzerjs
```

### Additional Tools
- `actisense-file` - Process Actisense log files
- `actisense-n2k-tcp` - TCP server for Actisense data
- `cansend` - Send CAN messages
- `ikonvert-serial` - iKonvert serial interface

## 📚 API Reference

### Core Classes

#### `FromPgn` - Message Parser
```javascript
const parser = new FromPgn(options)
parser.parseString(message)  // Parse single message
parser.parse(buffer)         // Parse binary data
```

#### `canbus` - CAN Bus Interface
```javascript
const canbus = new canbus(options)
canbus.sendPGN(message)      // Send N2K message
```

#### Device-Specific Streams
- `Ydwg02` - Yacht Devices YDWG-02 interface
- `W2k01` - Actisense W2K-1 interface  
- `iKonvert` - Digital Yacht iKonvert interface
- `Venus` - Victron Venus OS interface
- `serial` - Actisense NGT-1 serial interface

### Utility Functions

```javascript
const {
  parseN2kString,           // Parse N2K string formats
  isN2KString,             // Detect N2K string format
  toActisenseSerialFormat, // Convert to Actisense format
  pgnToActisenseSerialFormat,
  pgnToiKonvertSerialFormat,
  pgnToYdgwRawFormat,
  lookupEnumerationValue,   // Get enumeration values
  lookupEnumerationName,    // Get enumeration names
  discover                  // Network device discovery
} = require('@canboat/canboatjs')
```

## 💡 Usage Examples

### Real-time Data Streaming

```javascript
const { FromPgn, serial } = require('@canboat/canboatjs')

// Connect to Actisense NGT-1
const actisense = new serial({
  device: '/dev/ttyUSB0',
  baudrate: 115200
})

const parser = new FromPgn()

actisense.pipe(parser)

parser.on('pgn', (pgn) => {
  if (pgn.pgn === 129025) { // Position Rapid Update
    console.log(`Lat: ${pgn.fields.Latitude}, Lon: ${pgn.fields.Longitude}`)
  }
})
```

### Device Discovery

```javascript
const { discover } = require('@canboat/canboatjs')

// Discover NMEA 2000 devices on network
discover((device) => {
  console.log(`Found device: ${device.name} at ${device.address}:${device.port}`)
})
```

### Working with Multiple Formats

```javascript
const { FromPgn } = require('@canboat/canboatjs')
const parser = new FromPgn()

// Actisense format
const actisense = "2017-03-13T01:00:00.146Z,2,127245,204,255,8,fc,f8,ff,7f,ff,7f,ff,ff"

// YDWG-02 format
const ydwg = "16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6"

// MiniPlex-3 format
const miniplex = "$MXPGN,01F801,2801,C1308AC40C5DE343*19"

// All parse to same JSON structure
[actisense, ydwg, miniplex].forEach(message => {
  const json = parser.parseString(message)
  if (json) {
    console.log(`PGN ${json.pgn}: ${json.description}`)
  }
})
```

### Custom Device Integration

```javascript
const { SimpleCan } = require('@canboat/canboatjs')

// Create virtual N2K device
const device = new SimpleCan({
  canDevice: 'can0',
  preferredAddress: 35,
  addressClaim: {
    "Unique Number": 139725,
    "Manufacturer Code": 'My Company',
    "Device Function": 130,
    "Device Class": 'Navigation',
    "Device Instance Lower": 0,
    "Device Instance Upper": 0,
    "System Instance": 0,
    "Industry Group": 'Marine'
  },
  productInfo: {
    "NMEA 2000 Version": 1300,
    "Product Code": 667,
    "Model ID": "MyDevice-1000",
    "Software Version Code": "1.0",
    "Model Version": "1.0",
    "Model Serial Code": "123456"
  }
}, (message) => {
  // Handle incoming messages
  console.log('Received:', message)
})

device.start()
```

## 🌐 Data Formats

### Input Format Support

| Format | Description | Example |
|--------|-------------|---------|
| **Actisense** | Standard timestamped CSV | `2017-03-13T01:00:00.146Z,2,127245,204,255,8,fc,f8,ff,7f,ff,7f,ff,ff` |
| **YDWG Raw** | Yacht Devices binary | `16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6` |
| **iKonvert** | Digital Yacht base64 | `!PDGY,127245,255,/Pj/f/9///8=` |
| **PCDIN** | Chetco Digital | `$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59` |
| **MXPGN** | MiniPlex-3 | `$MXPGN,01F801,2801,C1308AC40C5DE343*19` |

### Output Format Support

Generate data in any supported format from JSON:

```javascript
const message = { pgn: 127245, fields: { Instance: 0 } }

// Convert to different formats
const actisense = pgnToActisenseSerialFormat(message)
const ikonvert = pgnToiKonvertSerialFormat(message)  
const ydwg = pgnToYdgwRawFormat(message)
const pcdin = pgnToPCDIN(message)
const mxpgn = pgnToMXPGN(message)
```

## 🏗️ Building from Source

```bash
# Clone repository
git clone https://github.com/canboat/canboatjs.git
cd canboatjs

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Run with coverage
npm run code-coverage

# Lint and format
npm run format
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run with file watching
npm run dev-test

# Generate coverage report
npm run code-coverage
```

## 📋 PGN Definitions

The PGN (Parameter Group Number) definitions used by canboatjs come from the [canboat project](https://github.com/canboat/canboat) via [canboat.json](https://github.com/canboat/canboat/blob/master/docs/canboat.json).

### Adding New PGNs

To add or update PGN definitions:

1. **Submit changes to canboat**: Modify [pgn.h](https://github.com/canboat/canboat/blob/master/analyzer/pgn.h) in the upstream canboat project
2. **Include sample data**: Provide real-world message examples
3. **Create issue here**: Let us know about the changes so we can update canboatjs

This ensures consistency across the entire canboat ecosystem.

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes with tests
4. Run the test suite: `npm test`
5. Run formating and linting: `npm run format`
6. Commit following [Angular conventions](https://github.com/angular/angular.js/blob/master/DEVELOPERS.md#commits)
7. Submit a Pull Request

### Commit Message Format

Use the format: `<type>: <description>`

- **feat**: New feature
- **fix**: Bug fix  
- **docs**: Documentation changes
- **style**: Code formatting
- **refactor**: Code restructuring
- **test**: Adding tests
- **chore**: Maintenance tasks

## 📄 License

Licensed under the Apache License, Version 2.0. See [LICENSE.md](LICENSE.md) for details.

## 🔗 Related Projects

- **[@canboat/ts-pgns](https://github.com/canboat/ts-pgns)** - TypeScript PGN definitions
- **[canboat](https://github.com/canboat/canboat)** - Original C implementation
- **[Signal K](https://signalk.org/)** - Modern marine data standard
- **[Signal K Server](https://github.com/SignalK/signalk-server-node)** - Signal K server implementation

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/canboat/canboatjs/issues)
- **Discussions**: [GitHub Discussions](https://github.com/canboat/canboatjs/discussions)
- **Signal K Community**: [Community](https://signalk.org/community/)

---

Made with ⚓ by the Canboat project contributors

## ydvr-file

This program takes input in the [YDVR](https://www.yachtd.com/products/recorder.html) file format and outputs canboat json format

Example: `ydvr-file <file>`

# Usage

## Instalation for command line programs

- `sudo npm install -g @canboat/canboatjs`

## Installation for a nodejs project

- `npm install @canboat/canboatjs`

## Create the parser

```js
const FromPgn = require("@canboat/canboatjs").FromPgn;

const parser = new FromPgn();

parser.on("warning", (pgn, warning) => {
  console.log(`[warning] ${pgn.pgn} ${warning}`);
});
```

## Parse input from the Actisense NGT-1 or iKonvert string formats

```js
const json = parser.parseString(
  "2017-03-13T01:00:00.146Z,2,127245,204,255,8,fc,f8,ff,7f,ff,7f,ff,ff"
);
if (json) {
  console.log(JSON.stringify(json));
}
```

Output:

```json
{
  "description": "Rudder",
  "dst": 255,
  "prio": 2,
  "pgn": 127245,
  "fields": {
    "Reserved1": "62",
    "Direction Order": 0,
    "Instance": 252
  },
  "src": 204,
  "timestamp": "2017-03-13T01:00:00.146Z"
}
```

## Parse input from the YDWG-02

```js
const json = parser.parseString(
  "16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6"
);
if (json) {
  console.log(JSON.stringify(json));
}
```

Output:

```json
{
  "src": 127,
  "pgn": 129025,
  "description": "Position, Rapid Update",
  "timestamp": "2019-04-10T20:29:27.082Z",
  "dst": 255,
  "prio": 2,
  "fields": {
    "Latitude": 33.0875728,
    "Longitude": -97.0205113
  }
}
```

## Parse input from the MiniPlex-3-N2K

```js
const json = parser.parseString("$MXPGN,01F801,2801,C1308AC40C5DE343*19");
if (json) {
  console.log(JSON.stringify(json));
}
```

Output:

```json
{
  "src": 1,
  "pgn": 129025,
  "description": "Position, Rapid Update",
  "timestamp": "2019-04-10T20:29:27.082Z",
  "dst": 255,
  "prio": 0,
  "fields": {
    "Latitude": 33.0875728,
    "Longitude": -97.0205113
  }
}
```

## Generate Actisense format from canboat json

```js
const pgnToActisenseSerialFormat = require("./index")
  .pgnToActisenseSerialFormat;

const string = pgnToActisenseSerialFormat({
  dst: 255,
  prio: 2,
  pgn: 127245,
  fields: {
    Reserved1: "62",
    "Direction Order": 0,
    Instance: 252,
  },
  src: 204,
});

if (string) {
  console.log(string);
}
```

Output:

`2019-04-10T12:00:32.733Z,2,127245,0,255,8,fc,f8,ff,7f,ff,7f,ff,ff`

## Generate iKconvert format from canboat json

```js
const pgnToiKonvertSerialFormat = require("./index").pgnToiKonvertSerialFormat;

const string = pgnToiKonvertSerialFormat({
  dst: 255,
  prio: 2,
  pgn: 127245,
  fields: {
    Reserved1: "62",
    "Direction Order": 0,
    Instance: 252,
  },
  src: 204,
});

if (string) {
  console.log(string);
}
```

Output: `!PDGY,127245,255,/Pj/f/9///8=`

## Generate YDGW-02 format from canboat json

```js
const pgnToYdgwRawFormat = require("./index").pgnToYdgwRawFormat;

const array = pgnToYdgwRawFormat({
  src: 127,
  prio: 3,
  dst: 255,
  pgn: 129029,
  fields: {
    SID: 0,
    Date: "2019.02.17",
    Time: "16:29:28",
    Latitude: 33.08757283333333,
    Longitude: -97.02051133333333,
    Altitude: 148.94,
    "GNSS type": "GPS+GLONASS",
    Method: "GNSS fix",
    Integrity: "No integrity checking",
    "Number of SVs": 0,
    HDOP: 0.5,
    PDOP: 1,
    "Geoidal Separation": -24,
    "Reference Stations": 0,
    list: [{ "Reference Station ID": 15 }],
  },
});

if (array) {
  console.log(JSON.stringify(array, null, 2));
}
```

Output:

```json
[
  "0df8057f 40 2f 00 18 46 80 d6 62",
  "0df8057f 41 23 40 63 1b cc b8 81",
  "0df8057f 42 97 04 7f c2 7f fc 96",
  "0df8057f 43 23 89 f2 e0 a4 e0 08",
  "0df8057f 44 00 00 00 00 12 fc 00",
  "0df8057f 45 32 00 64 00 a0 f6 ff",
  "0df8057f 46 ff 00 ff 00 ff ff ff"
]
```

## Parse a N2K string into canId parts and create Buffer

Before the conversion of the individual fields happens the string needs to be parsed for attributes like priority, pgn, destination, source (collectively the CanId) and the hex or base64 needs to be converted to a Buffer. Use `parseN2kString` for this purpose.

```javascript
const { parseN2kString } = require("@canboat/canboatjs");

const n2kParts1 = parseN2kString(
  "$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59"
);
const matches1 =
  n2kParts1 ===
  {
    data: Buffer.from("2AAF00D1067414FF", "hex"),
    dst: 255,
    format: "PCDIN",
    prefix: "$PCDIN",
    pgn: 127257,
    prio: 0,
    src: 15,
    timer: 0,
    timestamp: new Date(0),
  };

const n2kParts2 = parseN2kString(
  "16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6"
);
const today = new Date().toISOString().split("T")[0];
const matches2 =
  n2kParts2 ===
  {
    canId: 0x09f8017f,
    data: Buffer.from("50C3B81347D82BC6", "hex"),
    direction: "R",
    dst: 255,
    format: "YDRAW",
    pgn: 129025,
    prio: 2,
    src: 127,
    timestamp: new Date(`${today}T16:29:27.082Z`),
  };

const n2kParts3 = parseN2kString(
  "2016-04-09T16:41:09.078Z,3,127257,17,255,8,00,ff,7f,52,00,21,fe,ff"
);
const matches3 =
  n2kParts3 ===
  {
    data: Buffer.from("00ff7f520021feff", "hex"),
    dst: 255,
    len: 8,
    format: "Actisense",
    pgn: 127257,
    prio: 3,
    src: 17,
    timestamp: "2016-04-09T16:41:09.078Z",
  };
```
