const { expect } = require('chai')
const { FromPgn, toPgn } = require('../dist/index')

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
      "field 'Charge Efficiency Factor': value 1.3 is outside its range -1.27 to 1.24"
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
})
