const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')
const { addCustomPgns } = require('../dist/pgns')

// Values are SI, as canboat gives them; toPgn takes them back to the wire.
describe('SI values round trip', () => {
  const roundTrip = (line) => {
    const pgn = new FromPgn({ useCamel: true }).parseString(line)
    const bytes = line.split(',').slice(6).join('')
    return {
      fields: pgn.fields,
      encoded: Buffer.from(toPgn(pgn)).toString('hex'),
      bytes
    }
  }

  it('a dynamic value under a key not named Key (Victron registerId)', () => {
    // Deepest Discharge, -1234 x 0.1 Ah = -444240 C.
    const r = roundTrip(
      '2026-10-03T00:00:00.000Z,7,61184,227,255,8,66,99,00,03,2e,fb,ff,ff'
    )
    r.fields.value.should.equal(-444240)
    r.encoded.should.equal(r.bytes)
  })

  it('a unit without a resolution, as a custom PGN may have', () => {
    addCustomPgns(
      {
        PGNs: [
          {
            PGN: 130999,
            Id: 'unitOnly',
            Description: 'Unit only',
            Type: 'Single',
            Complete: true,
            Length: 8,
            RepeatingFields: 0,
            Fields: [
              {
                Order: 1,
                Id: 'level',
                Name: 'Level',
                BitLength: 8,
                BitOffset: 0,
                BitStart: 0,
                FieldType: 'NUMBER',
                Signed: false,
                Unit: '%'
              },
              {
                Order: 2,
                Id: 'reserved',
                Name: 'Reserved',
                BitLength: 56,
                BitOffset: 8,
                BitStart: 0,
                FieldType: 'RESERVED',
                Signed: false
              }
            ]
          }
        ]
      },
      'units-test'
    )
    const r = roundTrip(
      '2026-10-03T00:00:00.000Z,6,130999,1,255,8,32,ff,ff,ff,ff,ff,ff,ff'
    )
    r.fields.level.should.equal(0.5)
    r.encoded.should.equal(r.bytes)
  })
})
