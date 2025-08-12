import {
  compact,
  cond,
  isEmpty,
  isString,
  negate,
  overSome,
  startsWith,
  stubTrue,
  toNumber,
  zipObject
} from 'lodash/fp'
import {
  arrBuff,
  byteString,
  getPlainPGNs,
  rmChecksum,
  trimWrap,
  compute0183Checksum,
  hexByte
} from './utilities'
import { buildCanId, encodeCanIdString, parseCanIdStr } from './canId'
import moment from 'moment'

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
function buildMsg(
  _canIdInfo: any,
  format: string,
  data: Buffer,
  rest: any = {}
) {
  const canIdInfo = Object.assign({}, _canIdInfo, {
    format,
    data
  })
  for (const property in rest) {
    if (canIdInfo[property] === undefined) {
      canIdInfo[property] = rest[property]
    }
  }
  return canIdInfo
}
function buildErrMsg(msg: string, input: string | undefined) {
  if (input !== undefined && input.length > 0) return `${msg} - ${input}`
  return msg
}
const buildErr = (
  format: string,
  msg: string,
  input: string | undefined = undefined
) => {
  return {
    error: new Error(buildErrMsg(msg, input)),
    format,
    input
  }
}

function toPaddedHexString(num: number, len: number) {
  const str = num.toString(16).toUpperCase()
  return '0'.repeat(len - str.length) + str
}

// 2016-02-28T19:57:02.364Z,2,127250,7,255,8,ff,10,3b,ff,7f,ce,f5,fc
export const isActisense = (input: string) =>
  (input.charAt(10) === 'T' && input.charAt(23) === 'Z') ||
  (input.charAt(10) === '-' && input.charAt(23) === ',')

export const parseActisense = (input: string) => {
  const [timestamp, prio, pgn, src, dst, len, ...data] = input.split(',')
  return buildMsg(
    buildCanId(prio, pgn, dst, src),
    'Actisense',
    Buffer.from(data.join(''), 'hex'),
    { len: Number(len), timestamp }
  )
}
export const encodeActisense = ({
  pgn,
  data,
  timestamp,
  prio = 2,
  dst = 255,
  src = 0
}: any) =>
  [
    timestamp || new Date().toISOString(),
    prio,
    pgn,
    src,
    dst,
    data.length,
    byteString(data)
  ].join(',')

export const toActisenseSerialFormat = (
  pgn: any,
  data: any,
  dst = 255,
  src = 0,
  prio = 2
) =>
  exports.encodeActisense({
    pgn,
    data,
    dst,
    src,
    prio
  })

// A764027.880 05FF7 1EF00 E59861060202FFFFFFFF03030000FFFFFFFFFFFFFFFFFFFF0000FFFFFF7FFFFFFF7FFFFFFF7F0000FF7F
export const isActisenseN2KASCII = (input: string) =>
  input.charAt(0) === 'A' && input.charAt(7) === '.' && input.charAt(11) === ' '
export const parseActisenseN2KASCII = (input: string) => {
  const [timestamp, srcdstp, pgn, data] = input.split(' ')
  const src = parseInt(srcdstp.substring(0, 2), 16)
  const dst = parseInt(srcdstp.substring(2, 4), 16)
  const prio = parseInt(srcdstp.substring(4))
  return buildMsg(
    buildCanId(prio, parseInt(pgn, 16), dst, src),
    'Actisense N2K ASCII',
    Buffer.from(data, 'hex'),
    { len: data.length, time: timestamp.substring(1) }
  )
}
export const encodeActisenseN2KACSII = ({
  pgn,
  data,
  timestamp,
  prio = 2,
  dst = 255,
  src = 0
}: any) => {
  timestamp = 'A000000.000'

  const srcdstp = hexByte(src) + hexByte(dst) + prio
  return [
    timestamp,
    srcdstp.toUpperCase(),
    toPaddedHexString(pgn, 5).toUpperCase(),
    byteString(data, '').toUpperCase()
  ].join(' ')
}

