const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')

// canboat.json gives Offset in the field's own units, i.e. after Resolution
// is applied. PGN 127513 Peukert Exponent is the field where that matters:
// Offset 1, Resolution 0.002, so 1.25 is 125 on the wire, not 624.
describe('scaled field offset', function () {
  const fields = { instance: 0, capacity: 100 }

  it('encodes the offset in field units', function () {
    toPgn({
      pgn: 127513,
      fields: { ...fields, peukertExponent: 1 }
    })[6].should.equal(0)
    toPgn({
      pgn: 127513,
      fields: { ...fields, peukertExponent: 1.25 }
    })[6].should.equal(125)
    toPgn({
      pgn: 127513,
      fields: { ...fields, peukertExponent: 1.5 }
    })[6].should.equal(250)
  })

  it('treats raw values above RangeMax as invalid', function () {
    const parser = new FromPgn({ returnNulls: true, useCamel: true })
    let pgn
    for (const line of [
      '2026-05-06T12:00:00.000Z,6,127513,35,255,8,40,08,00,12,01,64,00,fb',
      '2026-05-06T12:00:00.001Z,6,127513,35,255,8,41,fb,5a,ff,ff,ff,ff,ff'
    ]) {
      pgn = parser.parseString(line) || pgn
    }
    chai.expect(pgn.fields.peukertExponent).to.equal(null)
  })
})
