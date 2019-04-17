const { parseActisense, parseCandump1 } = require('./stringMsg')

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
