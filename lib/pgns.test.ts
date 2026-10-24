import { addCustomPgns, getPgn, isFastPacket } from './pgns'

describe('getPgn', () => {
  test('Return info array about a pgn number', () => {
    const pgns = getPgn(60928)
    expect(pgns !== undefined)
    if (pgns !== undefined) {
      expect(pgns.length > 0)
      expect(pgns[0].Description).toBe('ISO Address Claim')
    }
  })
})

describe('isFastPacket', () => {
  test('a message longer than one CAN frame', () => {
    expect(isFastPacket(127250, 9)).toBe(true)
  })

  test('a single-frame PGN that fits one frame', () => {
    expect(isFastPacket(127250, 8)).toBe(false)
  })

  test('a fast-packet PGN of 8 bytes or fewer (#523)', () => {
    // 127513 Battery Configuration Status is fast-packet, 8 bytes long.
    expect(isFastPacket(127513, 8)).toBe(true)
    expect(isFastPacket(126720, 6)).toBe(true)
  })

  test('a PGN a custom definition makes fast-packet', () => {
    expect(isFastPacket(130999, 4)).toBe(false)
    addCustomPgns({ PGNs: [{ PGN: 130999, Type: 'Fast', Fields: [] }] }, 'test')
    expect(isFastPacket(130999, 4)).toBe(true)
  })
})
