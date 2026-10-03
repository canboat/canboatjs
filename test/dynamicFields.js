const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')

// Key / length / value records decode as canboat decodes them
// (decode_dynamic_field_value in crates/canboat/src/engine/decode.rs); each
// expected value below is what canboat prints for the same message.
function decode(line) {
  return new FromPgn({ useCamel: true }).parseString(line).fields
}

describe('dynamic field values', () => {
  // B&G key-value data: Race Timer -300000 ms, Trip 2 Time all ones (unset),
  // Rudder Angle -1000 x 0.0001 rad, Altitude with length 0, and a Target
  // Boat Speed of length 2 that the message cuts off after one byte.
  const bandg = decode(
    '2024-01-01T00:00:00.000Z,3,130824,16,255,23,7d,99,75,40,20,6c,fb,ff,0b,41,ff,ff,ff,ff,0b,20,18,fc,00,00,7d,20,50'
  )

  it('decodes each value as its key says', () => {
    bandg.list[0].should.deep.equal({
      key: 'Race Timer',
      length: 4,
      value: -300
    })
    bandg.list[2].should.deep.equal({
      key: 'Rudder Angle',
      length: 2,
      value: -0.1
    })
  })

  it('leaves out a top-of-range value: it is not available', () => {
    bandg.list[1].should.deep.equal({ key: 'Trip 2 Time', length: 4 })
    // Rudder Angle, signed 16 bits: 0x7fff, 0x7ffe and 0x7ffd are not
    // available, out of range and reserved; 0x7ffc is a reading.
    decode(
      '2026-09-24T00:00:00.000Z,3,130824,16,255,18,7d,99,0b,20,ff,7f,0b,20,fe,7f,0b,20,fd,7f,0b,20,fc,7f'
    )
      .list.map((r) => r.value)
      .should.deep.equal([undefined, undefined, undefined, 3.2764])
  })

  it('leaves out a value of length 0', () => {
    bandg.list[3].should.deep.equal({ key: 'Altitude', length: 0 })
  })

  it('leaves out a value the message ends in', () => {
    bandg.list[4].should.deep.equal({ key: 'Target Boat Speed', length: 2 })
    bandg.list.should.have.length(5)
  })

  it('gives the rest of the message for a key it does not know', () => {
    const fields = decode(
      '2024-01-01T00:00:01.000Z,3,130845,2,255,14,41,9f,ff,ff,01,ff,07,45,00,01,2d,7d,10,14'
    )
    fields.key.should.equal(17671)
    fields.value.should.equal('2d 7d 10 14')
  })

  it('takes the record header off a length that counts it', () => {
    // Navico object dump records: length 5 is a class byte, a 16-bit data
    // type and 2 value bytes; length 3 leaves no value; length 1, shorter
    // than the header, takes the rest of the message.
    const fields = decode(
      '2024-01-01T00:00:02.000Z,3,130822,3,255,30,13,99,00,c6,00,0a,01,00,00,ff,ff,ff,00,00,05,00,01,00,34,12,03,00,02,00,01,00,03,00,aa,bb'
    )
    fields.list
      .map((r) => r.value)
      .should.deep.equal(['34 12', undefined, 'aa bb'])
  })

  it('encodes each record of a repeating set against its own key', () => {
    const data = toPgn({
      pgn: 130824,
      prio: 7,
      src: 16,
      dst: 255,
      fields: {
        manufacturerCode: 'B & G',
        industryCode: 'Marine Industry',
        list: [
          { key: 'Target Boat Speed', length: 2, value: 80 },
          { key: 'Polar Performance', length: 2, value: 100 }
        ]
      }
    })
    Buffer.from(data).toString('hex').should.equal('7d997d2050007c206400')
  })

  it('encodes the hex bytes of a key it has no type for, and refuses junk', () => {
    const msg = (value) => ({
      pgn: 130845,
      prio: 3,
      src: 2,
      dst: 255,
      fields: {
        manufacturerCode: 'Simrad',
        industryCode: 'Marine Industry',
        address: 255,
        instance: 255,
        networkGroup: 'Default',
        source: 255,
        key: 17671,
        operation: 'Set',
        value
      }
    })
    Buffer.from(toPgn(msg('2d 7d 10 14')))
      .toString('hex')
      .should.equal('419fffff01ff074500012d7d1014')
    ;(() => toPgn(msg('banana'))).should.throw(
      "Invalid value for key 17671: 'banana'"
    )
  })
})
