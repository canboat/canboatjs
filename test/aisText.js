const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')

// AIS pads unused text characters with '@' (ITU-R M.1371); MFDs show 0xff
// padding in AIS names as junk (#373).
describe('AIS fixed-width text', () => {
  const static129794 = {
    pgn: 129794,
    prio: 6,
    src: 43,
    dst: 255,
    fields: {
      messageId: 'Static and voyage related data',
      userId: '244060807',
      callsign: 'PD1234',
      name: 'ZEEZWALUW',
      destination: 'IJMUIDEN'
    }
  }

  it('pads AIS names, callsigns and destinations with @', () => {
    const data = Buffer.from(toPgn(static129794))
    const text = data.toString('latin1')
    text.should.contain('PD1234@')
    text.should.contain('ZEEZWALUW' + '@'.repeat(11))
    text.should.contain('IJMUIDEN' + '@'.repeat(12))
    data.includes(Buffer.from('ZEEZWALUW\xff', 'latin1')).should.equal(false)
  })

  it('reads the padded text back without the @', () => {
    const data = Buffer.from(toPgn(static129794))
    const line =
      '2026-10-03T00:00:00.000Z,6,129794,43,255,' +
      data.length +
      ',' +
      [...data].map((b) => b.toString(16).padStart(2, '0')).join(',')
    const fields = new FromPgn({ useCamel: true, format: 1 }).parseString(
      line
    ).fields
    fields.callsign.should.equal('PD1234')
    fields.name.should.equal('ZEEZWALUW')
    fields.destination.should.equal('IJMUIDEN')
  })

  it('still pads other fixed strings with 0xff', () => {
    // 126998 is not AIS: its strings are length-prefixed, so use a
    // fixed-width one from a non-AIS PGN instead: 126996 Model ID.
    const data = Buffer.from(
      toPgn({
        pgn: 126996,
        dst: 255,
        fields: { nmea2000Version: 2.1, productCode: 1, modelId: 'SK' }
      })
    )
    data.subarray(4, 8).toString('hex').should.equal('534bffff')
  })
})
