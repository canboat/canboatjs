const chai = require('chai')
chai.Should()

const { FromPgn, pgnToActisenseSerialFormat } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')
const { addCustomPgns } = require('../dist/pgns')

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

// 129808 has a distress variant and a general one (and, from canboat 9.1, a
// distress relay). Both name their first two fields differently, and a call
// is only known to be general once its match field has been read, so the
// fields read before it must be read again as the general variant has them.
// The frames are canboat's samples/pgn129808.raw.
describe('a variant chosen after its first fields', () => {
  const MOB_DISTRESS =
    '2022-04-17T04:35:34.254Z,4,129808,3,255,83,70,70,33,14,00,5f,1e,6e,64,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,12,01,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,70,69,80,e7,77,b1,3a,68,c0,a6,c1,04,ff,ff,ff,ff,ff,7f,fd,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,64,0a,01,30,38'
  const generalCalls = [
    [
      '2026-08-27T11:03:58.994Z,4,129808,4,255,62,74,6c,00,16,29,02,28,64,7e,39,30,30,30,31,36,ff,ff,ff,ff,ff,ff,02,01,ff,ff,ff,7f,ff,ff,ff,7f,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,fc,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,40,f2,b5,17,d4,34,00,00',
      'All ships',
      'Safety'
    ],
    [
      '2026-09-05T10:46:07.912Z,4,129808,4,255,62,78,6c,16,2d,27,18,00,79,7e,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,02,01,e0,1f,34,17,da,eb,e3,00,80,4e,1a,17,ff,ff,ff,ff,ff,7a,fc,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,80,4e,1a,17,dd,34,17,00',
      'Individual stations',
      'Safety'
    ]
  ]
  const decode = (line, useCamel = true) =>
    new FromPgn({ useCamel, format: 1 }).parseString(line)
  const data = (line) => line.split(',').slice(6).join('')

  generalCalls.forEach(([line, format, category]) => {
    it(`names a general call to ${format} as the general variant does`, () => {
      const pgn = decode(line)
      pgn.id.should.equal('dscCallInformation')
      pgn.fields.dscFormatSymbol.should.equal(format)
      pgn.fields.dscCategorySymbol.should.equal(category)
      pgn.fields.should.not.have.property('dscFormat')
      pgn.fields.should.not.have.property('dscCategory')
    })

    it(`encodes a general call to ${format} back to its bytes`, () => {
      for (const useCamel of [true, false]) {
        Buffer.from(toPgn(decode(line, useCamel)))
          .toString('hex')
          .should.equal(data(line))
      }
    })
  })

  it("writes a general call's fields given under its own ids", () => {
    const encoded = Buffer.from(
      toPgn({
        pgn: 129808,
        fields: {
          dscFormatSymbol: 'All ships',
          dscCategorySymbol: 'Routine',
          dscMessageAddress: '247012345'
        }
      })
    )
    // 116 All ships, 100 Routine; both went out as 0xff, not available.
    encoded.subarray(0, 2).toString('hex').should.equal('7464')
    decode(
      pgnToActisenseSerialFormat({
        pgn: 129808,
        prio: 4,
        src: 1,
        dst: 255,
        fields: {
          dscFormatSymbol: 'All ships',
          dscCategorySymbol: 'Routine',
          dscMessageAddress: '247012345'
        }
      })
    ).fields.should.include({
      dscFormatSymbol: 'All ships',
      dscCategorySymbol: 'Routine'
    })
  })

  it('decodes a distress alert re-encoded to the same fields', () => {
    const pgn = decode(MOB_DISTRESS)
    pgn.id.should.equal('dscDistressCallInformation')
    const again = decode(
      pgnToActisenseSerialFormat({ ...pgn, timestamp: undefined })
    )
    again.id.should.equal(pgn.id)
    again.fields.should.deep.equal(pgn.fields)
  })
})

// A custom PGN may list a variant without match fields, which any data
// fits, before one that has them.
describe('a custom PGN with a catch-all variant first', () => {
  const field = (order, id, bitOffset, extra = {}) => ({
    Order: order,
    Id: id,
    Name: id,
    BitLength: 8,
    BitOffset: bitOffset,
    BitStart: 0,
    FieldType: 'NUMBER',
    Resolution: 1,
    Signed: false,
    ...extra
  })
  before(() => {
    addCustomPgns(
      {
        PGNs: [
          {
            PGN: 130995,
            Id: 'testAnyKind',
            Description: 'Any kind',
            Type: 'Single',
            Complete: true,
            Length: 2,
            Fields: [field(1, 'kind', 0), field(2, 'value', 8)]
          },
          {
            PGN: 130995,
            Id: 'testLevel',
            Description: 'Level',
            Type: 'Single',
            Complete: true,
            Length: 2,
            Fields: [field(1, 'kind', 0, { Match: 5 }), field(2, 'level', 8)]
          }
        ]
      },
      'test'
    )
  })

  it('writes the variant whose match field the data gives', () => {
    Buffer.from(toPgn({ pgn: 130995, fields: { kind: 5, level: 42 } }))
      .toString('hex')
      .should.equal('052a')
  })

  const decodeLine = (data) =>
    new FromPgn({ useCamel: true }).parseString(
      `2026-10-28T12:00:00.000Z,2,130995,1,255,2,${data}`
    )

  it('reads the variant whose match field the message has', () => {
    const pgn = decodeLine('05,2a')
    pgn.id.should.equal('testLevel')
    pgn.fields.should.deep.equal({ kind: 5, level: 42 })
  })

  it('reads the catch-all for a message no other variant fits', () => {
    const pgn = decodeLine('03,07')
    pgn.id.should.equal('testAnyKind')
    pgn.fields.should.deep.equal({ kind: 3, value: 7 })
  })

  it('writes the catch-all for data no other variant fits', () => {
    Buffer.from(toPgn({ pgn: 130995, fields: { kind: 3, value: 7 } }))
      .toString('hex')
      .should.equal('0307')
  })
})
