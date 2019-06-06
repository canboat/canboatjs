const { getPgn, getPgn0, pgns } = require('./pgns')

// console.log(pgns)
describe('getPgn', () => {
  test('Return info array about a pgn number', () => {
    expect(getPgn('60928')[0].Description).toBe('ISO Address Claim')
  })
})
describe('getPgn0', () => {
  test('Return first info object about a pgn number', () => {
    expect(getPgn0('60928').Description).toBe('ISO Address Claim')
  })
})
