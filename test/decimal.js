const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')
const { getPgn } = require('../dist/pgns')

// DECIMAL holds two decimal digits per byte, as canboat decodes it
// (analyzer/tests/pgn-decimal.in): PGN 129808's DSC Message Address.
describe('DECIMAL fields', () => {
  // format 1: each line is a whole message, so a short one is not taken
  // as the first frame of a fast packet.
  const decode = (line) =>
    new FromPgn({ useCamel: true, format: 1 }).parseString(line).fields

  it('decodes each byte as two digits, as a string', () => {
    decode(
      '2026-10-03T00:00:00.000Z,3,129808,1,255,10,70,6c,17,32,4c,27,1e,27,ff,ff'
    ).dscMessageAddress.should.equal('235076393')
  })

  // A DSC call sends a 9-digit MMSI with a 0 added at the end (ITU-R M.585).
  it('drops the 0 a DSC call adds after an MMSI', () => {
    decode(
      '2026-10-03T00:00:00.000Z,3,129808,1,255,10,78,6c,18,28,3c,50,46,27,ff,ff'
    ).dscMessageAddress.should.equal('244060807')
  })

  it("keeps a coast station's leading zeros", () => {
    decode(
      '2026-10-03T00:00:00.000Z,3,129808,1,255,10,78,6c,00,16,29,02,28,27,ff,ff'
    ).dscMessageAddress.should.equal('002241024')
  })

  it('keeps a last digit that is not 0', () => {
    decode(
      '2026-10-03T00:00:00.000Z,3,129808,1,255,10,78,6c,18,28,3c,50,47,27,ff,ff'
    ).dscMessageAddress.should.equal('2440608071')
  })

  // canboat marks the address with TrailingZeroIsDigitField/Value: in a call
  // to a geographical area (DSC Format 102) all ten digits count.
  it('keeps the last 0 when the field it names says it is a digit', () => {
    const fields = getPgn(129808).flatMap((d) => d.Fields)
    const address = fields.filter((f) => f.Id === 'dscMessageAddress')
    address.forEach((f) => {
      f.TrailingZeroIsDigitField = 1
      f.TrailingZeroIsDigitValue = 102
    })
    try {
      decode(
        '2026-10-03T00:00:00.000Z,3,129808,1,255,10,66,6c,0f,14,04,05,0a,27,ff,ff'
      ).dscMessageAddress.should.equal('1520040510')
      decode(
        '2026-10-03T00:00:00.000Z,3,129808,1,255,10,78,6c,0f,14,04,05,0a,27,ff,ff'
      ).dscMessageAddress.should.equal('152004051')
    } finally {
      address.forEach((f) => {
        delete f.TrailingZeroIsDigitField
        delete f.TrailingZeroIsDigitValue
      })
    }
  })

  it('leaves out a field with a byte that is not two digits', () => {
    decode(
      '2026-10-03T00:00:00.000Z,3,129808,1,255,10,70,6c,17,32,ab,27,1e,27,ff,ff'
    ).should.not.have.property('dscMessageAddress')
  })

  it('leaves out a field the message ends in', () => {
    decode(
      '2026-10-03T00:00:00.000Z,3,129808,1,255,4,70,6c,17,32'
    ).should.not.have.property('dscMessageAddress')
  })

  const encode = (dscMessageAddress) =>
    Buffer.from(
      toPgn({
        pgn: 129808,
        prio: 3,
        src: 1,
        dst: 255,
        fields: { dscFormat: 'Distress', dscMessageAddress }
      })
    )
      .subarray(2, 7)
      .toString('hex')

  it('encodes the digits two per byte', () => {
    encode('2350763930').should.equal('17324c271e')
  })

  it('adds the 0 a DSC call sends after a 9-digit MMSI', () => {
    encode('235076393').should.equal('17324c271e')
    encode('002442000').should.equal('00182a0000')
  })

  it("zero-fills a number to 9 digits, as it lost an MMSI's leading zeros", () => {
    encode(2442000).should.equal('00182a0000')
    encode(235076393).should.equal('17324c271e')
  })

  it('encodes an unset field as not available', () => {
    encode(undefined).should.equal('ffffffffff')
  })

  it('refuses a value that is not digits or does not fit', () => {
    ;(() => encode('23507x3930')).should.throw('Invalid value')
    ;(() => encode('12345678901')).should.throw('Invalid value')
  })
})
