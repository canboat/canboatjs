const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')

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
    ).dscMessageAddress.should.equal('2350763930')
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

  it('encodes the digits two per byte, padding with leading zeros', () => {
    encode('2350763930').should.equal('17324c271e')
    encode('002442000').should.equal('00022c1400')
  })

  it('encodes an unset field as not available', () => {
    encode(undefined).should.equal('ffffffffff')
  })

  it('refuses a value that is not digits or does not fit', () => {
    ;(() => encode('23507x3930')).should.throw('Invalid value')
    ;(() => encode('12345678901')).should.throw('Invalid value')
  })
})
