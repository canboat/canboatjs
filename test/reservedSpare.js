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
    decode(xantrex('7f')).reserved9.should.equal('00')
  })

  it('leaves out a spare field that is clear', function () {
    decode(claim('a0')).should.not.have.property('spare')
  })

  it('shows a spare field that is set', function () {
    decode(claim('a1')).spare.should.equal('01')
  })

  it('writes a spare field without a value as zeros', function () {
    Buffer.from(toPgn({ pgn: 60928, fields: decode(claim('a0')) }))
      .toString('hex')
      .should.equal('4a2a1f00ff82a0c0')
  })
})

describe('a reserved field shown as its bytes (#572)', function () {
  // 127251 Rate of Turn: reserved is the last 24 bits.
  const rot =
    '2026-07-10T06:27:57.513Z,2,127251,27,255,8,ff,8c,f4,fe,ff,26,02,ff'

  it('gives its bytes low first, as canboat prints them', function () {
    decode(rot).reserved.should.equal('26 02 FF')
  })

  it('writes them back', function () {
    Buffer.from(toPgn({ pgn: 127251, fields: decode(rot) }))
      .toString('hex')
      .should.equal('ff8cf4feff2602ff')
  })

  it('still writes a reserved field given as a number', function () {
    const fields = {
      ...decode(rot),
      reserved: 0x26 | (0x02 << 8) | (0xff << 16)
    }
    Buffer.from(toPgn({ pgn: 127251, fields }))
      .toString('hex')
      .should.equal('ff8cf4feff2602ff')
  })
})

describe('a field whose range reaches the top of its width', function () {
  // 130845 Simnet Key Value: an ADDRESS, 0-255, where 255 is the global
  // address, as canboat reads it (#566).
  const kv =
    '2026-06-08T01:52:14.727,2,130845,13,255,14,41,9f,ff,ff,01,ff,07,45,00,01,2d,7d,10,14'

  it('gives its all-ones value, which is a reading', function () {
    decode(kv).address.should.equal(255)
  })

  it('writes it back', function () {
    Buffer.from(toPgn({ pgn: 130845, fields: decode(kv) }))
      .toString('hex')
      .should.equal('419fffff01ff074500012d7d1014')
  })
})