// 16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6
export const isYDRAW = (input: string) => {
  if (input.charAt(2) !== ':') return false
  const direction = input.substr(12, 3)
  return direction === ' R ' || direction === ' T '
}
export const parseYDRAW = (input: string) => {
  const parts = input.split(' ')
  if (parts.length < 4) return buildErr('YDRAW', 'Invalid parts.', input)
  const [time, direction, canId, ...data] = parts // time format HH:mm:ss.SSS
  return buildMsg(parseCanIdStr(canId), 'YDRAW', arrBuff(data), {
    direction,
    time
  })
}

export const isYDRAWOut = (input: string) => {
  if (input.charAt(8) !== ' ') return false
  return true
}
export const parseYDRAWOut = (input: string) => {
  const parts = input.split(' ')
  if (parts.length < 4) return buildErr('YDRAW', 'Invalid parts.', input)
  const [canId, ...data] = parts // time format HH:mm:ss.SSS
  return buildMsg(parseCanIdStr(canId), 'YDRAW', arrBuff(data))
}
//19F51323 01 02<CR><LF>
export const encodeYDRAW = ({ data, ...canIdInfo }: any) => {
  const canId = encodeCanIdString(canIdInfo)
  const pgns =
    data.length > 8 || canIdInfo.pgn == 126720 ? getPlainPGNs(data) : [data]
  return pgns.map((buffer) => canId + ' ' + byteString(buffer, ' '))
}

//16:29:27.082 R 19F51323 01 02<CR><LF>
export const encodeYDRAWFull = ({ data, ...canIdInfo }: any) => {
  const canId = encodeCanIdString(canIdInfo)
  const pgns =
    data.length > 8 || canIdInfo.pgn == 126720 ? getPlainPGNs(data) : [data]
  return pgns.map(
    (buffer) =>
      moment().utc().format('hh:mm:ss.SSS') +
      ' R ' +
      canId +
      ' ' +
      byteString(buffer, ' ')
  )
}

const get0183Sentence = (msg: string) => {
  let sentence = msg
  if (sentence.charAt(0) === '\\') {
    const split = sentence.split('\\')
    if (split.length < 3) {
      return undefined
    }
    sentence = split[2]
  }
  return sentence
}

// $PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59
export const isPCDIN = (msg: string) => {
  const sentence = get0183Sentence(msg)
  return sentence ? sentence.startsWith('$PCDIN,') : false
}
export const parsePCDIN = (input: string) => {
  const sentence = get0183Sentence(input)
  if (sentence) {
    const [prefix, pgn, timeHex, src, data] = sentence.split(',')
    let timer = parseInt(timeHex, 32)

    timer = timer / 1024
    timer = timer + 1262304000 // starts epoch time from 1/1/2010
    timer = timer * 1000

    return buildMsg(
      buildCanId(0, parseInt(pgn, 16), 255, parseInt(src, 16)),
      'PCDIN',
      Buffer.from(rmChecksum(data), 'hex'),
      { coalesced: true, prefix, timer, timestamp: new Date(timer) }
    )
  }
}

export const encodePCDIN = ({
  prefix = '$PCDIN',
  pgn,
  data,
  dst = 255
}: any) => {
  const sentence = [
    prefix,
    toPaddedHexString(pgn, 6),
    '0000180C',
    hexByte(dst).toUpperCase(),
    byteString(data, '').toUpperCase()
  ].join(',')
  return sentence + compute0183Checksum(sentence)
}

const changeEndianness = (string: string) => {
  const result = []
  let len = string.length - 2
  while (len >= 0) {
    result.push(string.substr(len, 2))
    len -= 2
  }
  return result.join('')
}

