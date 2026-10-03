const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')

// Choosing a PGN variant by its match fields: a variant that ends before a
// match field drops out rather than breaking the decode.
describe('variant matching', () => {
  // Airmar 126720 speed and temperature filter commands match on a field
  // (filterType) past the end of airmarAddressableMultiFrame, the 4-field
  // Airmar catch-all that is still a candidate there. Ids as canboat decodes
  // the same messages.
  const cases = [
    [
      '2026-10-03T12:00:04.600Z,3,126720,230,255,6,87,98,2b,f0,cc,4c',
      'airmarSpeedFilterNone',
      'Speed Filter'
    ],
    [
      '2026-10-03T12:00:04.620Z,3,126720,231,255,8,87,98,2b,f1,cc,4c,cc,4c',
      'airmarSpeedFilterIir',
      'Speed Filter'
    ],
    [
      '2026-10-03T12:00:04.640Z,3,126720,232,255,6,87,98,2c,f0,cc,4c',
      'airmarTemperatureFilterNone',
      'Temperature Filter'
    ],
    [
      '2026-10-03T12:00:04.660Z,3,126720,233,255,8,87,98,2c,f1,cc,4c,cc,4c',
      'airmarTemperatureFilterIir',
      'Temperature Filter'
    ]
  ]

  cases.forEach(([line, id, proprietaryId]) => {
    it(`decodes ${id} past a shorter variant`, () => {
      // format 1: the lines are whole (FAST) messages, as canboat writes them
      const parser = new FromPgn({ useCamel: true, format: 1 })
      const errors = []
      parser.on('error', (pgn, err) => errors.push(err))
      const pgn = parser.parseString(line)
      errors.should.deep.equal([])
      pgn.id.should.equal(id)
      pgn.fields.proprietaryId.should.equal(proprietaryId)
    })
  })
})
