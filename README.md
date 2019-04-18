# Canboatjs



[![npm version](https://img.shields.io/npm/v/@canboat/canboatjs.svg)](https://www.npmjs.com/@canboat/canboatjs)

Pure javascript NMEA 2000 decoder and encoder

Canboatjs is a port of the canboat project (https://github.com/canboat/canboat) to javascript

# Contributors
Canboajs js is built on the backs of a few people whithout whom it would not be possible.
- Kees Verruijt <kees@verruijt.net>
- Jouni Hartikainen <jouni.hartikainen@iki.fi>
- Teppo Kurki <teppo.kurki@iki.fi>

# Features

- Read directly from an Actisense NGT-1, canbus devices, Digital Yachts' iKonvert and Yacht Devices YDWG-02
- Supports input in canboat analyzer json format
- Take input in canboat analyzer json format and convert to binary N2K format and output to supported devices

# PGN Descriptions
The details about the PGN's recognized by Canboatjs come from the canboat project in [pgns.json](https://github.com/canboat/pgns). If you want to add or update PGN details, please make changes to the pgn.h file in canboat and submit a pull request there. Include sample data and raise an issue here so that I can include your changes in Canboatjs.


# Command Line Programs

## analyzerjs
This program is similar to the canboat `analyzer` command-line. It takes input in the actisense serial format and outputs canboat json for mat.

Examples:

- `actisense-serialjs /dev/ttyUSB0 | analyzerjs`
- `ikonvert-serial /dev/ttyUSB0 | analyzerjs`
- `nc ydgw 1475 | analyzerjs`

## to-pgn
This program takes input in the canboat json format and outputs actisense serial format.

## candumpanalyzer
This program takes input in the candump format and outputs canboat json format

Example: `candump can0 | candumpanalyzer`

# Use in your own software

## Installation

- `npm install @canboat/canboatjs`

## Create the parser

```js
const FromPgn = require('@canboat/canboatjs').FromPgn

const parser = new FromPgn()

parser.on('warning', (pgn, warning) => {
  console.log(`[warning] ${pgn.pgn} ${warning}`)
})

```

## Parse input from the Actisense NGT-1 or iKonvert string formats

```js
const json = parser.parseString('2017-03-13T01:00:00.146Z,2,127245,204,255,8,fc,f8,ff,7f,ff,7f,ff,ff')
if ( json ) {
  console.log(JSON.stringify(json))
}

```

Output:
```json
{
   "description" : "Rudder",
   "dst" : 255,
   "prio" : 2,
   "pgn" : 127245,
   "fields" : {
      "Reserved1" : "62",
      "Direction Order" : 0,
      "Instance" : 252
   },
   "src" : 204,
   "timestamp" : "2017-03-13T01:00:00.146Z"
}
```

## Parse input from the YDWG-02

```js
const json = parser.parseString('16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6')
if ( json ) {
  console.log(JSON.stringify(json))
}
```

Output:
```json
{
   "src" : 127,
   "pgn" : 129025,
   "description" : "Position, Rapid Update",
   "timestamp" : "2019-04-10T20:29:27.082Z",
   "dst" : 255,
   "prio" : 2,
   "fields" : {
      "Latitude" : 33.0875728,
      "Longitude" : -97.0205113
   }
}
```

## Generate Actisense format from canboat json

```js
const pgnToActisenseSerialFormat = require('./index').pgnToActisenseSerialFormat

const string = pgnToActisenseSerialFormat({
   "dst" : 255,
   "prio" : 2,
   "pgn" : 127245,
   "fields" : {
      "Reserved1" : "62",
      "Direction Order" : 0,
      "Instance" : 252
   },
   "src" : 204,
})

if ( string ) {
  console.log(string)
}
```

Output:

`2019-04-10T12:00:32.733Z,2,127245,0,255,8,fc,f8,ff,7f,ff,7f,ff,ff`

## Generate iKconvert format from canboat json

```js


const pgnToiKonvertSerialFormat = require('./index').pgnToiKonvertSerialFormat

const string = pgnToiKonvertSerialFormat({
   "dst" : 255,
   "prio" : 2,
   "pgn" : 127245,
   "fields" : {
      "Reserved1" : "62",
      "Direction Order" : 0,
      "Instance" : 252
   },
   "src" : 204,
})

if ( string ) {
  console.log(string)
}
```

Output:  `!PDGY,127245,255,/Pj/f/9///8=`

## Generate YDGW-02 format from canboat json

```js
const pgnToYdwgRawFormat = require('./index').pgnToYdwgRawFormat

const array = pgnToYdwgRawFormat({
  "src":127,
  "prio":3,
  "dst":255,
  "pgn":129029,
  "fields": {
    "SID":0,
    "Date":"2019.02.17",
    "Time":"16:29:28",
    "Latitude":33.08757283333333,
    "Longitude":-97.02051133333333,
    "Altitude":148.94,
    "GNSS type":"GPS+GLONASS",
    "Method":"GNSS fix",
    "Integrity":"No integrity checking",
    "Number of SVs":0,
    "HDOP":0.5,
    "PDOP":1,
    "Geoidal Separation":-24,
    "Reference Stations":0,
    "list":[{"Reference Station ID":15}]
  },
})

if ( array ) {
  console.log(JSON.stringify(array, null, 2))
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
const { parseN2kString } = require('@canboat/canboatjs')

const n2kParts1 = parseN2kString('$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59')
const matches1 = (n2kParts1 === {
  data: Buffer.from('2AAF00D1067414FF', 'hex'),
  dst: 255,
  format: 'PCDIN',
  prefix: '$PCDIN',
  pgn: 127257,
  prio: 0,
  src: 15,
  timer: 0,
  timestamp: new Date(0),
})

const n2kParts2 = parseN2kString('16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6')
const today = (new Date()).toISOString().split('T')[0]
const matches2 = (n2kParts2 === {
  canId: 0x09F8017F,
  data: Buffer.from('50C3B81347D82BC6', 'hex'),
  direction: 'R',
  dst: 255,
  format: 'YDRAW',
  pgn: 129025,
  prio: 2,
  src: 127,
  timestamp: new Date(`${today}T16:29:27.082Z`),
})

const n2kParts3 = parseN2kString('2016-04-09T16:41:09.078Z,3,127257,17,255,8,00,ff,7f,52,00,21,fe,ff')
const matches3 = (n2kParts3 === {
  data: Buffer.from('00ff7f520021feff', 'hex'),
  dst: 255,
  len: 8,
  format: 'Actisense',
  pgn: 127257,
  prio: 3,
  src: 17,
  timestamp: '2016-04-09T16:41:09.078Z',
})
```
