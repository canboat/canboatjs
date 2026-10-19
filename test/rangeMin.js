const { expect } = require('chai')
const { FromPgn } = require('../dist/index')

// A value below a field's RangeMin is no reading, as a value above
// RangeMax is not: canboat/canboat#983.
describe('values below RangeMin', function () {
  const decode = (line, options = {}) =>
    new FromPgn({ useCamel: true, format: 1, ...options }).parseString(line)
      .fields

  it('leaves out an impossible AIS position (#393)', function () {
    // A broken AtoN: raw 0xbd555556 in longitude and latitude, -111.85 degrees;
    // latitude's RangeMin is -90, longitude's -180.
    const data = Buffer.alloc(28, 0xff)
    data[0] = 0x15 | (1 << 6)
    data.write('565555bd', 5, 'hex')
    data.write('565555bd', 9, 'hex')
    const fields = decode(
      '2026-02-03T00:54:37.244Z,4,129041,20,255,28,' +
        Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(',')
    )
    expect(fields.latitude).to.equal(undefined)
    // -111.85 is a possible longitude.
    expect(fields.longitude).to.equal(-111.8481066)
  })

  it('takes the raw value nearest a RangeMin between steps, not one below', function () {
    // Attitude pitch: RangeMin -pi at 0.0001 rad; raw -31416 is -pi rounded.
    const pitch = (raw) => {
      const b = Buffer.alloc(2)
      b.writeInt16LE(raw)
      return decode(
        `2026-01-01T00:00:00.000Z,3,127257,1,255,8,ff,ff,7f,${b[0].toString(16)},${b[1].toString(16)},ff,7f,ff`
      ).pitch
    }
    expect(pitch(-31416)).to.equal(-3.1416)
    expect(pitch(-31417)).to.equal(undefined)
  })

  it('keeps the most negative raw value where RangeMin reaches it', function () {
    // Water depth offset: 16 bits at 0.001 m. Since canboat/canboat#986 a
    // signed field's RangeMin reaches the full negative end of its bits, so
    // raw -32768 (0x8000) is -32.768, not out of range.
    const offset = (lo, hi) =>
      decode(
        `2026-01-01T00:00:00.000Z,3,128267,1,255,8,ff,10,27,00,00,${lo},${hi},ff`
      ).offset
    expect(offset('01', '80')).to.equal(-32.767)
    expect(offset('00', '80')).to.equal(-32.768)
  })

  it('is part of the optional range check', function () {
    // Attitude pitch raw -31417 is below RangeMin -pi.
    const fields = decode(
      '2026-01-01T00:00:00.000Z,3,127257,1,255,8,ff,ff,7f,47,85,ff,7f,ff',
      { checkForInvalidFields: false }
    )
    expect(fields.pitch).to.equal(-3.1417)
  })
})
