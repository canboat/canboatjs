const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')

// canboat 10's nested repeating sets (RepeatingFieldSet2Parent): the second
// set repeats within each record of the first, which holds its records as
// list2. Navico's UDB table dumps: tables until the data runs out, each a
// count followed by that many records of a length and a 32-bit float.

const decode = (line, options = {}) =>
  new FromPgn({ useCamel: true, ...options }).parseString(line)

const hex = (fields) =>
  Buffer.from(toPgn({ pgn: 130822, fields })).toString('hex')

const line = (bytes) =>
  `2026-01-01T00:00:00.000Z,3,130822,27,255,${bytes.length / 2},` +
  bytes.match(/../g).join(',')

// Header: Navico, Object Dump of Section 11, Item 0, Object Value 64815,
// Sub B9 00 00, Token 92.
const HEADER = '1399ff06000b002ffdb900005c00'

describe('nested repeating sets', () => {
  it('decodes an H5000 table dump as canboat 10 does', () => {
    // From canboat's samples/h5000-settings-dumps.raw; canboat 10 prints
    // these values.
    const pgn = decode(
      '2026-11-08T10:07:49.956Z,3,130822,27,255,199,13,99,ff,06,00,0b,00,2f,fd,b9,00,00,5c,00,07,00,04,00,00,00,00,04,9a,99,99,be,04,cd,cc,cc,be,04,cd,cc,cc,be,04,cd,cc,4c,be,04,00,00,00,00,04,00,00,00,00,07,00,04,00,00,00,00,04,9a,99,99,be,04,9a,99,99,be,04,9a,99,99,be,04,cd,cc,4c,be,04,cd,cc,4c,be,04,cd,cc,4c,be,07,00,04,00,00,00,00,04,cd,cc,cc,bd,04,cd,cc,cc,3d,04,cd,cc,cc,3d,04,cd,cc,cc,3d,04,00,00,00,00,04,00,00,00,00,07,00,04,00,00,00,00,04,cd,cc,4c,be,04,cd,cc,4c,be,04,00,00,00,00,04,cd,cc,cc,3d,04,cd,cc,4c,3e,04,cd,cc,4c,3e,07,00,04,00,00,00,00,04,cd,cc,cc,bd,04,cd,cc,4c,be,04,cd,cc,cc,bd,04,00,00,00,00,04,cd,cc,cc,3d,04,cd,cc,4c,3e'
    )
    pgn.id.should.equal('navicoUdbDatabaseTableDump11')
    pgn.fields.token.should.equal(92)
    pgn.fields.list.should.have.length(5)
    pgn.fields.list[0].should.deep.equal({
      count: 7,
      list2: [0, -0.3, -0.4, -0.4, -0.2, 0, 0].map((value) => ({
        length: 4,
        value
      }))
    })
    pgn.fields.list[4].list2
      .map((r) => r.value)
      .should.deep.equal([0, -0.1, -0.2, -0.1, 0, 0.1, 0.2])
  })

  it('stops a table where the message ends', () => {
    // The second table says 3 records but has 1: the H5000 cuts its dumps
    // off at the Fast Packet maximum.
    const fields = decode(
      line(HEADER + '0100' + '040000c03f' + '0300' + '04000020c0')
    ).fields
    fields.list.should.deep.equal([
      { count: 1, list2: [{ length: 4, value: 1.5 }] },
      { count: 3, list2: [{ length: 4, value: -2.5 }] }
    ])
  })

  it('gives each record of the first set an empty list2 for a count of 0', () => {
    decode(
      line(HEADER + '0000' + '0100' + '0400008040')
    ).fields.list.should.deep.equal([
      { count: 0, list2: [] },
      { count: 1, list2: [{ length: 4, value: 4 }] }
    ])
  })

  it('maps the bytes of each nested record', () => {
    const pgn = decode(line(HEADER + '0100' + '040000c03f'), {
      includeByteMapping: true
    })
    const table = pgn.byteMapping.list[0]
    table.count.bytes.should.deep.equal([1, 0])
    table.list2.should.have.length(1)
    table.list2[0].length.bytes.should.deep.equal([4])
    table.list2[0].value.bytes.should.deep.equal([0, 0, 0xc0, 0x3f])
  })

  const fields = {
    manufacturerCode: 'Navico',
    industryCode: 'Marine Industry',
    marker: 255,
    command: 'Object Dump',
    reserved6: 0,
    address: 0,
    section: 11,
    item: 0,
    objectValue: 64815,
    sub: 'B9 00 00',
    token: 92
  }

  it('encodes each record of the first set with its list2', () => {
    hex({
      ...fields,
      list: [
        {
          count: 2,
          list2: [
            { length: 4, value: 1.5 },
            { length: 4, value: -2.5 }
          ]
        },
        { count: 1, list2: [{ length: 4, value: 4 }] }
      ]
    }).should.equal(
      HEADER + '0200' + '040000c03f' + '04000020c0' + '0100' + '0400008040'
    )
  })

  it('counts a record of the first set by its list2 when not given', () => {
    hex({
      ...fields,
      list: [
        {
          list2: [
            { length: 4, value: 1.5 },
            { length: 4, value: -2.5 }
          ]
        },
        { list2: [] }
      ]
    }).should.equal(HEADER + '0200' + '040000c03f' + '04000020c0' + '0000')
  })

  it('decodes what it encodes', () => {
    const list = [
      {
        count: 2,
        list2: [
          { length: 4, value: 0.5 },
          { length: 4, value: -1.25 }
        ]
      },
      { count: 0, list2: [] },
      { count: 1, list2: [{ length: 4, value: 3 }] }
    ]
    decode(line(hex({ ...fields, list }))).fields.list.should.deep.equal(list)
  })
})
