const { expect } = require('chai')
const { FromPgn, toPgn } = require('../dist/index')

describe('J1939 Excess-K power fields', function () {
  it('omits no-data power from the issue #468 frame', function () {
    const p = new FromPgn({ useCamel: true })
    const result = p.parseString(
      '2026-09-24T00:00:00.000Z,3,65029,132,255,8,ff,ff,ff,ff,e8,97,35,77'
    )
    expect(result.fields).to.deep.equal({ apparentPower: 1000 })
  })

  for (const [raw, expected] of [
    [0, -2000000000],
    [1999999500, -500],
    [2000001000, 1000],
    [0x7fffffff, 147483647],
    [0x80000000, 147483648],
    [0xfffffffc, 2294967292]
  ]) {
    it(`decodes raw ${raw} as ${expected} W`, function () {
      const bytes = Buffer.alloc(4)
      bytes.writeUInt32LE(raw)
      const data = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      const p = new FromPgn({ useCamel: true })
      const result = p.parseString(
        `2026-09-24T00:00:00.000Z,3,65029,132,255,8,${data.join(',')},e8,97,35,77`
      )
      expect(result.fields).to.deep.equal({
        realPower: expected,
        apparentPower: 1000
      })
    })
  }

  for (const raw of [0xfffffffd, 0xfffffffe, 0xffffffff]) {
    for (const returnNulls of [false, true]) {
      it(`rejects reserved raw ${raw} with returnNulls=${returnNulls}`, function () {
        const bytes = Buffer.alloc(4)
        bytes.writeUInt32LE(raw)
        const data = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
        const p = new FromPgn({ useCamel: true, returnNulls })
        const result = p.parseString(
          `2026-09-24T00:00:00.000Z,3,65029,132,255,8,${data.join(',')},e8,97,35,77`
        )
        expect(result.fields).to.deep.equal(
          returnNulls
            ? { realPower: null, apparentPower: 1000 }
            : { apparentPower: 1000 }
        )
      })
    }
  }

  for (const fields of [
    { apparentPower: 1000 },
    { realPower: null, apparentPower: 1000 }
  ]) {
    it(`encodes ${fields.realPower === null ? 'null' : 'omitted'} power as unsigned no-data`, function () {
      expect(toPgn({ pgn: 65029, fields }).toString('hex')).to.equal(
        'ffffffffe8973577'
      )
    })
  }

  it('preserves the signed no-data marker for fields without an offset', function () {
    const input =
      '2026-09-24T00:00:00.000Z,3,127251,132,255,8,00,ff,ff,ff,7f,ff,ff,ff'
    const p = new FromPgn({ useCamel: true, returnNulls: true })
    expect(p.parseString(input).fields.rate).to.equal(null)
    expect(
      toPgn({ pgn: 127251, fields: { sid: 0, rate: null } }).toString('hex')
    ).to.equal('00ffffff7fffffff')
  })

  for (const raw of [0xfffffffd, 0xfffffffe, 0xffffffff]) {
    it(`rejects reserved raw ${raw} also without the range check`, function () {
      // The reserved codes are recognised from the raw value, as canboat
      // does, not only by the optional range validation.
      const bytes = Buffer.alloc(4)
      bytes.writeUInt32LE(raw)
      const data = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
      const p = new FromPgn({ useCamel: true, checkForInvalidFields: false })
      const result = p.parseString(
        `2026-09-24T00:00:00.000Z,3,65029,132,255,8,${data.join(',')},e8,97,35,77`
      )
      expect(result.fields).to.deep.equal({ apparentPower: 1000 })
    })
  }

  it('encodes the whole range as unsigned raw values, and reads it back', function () {
    for (const [watts, hex] of [
      [-2000000000, '00000000'],
      [-500, '0c923577'],
      [1000, 'e8973577'],
      [2294967292, 'fcffffff']
    ]) {
      const data = Buffer.from(
        toPgn({ pgn: 65029, fields: { realPower: watts, apparentPower: 1000 } })
      )
      expect(data.subarray(0, 4).toString('hex')).to.equal(hex)
      const line =
        '2026-09-24T00:00:00.000Z,3,65029,132,255,8,' +
        Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(',')
      expect(
        new FromPgn({ useCamel: true }).parseString(line).fields.realPower
      ).to.equal(watts)
    }
  })
})

