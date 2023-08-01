
const FromPgn = require('./lib/fromPgn').Parser
const {
  pgnToYdgwRawFormat,
  actisenseToYdgwRawFormat,
  pgnToPCDIN,
  actisenseToPCDIN,
  pgnToiKonvertSerialFormat,
  actisenseToiKonvert,
  pgnToMXPGN,
  actisenseToMXPGN,
  pgnToActisenseN2KAsciiFormat,
  actisenseToN2KAsciiFormat
} = require('./lib/toPgn')

const parser = new FromPgn({})

global.parseYDGW02 = (pgn_data) => {
  return parser.parseYDGW02(pgn_data)
}
global.parseVenusMQTT = (pgn_data) => {
  return parser.parseVenusMQTT(pgn_data)
}
global.parseString = (pgn_data) => {
  return parser.parseString(pgn_data)
}
global.actisenseToYdgwRawFormat = actisenseToYdgwRawFormat
global.pgnToYdgwRawFormat = pgnToYdgwRawFormat
global.pgnToPCDIN = pgnToPCDIN
global.actisenseToPCDIN = actisenseToPCDIN
global.pgnToMXPGN = pgnToMXPGN
global.actisenseToMXPGN = actisenseToMXPGN
global.pgnToiKonvertSerialFormat = pgnToiKonvertSerialFormat
global.actisenseToiKonvert = actisenseToiKonvert
global.pgnToActisenseN2KAsciiFormat = pgnToActisenseN2KAsciiFormat
global.actisenseToN2KAsciiFormat = actisenseToN2KAsciiFormat

global.parsePCDIN = (pcdin) => {
  return parser.parseN2KOver0183(pcdin)
}

global.parseMXPGN = (mxpgn) => {
  return parser.parseN2KOver0183(mxpgn)
}

global.parseHelmSmart = global.parsePCDIN

global.isN2KOver0183 = (msg) => {
  return parser.isN2KOver0183(msg)
}
global.parseN2KOver0183 = (msg) => {
  return parser.parseN2KOver0183(msg)
}
global.parsePDGY = (pdgy) => {
  if ( !pdgy.startsWith('!PDGY') ) {
    return
  }
  return parser.parsePDGY(pdgy)
}

global.parseActisenseN2KASCII = (n2k) => {
  return parser.parseActisenceN2KAscii(n2k)
}

//global.toPgn: require('./lib/toPgn').toPgn,

//console.log(global.parseYDGW02('06:06:39.801 R 09F10DCC 00 FF FF 7F FF 7F FF FF'))
