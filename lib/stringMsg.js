const {
  compact, cond, constant, curry, flow, isEmpty,
  isString, negate, overSome, startsWith, stubTrue, toNumber, zipObject
} = require('lodash/fp')
const {
  arrBuff, byteString, getPlainPGNs, rmChecksum, trimWrap, compute0183Checksum, hexByte
} = require('./utilities')
const {
  buildCanId, encodeCanIdString, parseCanId, parseCanIdStr,
} = require('./canId')
const { parse: parseDate } = require('date-fns')

/**
 * Helper function that helps merge canId fields with format, data, and others.
 * The idea here is to reflect what was in the source and not remove or add.
 * If the source has a len or timestamp attribute it should be added but not created.
 * @param  {Object} canIdInfo The result of parseCanId, parseCanIdStr, or buildCanId.
 * @param  {string} format    String that defines the source format.
 * @param  {Buffer} data      Buffer array that contains the fields data.
 * @param  {Object} [rest={}] Anything else to be added like len, timestamp, direction.
 * @return {Object}           All canId fields with format and data props added.
 */
function buildMsg(canIdInfo, format, data, rest = {}) {
  return {
    ...canIdInfo,
    format,
    data,
    ...rest,
  }
}
function buildErrMsg(msg, input) {
  if (input && isString(input)) return `${msg} - ${input}`
  return msg
}
const buildErr = curry((format, msg, input) => ({
  error: new Error(buildErrMsg(msg, input)), format, input,
}))

function toPaddedHexString(num, len) {
  str = num.toString(16).toUpperCase();
  return "0".repeat(len - str.length) + str;
}

// 2016-02-28T19:57:02.364Z,2,127250,7,255,8,ff,10,3b,ff,7f,ce,f5,fc
exports.isActisense = input => input.charAt(10) === 'T' && input.charAt(23) === 'Z'
exports.parseActisense = (input) => {
  const [ timestamp, prio, pgn, src, dst, len, ...data ] = input.split(',')
  return buildMsg(
    buildCanId(prio, pgn, dst, src),
    'Actisense',
    Buffer.from(data.join(''), 'hex'),
    { len: Number(len), timestamp },
  )
}
exports.encodeActisense = ({
  pgn, data, timestamp, prio = 2, dst = 255, src = 0 }) => ([
    timestamp || new Date().toISOString(),
    prio, pgn, src, dst, data.length,
    byteString(data)
  ].join(','))

exports.toActisenseSerialFormat = (pgn, data, dst=255, src=0, prio=2) => exports.encodeActisense({
  pgn, data, dst, src, prio
})

// A764027.880 05FF7 1EF00 E59861060202FFFFFFFF03030000FFFFFFFFFFFFFFFFFFFF0000FFFFFF7FFFFFFF7FFFFFFF7F0000FF7F
exports.isActisenseN2KASCII = input => input.charAt(0) === 'A' && input.charAt(7) === '.' && input.charAt(11) === ' '
exports.parseActisenseN2KASCII = (input) => {
  const [ timestamp, srcdstp, pgn, data ] = input.split(' ')
  const src = parseInt(srcdstp.substring(0, 2), 16)
  const dst = parseInt(srcdstp.substring(2,4), 16)
  const prio = parseInt(srcdstp.substring(4))
  return buildMsg(
    buildCanId(prio, parseInt(pgn, 16), dst, src),
    'Actisense N2K ASCII',
    Buffer.from(data, 'hex'),
    { len: data.length, time: timestamp.substring(1) },
  )
}
exports.encodeActisenseN2KACSII = ({
  pgn, data, timestamp, prio = 2, dst = 255, src = 0 }) => {
    timestamp = 'A000000.000'
    
    const srcdstp = hexByte(src) + hexByte(dst) + prio
    return ([
      timestamp,
      srcdstp.toUpperCase(),
      toPaddedHexString(pgn, 5).toUpperCase(),
      byteString(data, '').toUpperCase()
    ].join(' '))
  }


