const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')
const { addCustomPgns } = require('../dist/pgns')

// Messages from canboat's samples that came back from decode and toPgn with
// data lost (#544). Each line is a whole message.
function roundTrip(line) {
  const decode = (l) =>
    new FromPgn({
      useCamel: true,
      includeRawData: true,
      format: 1
    }).parseString(l)
  const pgn = decode(line)
  const got = Buffer.from(toPgn(pgn))
  const header = line.split(',').slice(0, 5).join(',')
  const again = decode(
    `${header},${got.length},${[...got].map((b) => b.toString(16).padStart(2, '0')).join(',')}`
  )
  return {
    pgn,
    again,
    want: Buffer.from(pgn.rawData).toString('hex'),
    got: got.toString('hex')
  }
}

const hex = (fields) => Buffer.from(toPgn(fields)).toString('hex')

describe('a 0 in a 24- or 48-bit field', () => {
  it('is written as 0, not as not available', () => {
    hex({
      pgn: 130316,
      fields: { instance: 0, source: 'Sea Temperature', temperature: 0 }
    }).should.equal('ff0000000000ffff')
  })

  // furuno-130842-accel.raw, maneuvers.raw, ac42-commissioning.raw and
  // fusion-130820-utf8.raw
  ;[
    ['127251 reserved', '2,127251,1,255,8,00,e6,a4,35,00,00,00,00'],
    [
      '130822 sub',
      '3,130822,1,255,15,13,99,ff,01,00,15,01,00,fc,12,00,00,00,a3,5c'
    ],
    [
      '130845 key',
      '2,130845,1,255,14,41,9f,34,ff,ff,ff,00,00,00,00,ff,ff,ff,ff'
    ],
    ['130820 progress', '7,130820,1,255,9,a3,99,09,80,0a,00,00,00,00']
  ].forEach(([what, line]) => {
    it(`comes back from decode and encode (${what})`, () => {
      const { pgn, again, want, got } = roundTrip(
        `2026-01-01T00:00:00.000Z,${line}`
      )
      again.fields.should.deep.equal(pgn.fields)
      // Up to the padding after the last field
      got.slice(0, 16).should.equal(want.slice(0, 16))
    })
  })

  describe('in a custom PGN', () => {
    before(() => {
      const field = (order, id, bitOffset, bits, signed) => ({
        Order: order,
        Id: id,
        Name: id,
        BitLength: bits,
        BitOffset: bitOffset,
        BitStart: 0,
        FieldType: 'NUMBER',
        Resolution: 1,
        Signed: signed
      })
      addCustomPgns(
        {
          PGNs: [
            {
              PGN: 130994,
              Id: 'testWidths',
              Description: 'Widths',
              Type: 'Fast',
              Complete: true,
              Length: 9,
              Fields: [
                field(1, 'signed24', 0, 24, true),
                field(2, 'unsigned48', 24, 48, false)
              ]
            }
          ]
        },
        'test'
      )
    })

    it('writes the values around 0 of a signed 24-bit field', () => {
      const signed24 = (v) =>
        hex({ pgn: 130994, fields: { signed24: v } }).slice(0, 6)
      signed24(0).should.equal('000000')
      signed24(1).should.equal('010000')
      signed24(-1).should.equal('ffffff')
      signed24(-256).should.equal('00ffff')
      signed24(8388606).should.equal('feff7f')
      signed24(-8388608).should.equal('000080')
    })

    it('writes 0 and 1 in a 48-bit field', () => {
      const unsigned48 = (v) =>
        hex({ pgn: 130994, fields: { unsigned48: v } }).slice(6, 18)
      unsigned48(0).should.equal('000000000000')
      unsigned48(1).should.equal('010000000000')
    })
  })
})

describe('a BINARY field given as hex bytes', () => {
  it('is written as given, padded with zeros as canboat does', () => {
    // raymarine-ev1.raw: the message ends after two bytes of unknown2, a
    // 10-byte field. canboat's encoder writes the same.
    const { pgn, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,7,126720,1,255,13,3b,9f,f0,81,84,36,e7,9f,42,00,0e,02,08'
    )
    pgn.fields.unknown2.should.equal('02 08')
    got.should.equal('3b9ff0818436e79f42000e02080000000000000000')
  })

  it('keeps every byte given', () => {
    // maretron-alm100-alert.raw: "Tripped" in the extension
    const { pgn, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,2,130819,1,255,29,89,98,01,ff,ff,92,10,e8,d2,ff,06,18,01,02,0c,80,18,11,01,00,09,01,54,72,69,70,70,65,64'
    )
    pgn.fields.maretronExtension.should.equal(
      '01 00 09 01 54 72 69 70 70 65 64'
    )
    got.slice(-32).should.equal('0100090154726970706564' + '00'.repeat(5))
  })

  it('writes the bits of a field that is not byte-aligned', () => {
    // 129038's communication state is 19 bits: hex bytes and the number
    // write the same bits.
    const position = (communicationState) =>
      hex({
        pgn: 129038,
        fields: {
          messageId: 'Scheduled Class A position report',
          userId: '244650941',
          communicationState
        }
      })
    position('53 2f 00').should.equal(position(12115))
  })

  it('takes a decimal string in a field of up to 64 bits as the number', () => {
    // As n2k-signalk's tests give 129038's communication state
    const position = (communicationState) =>
      hex({
        pgn: 129038,
        fields: {
          messageId: 'Scheduled Class A position report',
          userId: '244650941',
          communicationState
        }
      })
    position('33188').should.equal(position(33188))
    position('0').should.equal(position(0))
  })

  it('refuses a bit set past the width of a field that is not byte-aligned', () => {
    ;(() =>
      hex({
        pgn: 129038,
        fields: {
          messageId: 'Scheduled Class A position report',
          userId: '244650941',
          communicationState: '53 2f 80'
        }
      })).should.throw('has bits set past its 19 bits')
  })

  it('refuses text that is not hex bytes, or too many bytes', () => {
    ;(() =>
      hex({
        pgn: 126720,
        fields: {
          manufacturerCode: 'Raymarine',
          proprietaryId: 'Seatalk 1 Encoded',
          command: 'Seatalk1',
          unknown2: 'abc'
        }
      })).should.throw("'abc' is not hex bytes")
    ;(() =>
      hex({
        pgn: 126720,
        fields: {
          manufacturerCode: 'Raymarine',
          proprietaryId: 'Seatalk 1 Encoded',
          command: 'Seatalk1',
          unknown2: '00 '.repeat(11)
        }
      })).should.throw('11 bytes do not fit in 80 bits')
  })
})

describe('an empty BITLOOKUP', () => {
  // simulator2.raw: no windlass event set
  it('is written as no bit set (128777)', () => {
    const { want, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,2,128777,1,255,8,02,00,f0,6c,02,00,00,00'
    )
    got.should.equal(want)
  })

  it('is written as no bit set (128776)', () => {
    const { pgn, want, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,2,128776,1,255,7,02,00,c0,00,01,96,f0'
    )
    pgn.fields.windlassControlEvents.should.deep.equal([])
    // The message is a byte short of the PGN's 8; toPgn pads it.
    got.should.equal(want + 'ff')
  })
})