// $MXPGN,01F801,2801,C1308AC40C5DE343*19
export const isMXPGN = (msg: string) => {
  const sentence = get0183Sentence(msg)
  return sentence ? sentence.startsWith('$MXPGN,') : false
}
export const parseMXPGN = (
  input: string,
  options: any | undefined = undefined
) => {
  const sentence = get0183Sentence(input)
  if (sentence) {
    const [prefix, pgn, attr_word, data] = sentence.split(',')

    const send_prio_len = parseInt(attr_word.substr(0, 2), 16)
      .toString(2)
      .padStart(8, '0')
    const addr = parseInt(attr_word.substr(2, 2), 16)
    const send = parseInt(send_prio_len.substr(0, 1), 2)
    const prio = parseInt(send_prio_len.substr(1, 3), 2)
    //const len = parseInt(send_prio_len.substr(4,4), 2);
    let src = 0,
      dst = 255

    send ? (dst = addr) : (src = addr)

    let reversed

    if (options && options.littleEndianMXPGN)
      reversed = changeEndianness(rmChecksum(data))
    else reversed = data

    return buildMsg(
      buildCanId(prio, parseInt(pgn, 16), dst, src),
      'MXPGN',
      Buffer.from(reversed, 'hex'),
      { coalesced: true, prefix }
    )
  }
}

export const encodeMXPGN = ({
  prefix = '$MXPGN',
  pgn,
  prio,
  src,
  data
}: any) => {
  if (src > 255) src = 255
  if (!prio) prio = 3
  if (!src) src = 255
  const dataLength = hexByte(
    128 + prio * 16 + byteString(data, '').toUpperCase().length / 2
  ).toUpperCase()
  const attribWord = dataLength + hexByte(src).toUpperCase()

  const buff = Buffer.from(byteString(data, ''), 'hex')
  for (let i = 0, j = buff.length - 1; i < j; ++i, --j) {
    const t = buff[j]

    buff[j] = buff[i]
    buff[i] = t
  }

  const sentence = [
    prefix,
    toPaddedHexString(pgn, 6),
    attribWord,
    buff.toString('hex').toUpperCase()
  ].join(',')
  return sentence + compute0183Checksum(sentence)
}

// iKonvert
// !PDGY,126992,3,2,255,0.563,d2009e45b3b8821d
export const isPDGY = startsWith('!PDGY,')
export const parsePDGY = (input: string) => {
  const parts = input.split(',')
  if (parts.length === 7) {
    const [prefix, pgn, prio, src, dst, timer, data] = parts
    return buildMsg(
      buildCanId(prio, pgn, dst, src),
      'PDGY',
      Buffer.from(data, 'base64'),
      { timer: Number(timer), prefix, coalesced: true }
    )
  } else if (parts.length === 4) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [prefix, pgn, dst, data] = parts
    return buildMsg(
      buildCanId(0, pgn, dst, 0),
      'PDGY',
      Buffer.from(data, 'base64'),
      { coalesced: true }
    )
  } else {
    return buildErr('iKonvert', 'Invalid parts.', input)
  }
}
export const encodePDGY = ({ prefix = '!PDGY', pgn, data, dst = 255 }: any) =>
  [prefix, pgn, dst, data.toString('base64')].join(',')

export const isPDGYdebug = startsWith('$PDGY,')
export const parsePDGYdebug = (input: string) => {
  const [prefix, pgn, ...fieldParts] = input.split(',')
  const fieldVals = fieldParts.map(toNumber)
  const fields = zipObject(
    ['busLoad', 'errors', 'deviceCount', 'timer', 'gatewaySrc', 'rejectedTX'],
    fieldVals
  )
  const src = fields.gatewaySrc
  return buildMsg(
    buildCanId(3, pgn, src, src),
    'PDGYdebug',
    Buffer.from(fieldVals),
    { fields, prefix }
  )
}

// candump1 Angstrom
// <0x18eeff01> [8] 05 a0 be 1c 00 a0 a0 c0
export const isCandump1 = startsWith('<0x')
export const parseCandump1 = (input: string) => {
  const [canId, len, ...data] = input.split(' ')
  return buildMsg(parseCanIdStr(trimWrap(canId)), 'candump1', arrBuff(data), {
    len: Number(trimWrap(len))
  })
}
export const encodeCandump1 = ({ data, pgn, src, dst, prio }: any) => {
  const canId = encodeCanIdString({ pgn, src, dst, prio })
  const pgns = data.length > 8 || pgn == 126720 ? getPlainPGNs(data) : [data]
  return pgns.map(
    (buffer) => `<0x${canId}> [${buffer.length}] ${byteString(buffer, ' ')}`
  )
}

