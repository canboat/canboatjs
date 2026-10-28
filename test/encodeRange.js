const { expect } = require('chai')
const { FromPgn, toPgn } = require('../dist/index')
const { addCustomPgns } = require('../dist/pgns')

// A number outside its field's range is refused rather than wrapped at the
// field width into some other value (#524), as canboat/canboat#975.
describe('encoding a value outside its range', function () {
  const battery = (fields) =>
    toPgn({
      pgn: 127513,
      fields: {
        Instance: 1,
        Capacity: 720000, // 200 Ah, in coulombs
        'Peukert Exponent': 1.25,
        'Charge Efficiency Factor': 0.95,
        ...fields
      }
    })
  const wind = (angle) =>
    toPgn({ pgn: 130306, fields: { windAngle: angle, reference: 'Apparent' } })
  const decodeWind = (buffer) =>
    new FromPgn({ useCamel: true }).parseString(
      `2026-01-01T00:00:00.000Z,2,130306,1,255,8,${[...buffer]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(',')}`
    ).fields.windAngle

  it('refuses the values #524 found wrapping', function () {
    expect(() => battery({ Instance: 300 })).to.throw(
      "field 'Instance': value 300 is outside its range 0 to 252"
    )
    expect(() => battery({ 'Charge Efficiency Factor': 1.3 })).to.throw(
      "field 'Charge Efficiency Factor': value 1.3 is outside its range -1.28 to 1.24"
    )
    expect(() => battery({ 'Charge Efficiency Factor': 2.56 })).to.throw(
      /Charge Efficiency Factor/
    )
    // 95 % given as 95 rather than the ratio 0.95
    expect(() => battery({ 'Charge Efficiency Factor': 95 })).to.throw(
      /Charge Efficiency Factor/
    )
    expect(() => battery({ 'Peukert Exponent': 1.6 })).to.throw(
      "field 'Peukert Exponent': value 1.6 is outside its range 1 to 1.5"
    )
  })

  it('takes either end of the range', function () {
    expect(battery({ Instance: 252, 'Peukert Exponent': 1.5 })).to.be.ok
    expect(battery({ Instance: 0, 'Peukert Exponent': 1 })).to.be.ok
  })

  it('rounds a value within half a step past an end onto it', function () {
    // RangeMax is 6.28318530717959 rad at 0.0001: raw 62832.
    expect(wind(6.2832).readUInt16LE(3)).to.equal(62832)
    expect(() => wind(6.2833)).to.throw(/Wind Angle/)
  })

  it('takes a negative angle down to half a turn as the same direction', function () {
    // Signal K gives a port angle as -pi..0.
    expect(decodeWind(wind(-0.5))).to.equal(5.7832)
    expect(decodeWind(wind(-Math.PI))).to.equal(3.1416)
    expect(() => wind(-3.2)).to.throw(/Wind Angle/)
  })

  it("writes a field's not-available value as given, warning once", async function () {
    // Signal K's conversions send SID 0xff for "no SID". Deprecated: the
    // next major release refuses it.
    const warnings = []
    const onWarning = (w) => warnings.push(w)
    process.on('warning', onWarning)
    const data = toPgn({ pgn: 128267, fields: { SID: 0xff, Depth: 4.5 } })
    toPgn({ pgn: 128267, fields: { SID: 0xff, Depth: 4.5 } })
    await new Promise((resolve) => setImmediate(resolve))
    process.off('warning', onWarning)
    expect(data[0]).to.equal(0xff)
    expect(warnings.map((w) => w.name)).to.deep.equal(['DeprecationWarning'])
    expect(warnings[0].message).to.include("field 'SID' was given 255")
    expect(() => toPgn({ pgn: 128267, fields: { SID: 254 } })).to.throw(
      "field 'SID': value 254 is outside its range 0 to 252"
    )
  })

  describe('in a custom PGN', function () {
    before(function () {
      addCustomPgns(
        {
          PGNs: [
            {
              PGN: 130998,
              Id: 'testRange',
              Description: 'Range test',
              Type: 'Single',
              Complete: true,
              Length: 4,
              Fields: [
                {
                  Order: 1,
                  Id: 'bearing',
                  Name: 'Bearing',
                  BitLength: 16,
                  BitOffset: 0,
                  BitStart: 0,
                  FieldType: 'NUMBER',
                  Resolution: 1,
                  Unit: 'deg',
                  PhysicalQuantity: 'ANGLE',
                  Signed: false,
                  RangeMin: 0,
                  RangeMax: 359
                },
                {
                  Order: 2,
                  Id: 'count',
                  Name: 'Count',
                  BitLength: 8,
                  BitOffset: 16,
                  BitStart: 0,
                  FieldType: 'NUMBER',
                  Resolution: 1,
                  Signed: false
                },
                {
                  Order: 3,
                  Id: 'wide',
                  Name: 'Wide',
                  BitLength: 8,
                  BitOffset: 24,
                  BitStart: 0,
                  FieldType: 'NUMBER',
                  Resolution: 1,
                  Signed: false,
                  RangeMin: -5,
                  RangeMax: 300
                }
              ]
            }
          ]
        },
        'test'
      )
    })
    const encode = (fields) => toPgn({ pgn: 130998, fields })

    it('takes a negative angle in a field of whole degrees', function () {
      // -10 degrees, given in radians, is 350 degrees.
      expect(
        encode({ bearing: (-10 * Math.PI) / 180 }).readUInt16LE(0)
      ).to.equal(350)
    })

    it('holds a field without a range to what its bits carry', function () {
      expect(encode({ count: 255 })[2]).to.equal(255)
      expect(() => encode({ count: 256 })).to.throw(
        "field 'Count': value 256 is outside its range 0 to 255"
      )
    })

    it('holds a range wider than its bits to what they carry', function () {
      expect(encode({ wide: 255 })[3]).to.equal(255)
      expect(() => encode({ wide: 256 })).to.throw(
        "field 'Wide': value 256 is outside its range 0 to 255"
      )
      expect(() => encode({ wide: -1 })).to.throw(
        "field 'Wide': value -1 is outside its range 0 to 255"
      )
    })
  })
})