// 16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6
exports.isYDRAW = (input) => {
  if (input.charAt(2) !== ':') return false
  const direction = input.substr(12, 3)
  return direction === ' R ' || direction === ' T '
}
exports.parseYDRAW = (input) => {
  const parts = input.split(' ')
  if ( parts.length < 4 ) return buildErr('YDRAW', 'Invalid parts.', input)
  const [ time, direction, canId, ...data ] = parts // time format HH:mm:ss.SSS
  //consoleLog('parseYDRAW build')
  return buildMsg(
    parseCanIdStr(canId), 'YDRAW', arrBuff(data),
    { direction, time }
  )
}
//19F51323 01 02<CR><LF>
exports.encodeYDRAW = ({ data, ...canIdInfo }) => {
  const canId = encodeCanIdString(canIdInfo)
  const pgns = data.length > 8 || canIdInfo.pgn == 126720 ? getPlainPGNs(data) : [ data ]
  return pgns.map(buffer => canId + ' ' + byteString(buffer, ' '))
}

// $PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59
exports.isPCDIN = startsWith('$PCDIN,')
exports.parsePCDIN = (input) => {
  const [ prefix, pgn, timeHex, src, data ] = input.split(',')
  let timer = parseInt(timeHex, 32)
  
  timer = timer / 1024
  timer = timer + 1262304000   // starts epoch time from 1/1/2010
  timer = timer * 1000
  
  return buildMsg(
    buildCanId(0, parseInt(pgn, 16), 255, parseInt(src, 16)),
    'PCDIN',
    Buffer.from(rmChecksum(data), 'hex'),
    { coalesced: true, prefix, timer, timestamp: new Date(timer) },
  )
}

exports.encodePCDIN = ({ prefix = '$PCDIN', pgn, data, dst = 255}) => {
  const sentence = [ prefix, toPaddedHexString(pgn, 6), '0000180C', hexByte(dst).toUpperCase(), byteString(data, '').toUpperCase()].join(',')
  return sentence + compute0183Checksum(sentence)
}

// $MXPGN,01F801,2801,C1308AC40C5DE343*19
exports.isMXPGN = startsWith('$MXPGN,')
exports.parseMXPGN = (input) => {
  const [ prefix, pgn, attr_word, data ] = input.split(',')

  const send_prio_len = (parseInt(attr_word.substr(0,2), 16).toString(2)).padStart(8, '0');
  const addr = (parseInt(attr_word.substr(2,2), 16));
  const send = parseInt(send_prio_len.substr(0,1), 2);
  const prio = parseInt(send_prio_len.substr(1,3), 2);
  const len = parseInt(send_prio_len.substr(4,4), 2);
  let src, dst;
  send ? dst = addr: src = addr;
  
  return buildMsg(
    buildCanId(0, parseInt(pgn, 16), 255, parseInt(src, 16)),
    'MXPGN',
    Buffer.from(rmChecksum(data), 'hex'),
    { coalesced: true, prefix },
  )
}

exports.encodeMXPGN = ({ prefix = '$MXPGN', pgn, prio, src, data }) => {
  if (src > 255) src = 255;
  if (!prio) prio = 3;
  if (!src) src = 255;
  const dataLength = hexByte(128 + (prio * 16) + (byteString(data, '').toUpperCase().length / 2)).toUpperCase()
    const attribWord = dataLength + hexByte(src).toUpperCase()

    var buff = Buffer.from(byteString(data, ''), 'Hex');
    for (var i = 0, j = buff.length - 1; i < j; ++i, --j) {
        var t = buff[j]

        buff[j] = buff[i]
        buff[i] = t
    }

    const sentence = [prefix, toPaddedHexString(pgn, 6), attribWord, buff.toString('Hex').toUpperCase()].join(',')
  return sentence + compute0183Checksum(sentence)
}

