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

describe('fields without a value for "not available" (#567)', function () {
  const parse = (line) =>
    new FromPgn({ useCamel: true, format: 1 }).parseString(line)
  const back = (pgn) => Buffer.from(toPgn(pgn)).toString('hex')

  it('gives binary data that is all ones', function () {
    const pgn = parse(
      '2022-09-10T12:06:57.789Z,5,65317,8,255,8,13,99,ff,ff,ff,ff,ff,ff'
    )
    pgn.fields.should.have.property('data')
    back(pgn).should.equal('1399ffffffffffff')
  })

  it('gives a spare field that is all ones', function () {
    const pgn = parse(
      '2016-04-09T16:41:11.608Z,7,129793,0,255,26,04,28,43,25,00,a5,f1,09,03,c3,dc,60,1f,fd,ff,ff,ff,ff,67,c1,0b,ff,ff,7f,ff,ff'
    )
    pgn.fields.spare15.should.equal('FF 03')
  })

  it('gives a group function parameter whose binary value is all ones', function () {
    // 126208 Command of 65379 Seatalk Pilot Mode: parameter 5, the 16-bit
    // binary sub mode, is ff ff. Without it the command could not be
    // written back.
    const pgn = parse(
      '2024-02-17T03:46:04.576Z,3,126208,0,204,17,01,63,ff,00,f8,04,01,3b,07,03,04,04,00,00,05,ff,ff'
    )
    pgn.fields.list[3].should.include({ parameter: 5 })
    pgn.fields.list[3].should.have.property('value')
    back(pgn).should.equal('0163ff00f804013b07030404000005ffff')
  })

  it('gives the bytes there are of binary data the message ends inside', function () {
    // 262384 Actisense Startup Status: 1 of the reset status's 4 bytes.
    const pgn = parse(
      '2011-04-25-06:24:59.786,0,262384,0,0,14,01,0e,00,ab,b0,01,00,00,00,00,00,8e,08,00'
    )
    pgn.fields.resetStatus.should.equal('00')
    back(pgn).should.equal('010e00abb00100000000008e0800')
  })

  it('still leaves out a NAME that is all ones', function () {
    const pgn = parse(
      '2026-06-08T01:52:44.336,3,130840,48,255,17,41,9f,ff,13,01,fe,ff,6b,ff,ff,ff,ff,ff,ff,ff,ff,ff'
    )
    pgn.fields.should.not.have.property('source')
  })

  it('keeps all the bits of 64-bit binary data, and writes them back', function () {
    // 126720 Seatalk1 Pilot Hull Type: unknown2 is 64 bits, more than a
    // number holds exactly.
    for (const bytes of ['0123456789abcdef', 'ffffffffffffffff']) {
      const pgn = parse(
        '2024-02-17T05:15:49.807Z,7,126720,204,255,14,3b,9f,6c,16,00,05,' +
          bytes.match(/../g).join(',')
      )
      pgn.fields.unknown2.should.equal(
        bytes.toUpperCase().match(/../g).join(' ')
      )
      back(pgn).should.equal('3b9f6c160005' + bytes)
    }
  })
})