// No 16-bit Excess-K field is in the NMEA 2000 database, so a custom PGN
// stands in for one: the rule is canboat's at every width.
describe('J1939 Excess-K at 16 bits (custom PGN)', function () {
  const { addCustomPgns } = require('../dist/pgns')
  const definitions = {
    PGNs: [
      {
        PGN: 130997,
        Id: 'testExcessK16',
        Description: 'Excess-K test',
        Type: 'Single',
        Complete: true,
        Length: 8,
        Fields: [
          {
            Order: 1,
            Id: 'power',
            Name: 'Power',
            BitLength: 16,
            BitOffset: 0,
            BitStart: 0,
            FieldType: 'NUMBER',
            Signed: true,
            Offset: -32000,
            Resolution: 1,
            RangeMin: -32000,
            RangeMax: 33532,
            Unit: 'W'
          },
          {
            Order: 2,
            Id: 'reserved',
            Name: 'Reserved',
            BitLength: 48,
            BitOffset: 16,
            BitStart: 0,
            FieldType: 'RESERVED',
            Signed: false
          }
        ]
      }
    ]
  }
  addCustomPgns(definitions, 'excess-k-test')
  const parser = new FromPgn({ useCamel: true })
  const decode = (hex) =>
    parser.parseString(`2026-01-01T00:00:00.000Z,3,130997,1,255,8,${hex}`)
      .fields

  it('encodes and decodes the range as unsigned raw values', function () {
    for (const [watts, raw] of [
      [-32000, '0000'],
      [-500, '0c7b'],
      [1000, 'e880'],
      [33532, 'fcff']
    ]) {
      const data = Buffer.from(toPgn({ pgn: 130997, fields: { power: watts } }))
      expect(data.subarray(0, 2).toString('hex')).to.equal(raw)
      const hex = Array.from(data, (b) => b.toString(16).padStart(2, '0'))
      expect(decode(hex.join(',')).power).to.equal(watts)
    }
  })

  it('reads the reserved codes as not available, and writes no data as all ones', function () {
    for (const raw of ['ff,ff', 'fe,ff', 'fd,ff']) {
      expect(decode(`${raw},ff,ff,ff,ff,ff,ff`)).to.deep.equal({})
    }
    const data = Buffer.from(toPgn({ pgn: 130997, fields: {} }))
    expect(data.subarray(0, 2).toString('hex')).to.equal('ffff')
  })
})

describe('J1939 Excess-K at 48 bits (custom PGN)', function () {
  const { addCustomPgns } = require('../dist/pgns')
  // Raw 0 is -1e12 Wh; the top three raw codes are reserved.
  const rawMax = 2 ** 48 - 4
  addCustomPgns(
    {
      PGNs: [
        {
          PGN: 130996,
          Id: 'testExcessK48',
          Description: 'Excess-K 48-bit test',
          Type: 'Single',
          Complete: true,
          Length: 8,
          Fields: [
            {
              Order: 1,
              Id: 'energy',
              Name: 'Energy',
              BitLength: 48,
              BitOffset: 0,
              BitStart: 0,
              FieldType: 'NUMBER',
              Signed: true,
              Offset: -1e12,
              Resolution: 1,
              RangeMin: -1e12,
              RangeMax: rawMax - 1e12
            },
            {
              Order: 2,
              Id: 'reserved',
              Name: 'Reserved',
              BitLength: 16,
              BitOffset: 48,
              BitStart: 0,
              FieldType: 'RESERVED',
              Signed: false
            }
          ]
        }
      ]
    },
    'excess-k-test'
  )
  // Without the optional range check, so the raw-code check is what acts.
  const parser = new FromPgn({ useCamel: true, checkForInvalidFields: false })
  const decode = (hex) =>
    parser.parseString(`2026-01-01T00:00:00.000Z,3,130996,1,255,8,${hex},ff,ff`)
      .fields

  it('reads the reserved codes as not available', function () {
    for (const raw of [
      'ff,ff,ff,ff,ff,ff',
      'fe,ff,ff,ff,ff,ff',
      'fd,ff,ff,ff,ff,ff'
    ]) {
      expect(decode(raw)).to.deep.equal({})
    }
  })

  it('reads the top of the range as a value', function () {
    expect(decode('fc,ff,ff,ff,ff,ff').energy).to.equal(rawMax - 1e12)
  })
})