// iKonvert
// !PDGY,126992,3,2,255,0.563,d2009e45b3b8821d
exports.isPDGY = startsWith('!PDGY,')
exports.parsePDGY = (input) => {
  const parts = input.split(',')
  if ( parts.length === 7 ) {
    const [ prefix, pgn, prio, src, dst, timer, data ] = parts
    return buildMsg(
      buildCanId(prio, pgn, dst, src), 'PDGY', Buffer.from(data, 'base64'),
      { timer: Number(timer), prefix, coalesced: true },
    )
  } else if ( parts.length === 4 ) {
    const [ prefix, pgn, dst, data ] = parts
    return buildMsg(
      buildCanId(0, pgn, dst, 0), 'PDGY', Buffer.from(data, 'base64'),
      { coalesced: true }
    )
  } else {
    return buildErr('iKonvert', 'Invalid parts.', input)
  }
}
exports.encodePDGY = ({ prefix = '!PDGY', pgn, data, dst = 255}) => (
  [ prefix, pgn, dst, data.toString('base64')].join(',')
)

exports.isPDGYdebug = startsWith('$PDGY,')
exports.parsePDGYdebug = (input) => {
  const [ prefix, pgn, ...fieldParts ] = input.split(',')
  const fieldVals = fieldParts.map(toNumber)
  const fields = zipObject([
    'busLoad', 'errors', 'deviceCount', 'timer', 'gatewaySrc', 'rejectedTX',
  ], fieldVals)
  const src = fields.gatewaySrc
  return buildMsg(
    buildCanId(3, pgn, src, src), 'PDGYdebug', Buffer.from(fieldVals),
    { fields, prefix },
  )
}

// candump1 Angstrom
// <0x18eeff01> [8] 05 a0 be 1c 00 a0 a0 c0
exports.isCandump1 = startsWith('<0x')
exports.parseCandump1 = (input) => {
  const [ canId, len, ...data ] = input.split(' ')
  return buildMsg(
    parseCanIdStr(trimWrap(canId)), 'candump1', arrBuff(data),
    { len: Number(trimWrap(len)) },
  )
}

// candump2 Debian
// can0  09F8027F   [8]  00 FC FF FF 00 00 FF FF
exports.isCandump2 = startsWith('can')
exports.parseCandump2 = (input) => {
  const [ bus, canId, len, ...data ] = compact(input.split(' '))
  return buildMsg(
    parseCanIdStr(canId), 'candump2', arrBuff(data),
    { bus, len: Number(trimWrap(len)) },
  )
}

// candump3 log
// (1502979132.106111) slcan0 09F50374#000A00FFFF00FFFF
exports.isCandump3 = startsWith('(')
exports.parseCandump3 = (input) => {
  const [ timestamp, bus, canFrame ] = input.split(' ')
  const [ canId, data ] = canFrame.split('#')
  return buildMsg(
    parseCanIdStr(canId), 'candump3', arrBuff(data), { timestamp, bus }
  )
}

const hasErr = overSome([negate(isString), isEmpty])
exports.parseN2kString = cond([
  [hasErr, buildErr('INVALID', 'Input not string or empty.')],
  [exports.isActisense, exports.parseActisense],
  [exports.isYDRAW, exports.parseYDRAW],
  [exports.isPCDIN, exports.parsePCDIN],
  [exports.isMXPGN, exports.parseMXPGN],
  [exports.isPDGY, exports.parsePDGY],
  [exports.isCandump1, exports.parseCandump1],
  [exports.isCandump2, exports.parseCandump2],
  [exports.isCandump3, exports.parseCandump3],
  [exports.isPDGYdebug, exports.parsePDGYdebug],
  [exports.isActisenseN2KASCII, exports.parseActisenseN2KASCII],
  [stubTrue, buildErr('MISSING_PARSER', 'Parser not found for input.')],
])

exports.isN2KString = cond([
  [hasErr, () => false],
  [exports.isActisense, () => true],
  [exports.isYDRAW, () => true],
  [exports.isPCDIN, () => true],
  [exports.isMXPGN, () => true],
  [exports.isPDGY, () => true],
  [exports.isCandump1, () => true],
  [exports.isCandump2, () => true],
  [exports.isCandump3, () => true],
  [exports.isPDGYdebug, () => true],
  [exports.isActisenseN2KASCII, () => true],
  [stubTrue, () => false],
])

exports.isN2KOver0183 = (msg) => { return exports.isPCDIN(msg) || exports.isMXPGN(msg) }

exports.parseN2KOver0183 = (msg) => { return exports.parsePCDIN(msg) || exports.parseMXPGN(msg) }


