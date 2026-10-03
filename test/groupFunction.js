const chai = require('chai')
chai.Should()

const { pgnToActisenseSerialFormat, FromPgn } = require('../dist/index')

// A 126208 Command to a Maretron ALM100 annunciator, targeting PGN 130824,
// which has several variants (B&G key/value first, then Maretron): #458.
// The frames are the ones verified on a real ALM100.
describe('126208 group function to a PGN with several variants', () => {
  const command = (list) => ({
    pgn: 126208,
    prio: 3,
    dst: 164,
    src: 0,
    fields: {
      functionCode: 'Command',
      pgn: 130824,
      priority: 8,
      numberOfParameters: list.length,
      list
    }
  })
  const data = (line) => line.split(',').slice(6).join(',')
  const maretron = [
    { parameter: 1, value: 137 },
    { parameter: 3, value: 4 }
  ]
  const alarm = [
    { parameter: 4, value: 0 },
    { parameter: 5, value: 100 },
    { parameter: 6, value: 4 },
    { parameter: 7, value: 23 },
    { parameter: 8, value: 20493 }
  ]

  it('uses the variant the manufacturer and industry pairs select', () => {
    const line = pgnToActisenseSerialFormat(command([...maretron, ...alarm]))
    data(line).should.equal(
      '01,08,ff,01,f8,07,01,89,00,03,04,04,00,05,64,06,04,00,07,17,08,0d,50'
    )
    // And the decoder reads the same variant back.
    const decoded = new FromPgn({ useCamel: true }).parseString(
      line.replace(/^[^,]*,/, '2026-10-03T00:00:00.000Z,')
    )
    decoded.fields.list
      .map((p) => p.value)
      .should.deep.equal(['Maretron', 'Marine Industry', 0, 100, 4, 23, 20493])
  })

  it('refuses a number for a key/value field instead of encoding it wrong', () => {
    // Without the pairs, the first variant (B&G) is used, as canboat does;
    // its parameter 6 is a key/value field, which takes bytes.
    ;(() => pgnToActisenseSerialFormat(command(alarm))).should.throw(
      /Parameter 6 of PGN 130824 is a key\/value field/
    )
  })

  it('refuses a parameter without a value instead of dropping its bytes', () => {
    const list = [...maretron, ...alarm]
    list[4] = { parameter: 6, value: undefined }
    ;(() => pgnToActisenseSerialFormat(command(list))).should.throw(
      'Parameter 6 of PGN 130824 has no value'
    )
  })
})
