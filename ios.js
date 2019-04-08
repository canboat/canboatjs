
const FromPgn = require('./lib/fromPgn').Parser
const pgnToYdwgRawFormat = require('./lib/toPgn').pgnToYdwgRawFormat

const parser = new FromPgn({})

global.parseYDWG02 = (pgn_data) => {
  return parser.parseYDWG02(pgn_data)
}
global.parseVenusMQTT = (pgn_data) => {
  return parser.parseVenusMQTT(pgn_data)
}

global.pgnToYdwgRawFormat = pgnToYdwgRawFormat

//global.toPgn: require('./lib/toPgn').toPgn,

//console.log(global.parseYDWG02('06:06:39.801 R 09F10DCC 00 FF FF 7F FF 7F FF FF'))
