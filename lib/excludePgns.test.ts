// The excludePgns option, shared by CanChannel (kernel filter) and FromPgn.

import { NETWORK_MANAGEMENT_PGNS, parseExcludePgns } from './excludePgns'

describe('parseExcludePgns', () => {
  test('takes an array of numbers or strings, or a separated string', () => {
    expect(parseExcludePgns([130824, '127251']).pgns).toEqual([130824, 127251])
    expect(parseExcludePgns('130824, 127251 129540').pgns).toEqual([
      130824, 127251, 129540
    ])
    expect(parseExcludePgns(130824).pgns).toEqual([130824])
  })

  test('nothing to exclude', () => {
    for (const option of [undefined, null, '', [], [''], {}]) {
      expect(parseExcludePgns(option)).toEqual({ pgns: [], ignored: [] })
    }
  })

  test('skips what is not a PGN, and lists it', () => {
    const { pgns, ignored } = parseExcludePgns([
      'abc',
      -1,
      0x20000,
      1.5,
      '130824, 127251',
      130824
    ])
    expect(pgns).toEqual([130824])
    expect(ignored).toEqual([
      'abc (not a PGN)',
      '-1 (not a PGN)',
      '131072 (not a PGN)',
      '1.5 (not a PGN)',
      '130824, 127251 (not a PGN)'
    ])
  })

  test('reads a string with commas, spaces, tabs and newlines', () => {
    expect(parseExcludePgns(' 130824,,127251\t129029\n').pgns).toEqual([
      130824, 127251, 129029
    ])
    expect(parseExcludePgns(130824).pgns).toEqual([130824])
  })

  test('tells which PGN to give for a PDU1 PGN with a destination', () => {
    expect(parseExcludePgns([59905, 61185])).toEqual({
      pgns: [],
      ignored: [
        '59905 (PDU1 PGN with a destination, use 59904)',
        '61185 (PDU1 PGN with a destination, use 61184)'
      ]
    })
    expect(parseExcludePgns([60928]).ignored).toEqual([
      '60928 (network management)'
    ])
  })

  test('never takes a network management PGN', () => {
    const { pgns, ignored } = parseExcludePgns([
      ...NETWORK_MANAGEMENT_PGNS,
      130824
    ])
    expect(pgns).toEqual([130824])
    expect(ignored).toHaveLength(NETWORK_MANAGEMENT_PGNS.length)
  })

  test('each PGN once, and no limit on how many', () => {
    expect(parseExcludePgns([130824, 130824]).pgns).toEqual([130824])
    const many = Array.from({ length: 600 }, (_, i) => 129024 + i)
    expect(parseExcludePgns(many)).toEqual({ pgns: many, ignored: [] })
  })
})
