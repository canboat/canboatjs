import { getPgn } from './pgns'

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
