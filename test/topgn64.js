const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')

// toPgn writes back what it decoded, as canboat does (#571).
const roundTrip = (pgn, hex) => {
  const data = Buffer.from(hex, 'hex')
  const decoded = new FromPgn({ useCamel: true }).parsePgnData(
    { pgn, prio: 3, src: 1, dst: 255 },
    data.length,
    data,
    true,
    undefined
  )
  return Buffer.from(toPgn(decoded)).toString('hex')
}

describe('toPgn and 64-bit values', function () {
  it('writes a 64-bit dynamic value from its digits', function () {
    // 130822 Navico Configuration Set: value is 13869005477589862183.
    const hex = '1399ff03000a01001500000084ca080027c7b02f009b78c0'
    roundTrip(130822, hex).should.equal(hex)
  })

  it('writes a 64-bit count of 1e-16 from its decimal digits', function () {
    // 129029: a longitude of -122.77457 is -1227745700000000000 counts,
    // which dividing as numbers gets one off.
    const hex =
      'ae000014000014007885a6a50b37050098fc6cca2bf6ee00140000140000141000140000140000140000140000140000140000'
    roundTrip(129029, hex).should.equal(hex)
  })

  it('writes a 64-bit count with more digits than a number holds as before', function () {
    const fields = {
      sid: 0,
      latitude: 1,
      longitude: 1,
      altitude: 1441151966657.9097
    }
    const hex = Buffer.from(toPgn({ pgn: 129029, fields })).toString('hex')
    // altitude, 1e-6 m: 0x1400001400001400, as the division gives it
    hex.slice(46, 62).should.equal('0014000014000014')
  })
})

describe('toPgn and the range of a 64-bit count', function () {
  it('refuses a longitude outside its range, worked out in decimal too', function () {
    ;(() =>
      toPgn({
        pgn: 129029,
        fields: { sid: 0, latitude: 1, longitude: 181 }
      })).should.throw(/Longitude/)
  })
})

describe('toPgn and a STRING_LZ', function () {
  it('writes one not given as its length byte alone', function () {
    // 130847 Navico ASCII Identifier, empty: 13 99 00, as canboat writes it.
    roundTrip(130847, '139900').should.equal('139900')
  })

  it('writes a given empty one with its NUL', function () {
    Buffer.from(
      toPgn({
        pgn: 130847,
        fields: {
          manufacturerCode: 'Navico',
          industryCode: 'Marine Industry',
          identifier: ''
        }
      })
    )
      .toString('hex')
      .should.equal('13990000')
  })
})
