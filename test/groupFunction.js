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

// Which variant a 126208's parameters address, as canboat's analyzer reads
// it: chosen from the raw parameters, each at the variant's own width; a
// proprietary PGN only by Manufacturer then Industry; else the catch-all,
// whose data takes the rest. Lines from canboat's
// analyzer/tests/pgn-126208-request-126720 (canboat#1074) and samples/.
describe('126208 parameters addressing a variant, as canboat reads them', () => {
  const { toPgn } = require('../dist/toPgn')
  const decode = (line) =>
    new FromPgn({ useCamel: true }).parseString(line).fields.list
  const reencode = (line) =>
    Buffer.from(
      toPgn(new FromPgn({ useCamel: true }).parseString(line))
    ).toString('hex')
  const wire = (line) => line.split(',').slice(6).join('')

  it('reads a parameter by the variant the parameters select', () => {
    const line =
      '2026-10-19-00:00:00.000,3,126208,0,35,18,00,00,ef,01,ff,ff,ff,ff,ff,ff,03,01,87,00,03,04,04,23'
    decode(line)[2].should.deep.equal({
      parameter: 4,
      parameterId: 'proprietaryId',
      value: 'Simulate Mode'
    })
    reencode(line).should.equal(wire(line))
  })

  it('reads the catch-all when no variant agrees, its data the rest', () => {
    // Raymarine has no 126720 variant with proprietary ID 92.
    const line =
      '2024-02-17T05:15:49.768Z,3,126208,204,172,20,00,00,ef,01,ff,ff,ff,ff,ff,ff,04,01,3b,07,03,04,04,5c,05,0f'
    decode(line)[2].should.deep.equal({
      parameter: 4,
      parameterId: 'data',
      value: '5c 05 0f'
    })
    reencode(line).should.equal(wire(line))
  })

  it('writes a one-byte catch-all parameter as that byte', () => {
    // Constructed from the Raymarine line above, with one byte of data.
    const line =
      '2024-02-17T05:15:49.768Z,3,126208,204,172,18,00,00,ef,01,ff,ff,ff,ff,ff,ff,03,01,3b,07,03,04,04,5c'
    decode(line)[2].value.should.equal('5c')
    reencode(line).should.equal(wire(line))
  })

  it('resolves the variant anew when a pgn object is decoded again', () => {
    // The two messages above, decoded through one pgn object: the first
    // selects a variant, the second none.
    const bytes = (line) => Buffer.from(wire(line), 'hex')
    const parser = new FromPgn({ useCamel: true })
    const pgn = { pgn: 126208, prio: 3, src: 35, dst: 0 }
    parser
      .parsePgnData(
        pgn,
        18,
        bytes(
          '2026-10-19-00:00:00.000,3,126208,0,35,18,00,00,ef,01,ff,ff,ff,ff,ff,ff,03,01,87,00,03,04,04,23'
        ),
        true,
        undefined
      )
      .fields.list[2].parameterId.should.equal('proprietaryId')
    parser
      .parsePgnData(
        pgn,
        20,
        bytes(
          '2024-02-17T05:15:49.768Z,3,126208,204,172,20,00,00,ef,01,ff,ff,ff,ff,ff,ff,04,01,3b,07,03,04,04,5c,05,0f'
        ),
        true,
        undefined
      )
      .fields.list[2].should.deep.equal({
        parameter: 4,
        parameterId: 'data',
        value: '5c 05 0f'
      })
  })

  it('reads the catch-all for a proprietary PGN without Manufacturer and Industry', () => {
    // maretron-alm100-command.raw: a command to 130824 (0x1FF08) that
    // leaves out parameters 1 and 3.
    decode(
      '2026-08-10T22:37:18.889Z,3,126208,128,164,18,01,08,ff,01,f8,05,04,00,05,64,06,04,00,07,17,08,0d,50'
    ).should.deep.equal([
      {
        parameter: 4,
        parameterId: 'data',
        value: '00 05 64 06 04 00 07 17 08 0d 50'
      }
    ])
  })
})
