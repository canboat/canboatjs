const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')

// canboat's PLAIN/FAST lines take whatever precedes the first comma as the
// timestamp (crates/canboat/src/engine/format/plain.rs). Real captures use
// relative times, nanoseconds with a UTC offset, or nothing at all.
describe('PLAIN lines with any timestamp', function () {
  const payload = '2,127251,9,255,8,ff,8c,f4,fe,ff,ff,ff,ff'

  for (const ts of [
    '2016-02-28T19:57:02.364Z',
    '2016-02-28-19:57:02.364',
    '00:00:57.062',
    '481.876',
    '2026-08-09T13:42:55.841473308-07:00',
    ''
  ]) {
    it(`decodes a line stamped '${ts}'`, function () {
      const parser = new FromPgn({ useCamel: true })
      const pgn = parser.parseString(`${ts},${payload}`)
      pgn.pgn.should.equal(127251)
      pgn.src.should.equal(9)
      pgn.fields.rate.should.be.closeTo(-0.002139625, 1e-12)
    })
  }

  it('tolerates spaces around the bytes, as canboat does', function () {
    const parser = new FromPgn({ useCamel: true })
    const pgn = parser.parseString(
      '00:00:57.062,2,127251,9,255,8, ff, 8c,f4 ,fe,ff,ff,ff,ff'
    )
    pgn.fields.rate.should.be.closeTo(-0.002139625, 1e-12)
  })

  it('still reads PCDIN as PCDIN', function () {
    const parser = new FromPgn({ useCamel: true })
    const pgn = parser.parseString(
      '$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    )
    pgn.pgn.should.equal(127257)
  })
})
