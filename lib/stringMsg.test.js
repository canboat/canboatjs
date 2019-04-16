const { parseCandump1 } = require('./stringMsg')

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
