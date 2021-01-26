
const FromPgn = require('./lib/fromPgn').Parser
const { pgnToYdgwRawFormat, actisenseToYdgwRawFormat, pgnToPCDIN, actisenseToPCDIN} = require('./lib/toPgn')

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

global.parsePCDIN = (pcdin) => {
  return parser.parseN2KOver0183(pcdin)
}

global.parseMXPGN = (mxpgn) => {
  return parser.parseN2KOver0183(mxpgn)
}

global.parseHelmSmart = global.parsePCDIN

//global.toPgn: require('./lib/toPgn').toPgn,

//console.log(global.parseYDGW02('06:06:39.801 R 09F10DCC 00 FF FF 7F FF 7F FF FF'))
