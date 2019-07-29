const {
  encodeActisense, encodeYDRAW, parseActisense, parseCandump1,
  parsePCDIN, parsePDGY, parseN2kString, parsePDGYdebug, parseYDRAW,
} = require('./stringMsg')

/* globals describe test expect */

describe('parseCandump1', () => {
  test('basic messages', () => {
    const msg = '<0x18eeff01> [8] 05 a0 be 1c 00 a0 a0 c0 '
    expect(parseCandump1(msg)).toEqual({
      canId: 0x18eeff01,
      data: Buffer.from('05a0be1c00a0a0c0', 'hex'),
      dst: 255,
      format: 'candump1',
      len: 8,
      src: 1,
      pgn: 60928,
      prio: 6,
    })
    const msg2 = '<0x18ea2301> [3] 14 f0 01 '
    expect(parseCandump1(msg2)).toEqual({
      canId: 0x18ea2301,
      data: Buffer.from('14f001', 'hex'),
      dst: 35,
      format: 'candump1',
      len: 3,
      src: 1,
      pgn: 59904,
      prio: 6,
    })

  })
})

describe('parseActisense', () => {
  test('basic msg', () => {
    const msg = '2016-04-09T16:41:09.078Z,3,127257,17,255,8,00,ff,7f,52,00,21,fe,ff'
    expect(parseActisense(msg)).toEqual({
      data: Buffer.from('00ff7f520021feff', 'hex'),
      dst: 255,
      len: 8,
      format: 'Actisense',
      pgn: 127257,
      prio: 3,
      src: 17,
      timestamp: '2016-04-09T16:41:09.078Z',
    })
  })
})
describe('encodeActisense', () => {
  test('basic msg', () => {
    const msg = '2016-04-09T16:41:09.078Z,3,127257,17,255,8,00,ff,7f,52,00,21,fe,ff'
    const n2k = parseActisense(msg)
    const res = encodeActisense(n2k)
    expect(res).toEqual(msg)
  })
})

const pdgyLong = '!PDGY,129029,3,2,255,483.236,UZ9FfR+bI/////////9//////////3//////////fwD8AIgTiBMAAAAAAQAAAAA'
describe('parsePDGY', () => {
  test('basic msg', () => {
    const msg = '!PDGY,126992,3,2,255,0.563,d2009e45b3b8821d'
    expect(parsePDGY(msg)).toEqual({
      data: Buffer.from('d2009e45b3b8821d', 'base64'),
      dst: 255,
      format: 'PDGY',
      prefix: '!PDGY',
      pgn: 126992,
      prio: 3,
      src: 2,
      timer: 0.563,
    })
  })
  test('long msg', () => {
    expect(parsePDGY(pdgyLong)).toEqual({
      data: Buffer.from('UZ9FfR+bI/////////9//////////3//////////fwD8AIgTiBMAAAAAAQAAAAA', 'base64'),
      dst: 255,
      format: 'PDGY',
      prefix: '!PDGY',
      pgn: 129029,
      prio: 3,
      src: 2,
      timer: 483.236,
    })
  })
})
describe('parsePDGYdebug', () => {
  test('basic msg', () => {
    const msg = '$PDGY,000000,4,,5,482,1,0'
    expect(parsePDGYdebug(msg)).toEqual({
      data: Buffer.from([4,0,5,482,1,0]),
      dst: 1,
      format: 'PDGYdebug',
      prefix: '$PDGY',
      pgn: 0,
      prio: 3,
      src: 1,
      fields: {
        busLoad: 4,
        deviceCount: 5,
        errors: 0,
        gatewaySrc: 1,
        rejectedTX: 0,
        timer: 482,
      }
    })
  })
})

describe('parsePCDIN', () => {
  test('basic msg', () => {
    const msg = '$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    expect(parsePCDIN(msg)).toEqual({
      data: Buffer.from('2AAF00D1067414FF', 'hex'),
      dst: 255,
      format: 'PCDIN',
      prefix: '$PCDIN',
      pgn: 127257,
      prio: 0,
      src: 15,
      timer: 1262304000000,
      timestamp: new Date("2010-01-01T00:00:00.000Z"),
    })
  })
})

describe('parseYDRAW', () => {
  test('basic msg', () => {
    const msg = '16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6'
    expect(parseYDRAW(msg)).toEqual({
      canId: 0x09F8017F,
      data: Buffer.from('50C3B81347D82BC6', 'hex'),
      direction: 'R',
      dst: 255,
      format: 'YDRAW',
      pgn: 129025,
      prio: 2,
      src: 127,
      time: '16:29:27.082',
    })
  })
})
describe('encodeYDRAW', () => {
  test('long msg', () => {
    expect(encodeYDRAW(parsePDGY(pdgyLong))).toEqual([
      "0df80502 40 2f 51 9f 45 7d 1f 9b",
      "0df80502 41 23 ff ff ff ff ff ff",
      "0df80502 42 ff 7f ff ff ff ff ff",
      "0df80502 43 ff ff 7f ff ff ff ff",
      "0df80502 44 ff ff ff 7f 00 fc 00",
      "0df80502 45 88 13 88 13 00 00 00",
      "0df80502 46 00 01 00 00 00 ff ff",
    ])
  })
})
describe('parseN2kString', () => {
  test('empty string or not string', () => {
    const emptyMsg = 'Input not string or empty.'
    expect(parseN2kString('').error.message).toBe(emptyMsg)
    expect(parseN2kString('').input).toBe('')
    expect(parseN2kString(5).error.message).toBe(emptyMsg)
    expect(parseN2kString(5).input).toBe(5)
  })
  test('parser not found', () => {
    const errMsg = {
      error: new Error('Parser not found for input. - foo,bar'),
      input: 'foo,bar',
      format: 'MISSING_PARSER',
    }
    expect(parseN2kString('foo,bar')).toEqual(errMsg)
  })
})
