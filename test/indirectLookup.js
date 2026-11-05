const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')

// An INDIRECT_LOOKUP is named by its value under another field's value, as
// canboat names it (#564).
const decode = (line) => new FromPgn({ useCamel: true }).parseString(line)
const hex = (pgn) => Buffer.from(toPgn(pgn)).toString('hex')

describe('INDIRECT_LOOKUP fields', () => {
  // 60928: the device function (order 5) is named under the device class,
  // which comes after it (order 7).
  const claim =
    '2026-06-08T01:51:43.332,6,60928,178,255,8,ef,04,e0,b3,00,af,78,c0'

  it('names a device function under the device class that follows it', () => {
    const pgn = decode(claim)
    pgn.fields.deviceFunction.should.equal('Integrated Navigation System')
    pgn.fields.deviceClass.should.equal('Navigation')
  })

  it('writes a device function given by name back to its code', () => {
    hex(decode(claim)).should.equal('ef04e0b300af78c0')
  })

  it('reads the device class given as a number when writing', () => {
    const pgn = decode(claim)
    pgn.fields.deviceClass = 60 // Navigation
    hex(pgn).should.equal('ef04e0b300af78c0')
  })

  it('leaves a value with no name under its key a number', () => {
    // class 120 (Display) has no function 175
    const pgn = decode(
      '2026-06-08T01:51:43.332,6,60928,178,255,8,ef,04,e0,b3,00,af,f0,c0'
    )
    pgn.fields.deviceFunction.should.equal(175)
  })

  it('gives the number when enums are not resolved', () => {
    const pgn = new FromPgn({
      useCamel: true,
      resolveEnums: false
    }).parseString(claim)
    pgn.fields.deviceFunction.should.equal(175)
  })

  // 130820 Fusion Settings: the setting id and its value are both in the
  // repeating set, so each value is named under the id in its own record.
  const settings =
    '2026-09-18T14:52:19.475Z,7,130820,51,255,24,a3,99,15,80,02,00,00,00,01,00,00,00,05,00,00,00,07,00,00,00,02,00,00,00'

  it('names a value in a repeating set under the key in its own record', () => {
    const pgn = decode(settings)
    pgn.fields.list.should.deep.equal([
      { id: 'iPod Subtitles', value: 5 },
      { id: 'Tuner Region', value: 'Japan' }
    ])
  })

  it('writes a repeating set named that way back as it was', () => {
    hex(decode(settings)).should.equal(
      'a39915800200000001000000050000000700000002000000'
    )
  })

  it('reads the key from the message data when the stream has a header', () => {
    // parseBuffer's stream holds an 11-byte header before the data, and a
    // key's BitOffset counts from the data.
    const data = Buffer.from('ef04e0b300af78c0', 'hex')
    const header = Buffer.from([6, 0x00, 0xee, 0x00, 255, 178, 0, 0, 0, 0, 8])
    new FromPgn({ useCamel: true })
      .parseBuffer(Buffer.concat([header, data]))
      .fields.deviceFunction.should.equal('Integrated Navigation System')
  })

  it('refuses a name that is not one under the key', () => {
    const pgn = decode(claim)
    pgn.fields.deviceFunction = 'No such function'
    ;(() => toPgn(pgn)).should.throw(/No such function/)
    pgn.fields.deviceClass = 120 // Display has no "Integrated Navigation System"
    pgn.fields.deviceFunction = 'Integrated Navigation System'
    ;(() => toPgn(pgn)).should.throw(/under Device Class 120/)
  })

  it('writes a code given as text as the code', () => {
    const pgn = decode(claim)
    pgn.fields.deviceFunction = '175'
    hex(pgn).should.equal('ef04e0b300af78c0')
  })

  it('refuses a code given as text that does not fit the field', () => {
    const pgn = decode(claim)
    for (const text of ['256', '-1', '17.5']) {
      pgn.fields.deviceFunction = text
      ;(() => toPgn(pgn)).should.throw(/is not a code of its 8 bits/)
    }
  })
})
