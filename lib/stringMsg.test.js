const {
  encodeActisense, parseActisense, parseCandump1, parsePCDIN, parsePDGY, parseN2kString
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
      timer: 0,
      timestamp: new Date(0),
    })
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
    const errMsg = { error: new Error('Parser not found for input.'), input: 'foo,bar' }
    expect(parseN2kString('foo,bar')).toEqual(errMsg)
  })
})
