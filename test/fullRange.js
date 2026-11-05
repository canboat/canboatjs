const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const PropertyValues = require('@signalk/server-api').PropertyValues

// A field whose range reaches the top raw value it can hold has no value
// for "not available": that value is a reading, as canboat reads it (#566).
// Below 64 bits only; at 64 canboat does not check the range.
const number = (Order, Id, BitOffset, BitLength, extra) => ({
  Order,
  Id,
  Name: Id,
  BitLength,
  BitOffset,
  BitStart: BitOffset % 8,
  FieldType: 'NUMBER',
  Resolution: 1,
  Signed: false,
  ...extra
})

const definitions = {
  PGNs: [
    {
      PGN: 127998,
      Id: 'testFullRange',
      Description: 'Test: full range',
      Type: 'Single',
      Complete: true,
      Length: 8,
      Fields: [
        // signed, its range reaching 0x7f: 0x7f is 127
        number(1, 'signedFull', 0, 8, {
          Signed: true,
          RangeMin: -128,
          RangeMax: 127
        }),
        // signed, an ordinary range: 0x7f is not available
        number(2, 'signedPart', 8, 8, {
          Signed: true,
          RangeMin: -128,
          RangeMax: 124
        }),
        // unsigned, 48 bits, its range all of them
        number(3, 'unsigned48', 16, 48, { RangeMin: 0, RangeMax: 2 ** 48 - 1 })
      ]
    },
    {
      PGN: 127996,
      Id: 'testSpare64',
      Description: 'Test: a 64-bit spare field',
      Type: 'Single',
      Complete: true,
      Length: 8,
      Fields: [
        {
          Order: 1,
          Id: 'spare',
          Name: 'Spare',
          BitLength: 64,
          BitOffset: 0,
          BitStart: 0,
          FieldType: 'SPARE'
        }
      ]
    },
    {
      PGN: 127997,
      Id: 'testFullRange64',
      Description: 'Test: full range, 64 bits',
      Type: 'Single',
      Complete: true,
      Length: 8,
      Fields: [
        number(1, 'unsigned64', 0, 64, {
          RangeMin: 0,
          RangeMax: 18446744073709551615
        })
      ]
    }
  ]
}

describe('a field whose range reaches its top raw value', function () {
  const propertyValues = new PropertyValues()
  propertyValues.emitPropertyValue({
    timestamp: Date.now(),
    setter: 'fullRange',
    name: 'canboat-custom-pgns',
    value: definitions
  })
  const fromPgn = new FromPgn({
    useCamel: true,
    onPropertyValues: (name, cb) => propertyValues.onPropertyValues(name, cb)
  })

  it('gives a signed field its top value when its range reaches it', function () {
    const fields = fromPgn.parseString(
      '2026-11-05T00:00:00.000Z,3,127998,1,255,8,7f,7f,ff,ff,ff,ff,ff,ff'
    ).fields
    fields.signedFull.should.equal(127)
    fields.should.not.have.property('signedPart')
  })

  it('gives a 48-bit field its top value when its range reaches it', function () {
    fromPgn
      .parseString(
        '2026-11-05T00:00:00.000Z,3,127998,1,255,8,00,00,ff,ff,ff,ff,ff,ff'
      )
      .fields.unsigned48.should.equal(2 ** 48 - 1)
  })

  it('leaves out a 64-bit field at its top value, as canboat does', function () {
    fromPgn
      .parseString(
        '2026-11-05T00:00:00.000Z,3,127997,1,255,8,ff,ff,ff,ff,ff,ff,ff,ff'
      )
      .fields.should.not.have.property('unsigned64')
  })

  it('keeps all the bits of a 64-bit spare field, and writes them back', function () {
    const { toPgn } = require('../dist/toPgn')
    for (const bytes of ['0123456789abcdef', 'ffffffffffffffff']) {
      const line =
        '2026-11-05T00:00:00.000Z,3,127996,1,255,8,' +
        bytes.match(/../g).join(',')
      const pgn = fromPgn.parseString(line)
      pgn.fields.spare.should.equal(bytes.toUpperCase().match(/../g).join(' '))
      Buffer.from(toPgn(pgn)).toString('hex').should.equal(bytes)
    }
  })
})
