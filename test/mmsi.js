const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')

// An MMSI decodes as canboat decodes it (decode_mmsi): a 9-digit string with
// leading zeros kept; 0 (no station holds MID 000) and the three reserved top
// values are not available.
describe('MMSI decoding, as canboat', function () {
  const report = (mmsi) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(mmsi)
    const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join(',')
    return (
      `2026-01-01T00:00:00.000Z,4,129039,43,255,27,12,${hex},2f,3c,5c,d2,f3,` +
      '8b,ce,3a,17,b5,ff,ff,ff,ff,ff,ff,ff,7f,ff,ff,ff,ff,ff'
    )
  }
  const userId = (mmsi) =>
    new FromPgn({ useCamel: true, returnNulls: true }).parseString(report(mmsi))
      .fields.userId

  it('keeps the leading zeros of a coast station', function () {
    userId(3660611).should.equal('003660611')
  })

  it('is a 9-digit string for a ship', function () {
    userId(338184312).should.equal('338184312')
  })

  for (const [name, value] of [
    ['0', 0],
    ['0xfffffffd (reserved)', 0xfffffffd],
    ['0xfffffffe (out of range)', 0xfffffffe],
    ['0xffffffff (not available)', 0xffffffff]
  ]) {
    it(`is not available for ${name}`, function () {
      chai.expect(userId(value)).to.equal(null)
    })
  }
})
