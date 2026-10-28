const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')

// As canboat: a reserved field is left out when all its bits are set, also
// a single bit, and a spare field when they are all clear. Anything else is
// shown, as the definition may be wrong. toPgn writes a spare field without
// a value as zeros.

function decode(line) {
  return new FromPgn({ useCamel: true }).parseString(line).fields
}

// 130900 Xantrex AC Status: reserved9 is bit 39, the top bit of byte 4.
const xantrex = (byte4) =>
  `2026-10-23T00:00:00.000Z,6,130900,0,255,20,a8,98,ff,ff,${byte4},ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,ff,ff,ff,7f,7f`

// 60928 ISO Address Claim: spare is bit 48, the low bit of byte 6.
const claim = (byte6) =>
  `2026-10-27T00:00:00.000Z,6,60928,7,255,8,4a,2a,1f,00,ff,82,${byte6},c0`

describe('reserved and spare fields', function () {
  it('leaves out a 1-bit reserved field that is set', function () {
    decode(xantrex('ff')).should.not.have.property('reserved9')
  })

  it('shows a 1-bit reserved field that is clear', function () {
    decode(xantrex('7f')).reserved9.should.equal(0)
  })

  it('leaves out a spare field that is clear', function () {
    decode(claim('a0')).should.not.have.property('spare')
  })

  it('shows a spare field that is set', function () {
    decode(claim('a1')).spare.should.equal(1)
  })

  it('writes a spare field without a value as zeros', function () {
    Buffer.from(toPgn({ pgn: 60928, fields: decode(claim('a0')) }))
      .toString('hex')
      .should.equal('4a2a1f00ff82a0c0')
  })
})
