const chai = require('chai')
chai.Should()
const { pgnToActisenseSerialFormat } = require('../dist/index')

// A BITLOOKUP field value may be supplied either as an array of the set
// enumeration names or as a raw numeric bitmask. The numeric form used to
// crash the encoder ("value.indexOf is not a function"); both forms must now
// encode identically. See canboat PR #667 (PGN 127493 made a BITLOOKUP).
describe('toPgn encodes a numeric BITLOOKUP value', function () {
  const base = {
    prio: 2,
    pgn: 127489, // Engine Parameters, Dynamic (Discrete Status 1 is a BITLOOKUP)
    dst: 255,
    src: 16,
    fields: { instance: 'Single Engine or Dual Engine Port' }
  }

  const bytes = (pgn) =>
    pgnToActisenseSerialFormat(pgn).split(',').slice(5).join(',')

  it('does not throw on a numeric bitmask', function () {
    const numeric = {
      ...base,
      fields: { ...base.fields, 'Discrete Status 1': 6 }
    }
    ;(() => pgnToActisenseSerialFormat(numeric)).should.not.throw()
  })

  it('numeric bitmask encodes the same as the equivalent name array', function () {
    // bit 1 = "Over Temperature", bit 2 = "Low Oil Pressure" => 0b110 = 6
    const numeric = {
      ...base,
      fields: { ...base.fields, 'Discrete Status 1': 6 }
    }
    const named = {
      ...base,
      fields: {
        ...base.fields,
        'Discrete Status 1': ['Over Temperature', 'Low Oil Pressure']
      }
    }
    bytes(numeric).should.equal(bytes(named))
  })
})