// candump2 Debian
// can0  09F8027F   [8]  00 FC FF FF 00 00 FF FF
export const isCandump2 = startsWith('can')
export const parseCandump2 = (input: string) => {
  const [bus, canId, len, ...data] = compact(input.split(' '))
  return buildMsg(parseCanIdStr(canId), 'candump2', arrBuff(data), {
    bus,
    len: Number(trimWrap(len))
  })
}
export const encodeCandump2 = ({
  data,
  bus = 'can0',
  pgn,
  src,
  dst,
  prio
}: any) => {
  const canId = encodeCanIdString({ pgn, src, dst, prio })
  const pgns =
    data.length > 8 || pgn.pgn == 126720 ? getPlainPGNs(data) : [data]
  return pgns.map(
    (buffer) =>
      `${bus}  ${canId}   [${buffer.length}]  ${byteString(buffer, ' ')}`
  )
}

// candump3 log
// (1502979132.106111) slcan0 09F50374#000A00FFFF00FFFF
export const isCandump3 = startsWith('(')
export const parseCandump3 = (input: string) => {
  const [timestamp, bus, canFrame] = input.split(' ')
  const [canId, data] = canFrame.split('#')
  return buildMsg(parseCanIdStr(canId), 'candump3', Buffer.from(data, 'hex'), {
    timestamp,
    bus
  })
}

export const encodeCandump3 = ({
  data,
  timestamp,
  bus = 'slcan0',
  pgn,
  src,
  dst,
  prio
}: any) => {
  const canId = encodeCanIdString({ pgn, src, dst, prio })
  const timestampStr = timestamp || Date.now() / 1000
  const pgns = data.length > 8 || pgn == 126720 ? getPlainPGNs(data) : [data]
  return pgns.map(
    (buffer) =>
      `(${timestampStr}) ${bus} ${canId}#${byteString(buffer, '').toUpperCase()}`
  )
}

const hasErr = overSome([negate(isString), isEmpty])
export const parseN2kString = (str: string, options?: any): any => {
  if (hasErr(str)) {
    return buildErr('INVALID', 'Input not string or empty.', str)
  }
  if (isActisense(str)) {
    return parseActisense(str)
  }
  if (isYDRAW(str)) {
    return parseYDRAW(str)
  }
  if (isYDRAWOut(str)) {
    return parseYDRAWOut(str)
  }
  if (isPCDIN(str)) {
    return parsePCDIN(str)
  }
  if (isMXPGN(str)) {
    return parseMXPGN(str, options)
  }
  if (isPDGY(str)) {
    return parsePDGY(str)
  }
  if (isCandump1(str)) {
    return parseCandump1(str)
  }
  if (isCandump2(str)) {
    return parseCandump2(str)
  }
  if (isCandump3(str)) {
    return parseCandump3(str)
  }
  if (isPDGYdebug(str)) {
    return parsePDGYdebug(str)
  }
  if (isActisenseN2KASCII(str)) {
    return parseActisenseN2KASCII(str)
  }
  return buildErr('MISSING_PARSER', 'Parser not found for input.', str)
}

export const isN2KString = cond([
  [hasErr, () => false],
  [isActisense, () => true],
  [isYDRAW, () => true],
  [isPCDIN, () => true],
  [isMXPGN, () => true],
  [isPDGY, () => true],
  [isCandump1, () => true],
  [isCandump2, () => true],
  [isCandump3, () => true],
  [isPDGYdebug, () => true],
  [isActisenseN2KASCII, () => true],
  [stubTrue, () => false]
])

export const isN2KOver0183 = (msg: string) => {
  return isPCDIN(msg) || isMXPGN(msg)
}

export const parseN2KOver0183 = (msg: string) => {
  return parsePCDIN(msg) || parseMXPGN(msg)
}
