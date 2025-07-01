const { encodeCanId, parseCanId, parseEncode } = require('./canId')

/* globals describe test expect */

describe('parseCanId', () => {
  test('Return object with canId broken into properties', () => {
    expect(parseCanId(0x18eeff01)).toEqual({
      canId: 0x18eeff01,
      dst: 255,
      src: 1,
      pgn: 60928,
      prio: 6
    })
    expect(parseCanId(0xcf004ee)).toEqual({
      canId: 0xcf004ee,
      dst: 255,
      src: 0xee,
      pgn: 0xf004,
      prio: 0xc >> 2
    })
    expect(parseCanId(0x18ea2301)).toEqual({
      canId: 0x18ea2301,
      dst: 35,
      src: 0x01,
      pgn: 0xea00,
      prio: 6
    })
    expect(parseCanId(0x09f8017f)).toEqual({
      canId: 0x09f8017f,
      dst: 255,
      src: 127,
      pgn: 129025,
      prio: 2
    })
    expect(parseCanId(0x0df8057f)).toEqual({
      canId: 0x0df8057f,
      dst: 255,
      src: 127,
      pgn: 129029,
      prio: 3
    })
  })
})
describe('encodeCanId', () => {
  test('Return canId number from object', () => {
    expect(
      encodeCanId({ src: 1, pgn: 60928, prio: 6, dst: 255 }).toString(2)
    ).toBe((0x18eeff01).toString(2))
    expect(encodeCanId({ src: 238, pgn: 61444, prio: 3 })).toBe(0xcf004ee)
  })
})

describe('parseEncode', () => {
  test('Return exactly same number after parse and encode', () => {
    expect(parseEncode(0x18eeff01)).toBe(0x18eeff01)
    expect(parseEncode(0xcf004ee)).toBe(0xcf004ee)
    expect(parseEncode(0x18ea2301)).toBe(0x18ea2301)
    expect(parseEncode(0x09f8017f)).toBe(0x09f8017f)
    expect(parseEncode(0x0df8057f)).toBe(0x0df8057f)
  })
})
