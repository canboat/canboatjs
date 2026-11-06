const chai = require('chai')
const should = chai.Should()

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

describe('a value at its RangeMax', () => {
  it('is read, and written back', () => {
    // merrimac-2022.raw: a heave of 327.64 m is the raw 0x7ffc, the field's
    // RangeMax, which 327.64 / 0.01 = 32763.999... put just out of range.
    // canboat reads it.
    const { pgn, want, got } = roundTrip(
      '2022-09-10T12:08:17.628Z,3,127252,20,255,8,00,fc,7f,ff,ff,ff,7f,fd'
    )
    pgn.fields.heave.should.equal(327.64)
    got.should.equal(want)
  })
})

describe('a BINARY field given as hex bytes', () => {
  it('ending a multi-frame message, is written as long as given, as canboat does', () => {
    // raymarine-ev1.raw: the message ends after two bytes of unknown2, a
    // 10-byte field, which the decoder reads as those two bytes; canboat
    // writes them back as they are (canboat#1133).
    const { pgn, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,7,126720,1,255,13,3b,9f,f0,81,84,36,e7,9f,42,00,0e,02,08'
    )
    pgn.fields.unknown2.should.equal('02 08')
    got.should.equal('3b9ff0818436e79f42000e0208')
  })

  it('keeps every byte given', () => {
    // maretron-alm100-alert.raw: "Tripped" in the extension
    const { pgn, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,2,130819,1,255,29,89,98,01,ff,ff,92,10,e8,d2,ff,06,18,01,02,0c,80,18,11,01,00,09,01,54,72,69,70,70,65,64'
    )
    pgn.fields.maretronExtension.should.equal(
      '01 00 09 01 54 72 69 70 70 65 64'
    )
    got.slice(-22).should.equal('0100090154726970706564')
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

describe('a trailing BINARY and a catch-all (canboat#1133)', () => {
  it('ending a multi-frame message, is not padded to its width', () => {
    // navico-source-selection.raw: 52 bytes of a 223-byte field.
    const { want, got } = roundTrip(
      '2026-01-01T00:00:00.000Z,7,130822,1,255,52,13,99,ff,02,00,09,02,00,01,00,00,00,66,6d,24,00,04,43,66,e7,4c,82,50,c0,02,01,00,a1,36,00,82,32,c0,02,d2,44,d3,15,00,91,47,c0,03,1f,19,36,e8,00,c8,a0,c0,02'
    )
    got.should.equal(want)
  })

  it('writes a message read with the catch-all of a PGN that has no definition of its own', () => {
    // raymarine-ev1.raw
    const { pgn, want, got } = roundTrip(
      '2024-02-17T05:15:49.768Z,7,65384,0,255,8,3b,9f,00,00,00,00,00,00'
    )
    pgn.id.should.equal(
      '0xff000xffffManufacturerProprietarySingleFrameNonAddressed'
    )
    got.should.equal(want)
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

// A DYNAMIC_FIELD_VALUE without a DYNAMIC_FIELD_KEY takes its width from the
// record's DYNAMIC_FIELD_LENGTH, as the decoder and canboat read it (#544).
describe('a dynamic value sized by its length field', () => {
  it('comes back byte for byte', () => {
    // live.all: Navico UDB Database, Object Dump
    const { pgn, got, want } = roundTrip(
      '2026-07-06T05:37:38.666Z,3,130822,30,255,166,13,99,ff,06,00,03,01,12,06,98,00,00,fc,8d,0b,09,34,00,00,00,00,00,00,00,00,00,12,06,56,00,0a,00,01,00,a1,36,00,82,32,c0,00,00,00,00,00,0b,09,57,00,00,00,00,00,00,00,00,00,0b,09,58,00,00,00,00,00,00,00,00,00,0b,09,59,00,00,00,00,00,00,00,00,00,0b,09,5a,00,00,00,00,00,00,00,00,00,0b,09,5b,00,00,00,00,00,00,00,00,00,12,06,5c,00,0a,00,01,00,a1,36,00,82,32,c0,00,00,00,00,00,04,02,6f,00,00,0e,02,a0,00,0a,00,01,00,a1,36,00,82,32,c0,00,04,02,a1,00,00,04,02,a2,00,00,0b,09,3d,02,00,00,00,00,00,00,00,00'
    )
    pgn.id.should.equal('navicoUdbDatabaseObjectDump')
    got.should.equal(want)
  })

  it('writes a one-byte value as that byte', () => {
    // Constructed from the capture's layout: one record whose value is the
    // byte 0x10, which the decoder gives as "10".
    const bytes =
      '13,99,ff,06,00,05,03,e8,52,0f,01,00,37,e1,04,02,01,00,10'.split(',')
    const { pgn, got, want } = roundTrip(
      `2026-07-05T00:04:57.870Z,3,130822,28,255,${bytes.length},${bytes.join(',')}`
    )
    pgn.fields.list[0].value.should.equal('10')
    got.should.equal(want)
  })
})

// A message no variant describes decodes with its range's catch-all, which
// names it by id; toPgn writes it with that definition, its data as given,
// as canboat writes a JSON message by its id.
describe('a message decoded with a catch-all', () => {
  it('comes back byte for byte', () => {
    ;[
      // garmin-ap-reactor-126720.raw (fast-packet, addressed range)
      '2026-07-07T18:51:24.255Z,7,126720,0,255,13,e5,98,10,17,04,04,0b,02,0a,6e,0c,11,00',
      // ac42-commissioning.raw (single-frame range, listed under 65280)
      '2026-06-08T01:55:43.727,7,65305,13,255,8,41,9f,00,1e,02,00,00,00'
    ].forEach((line) => {
      const { pgn, got, want } = roundTrip(line)
      pgn.id.should.match(/^0x/)
      got.should.equal(want)
    })
  })

  it('writes one byte of data as that byte, and no data as nothing', () => {
    // Constructed: no capture of such short catch-all messages is at hand.
    ;[
      '2026-01-01T00:00:00.000Z,7,65305,13,255,3,41,9f,10',
      '2026-01-01T00:00:00.000Z,7,65305,13,255,2,41,9f'
    ].forEach((line) => {
      const { got, want } = roundTrip(line)
      got.should.equal(want)
    })
  })

  it('is written with the catch-all its description names, as canboat writes it', () => {
    // canboat's JSON names the definition by its description, not an id
    // (#579): without the id, the catch-all's description still says it.
    const { pgn } = roundTrip(
      '2026-07-07T18:51:24.255Z,7,126720,0,255,13,e5,98,10,17,04,04,0b,02,0a,6e,0c,11,00'
    )
    const { id, ...unnamed } = pgn
    id.should.match(/^0x/)
    Buffer.from(toPgn(unnamed))
      .toString('hex')
      .should.equal('e598101704040b020a6e0c1100')
  })

  it('is written with a variant when it names neither', () => {
    // Without id or description, a manufacturer that has variants takes
    // one its given values do not contradict, as before.
    const { pgn } = roundTrip(
      '2026-07-07T18:51:24.255Z,7,126720,0,255,13,e5,98,10,17,04,04,0b,02,0a,6e,0c,11,00'
    )
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, description, ...unnamed } = pgn
    Buffer.from(toPgn(unnamed))
      .toString('hex')
      .should.not.equal('e598101704040b020a6e0c1100')
  })

  it('is written with the catch-all its description names, for a PGN with no definition', () => {
    // 65307 has no definition of its own: canboat's JSON names its range's
    // catch-all by description only.
    Buffer.from(
      toPgn({
        pgn: 65307,
        description:
          '0xFF00-0xFFFF: Manufacturer Proprietary single-frame non-addressed',
        fields: {
          manufacturerCode: 'Garmin',
          industryCode: 'Marine Industry',
          data: '01 02 03 04 05 06'
        }
      })
    )
      .toString('hex')
      .should.equal('e598010203040506')
  })

  it('gets the match values it leaves out from the variant it is written with', () => {
    // No industry code: written as the Seatalk1 variant's own (4), so the
    // bytes still say which variant it is.
    const data = toPgn({
      pgn: 126720,
      fields: {
        manufacturerCode: 'Raymarine',
        proprietaryId: 'Seatalk 1 Encoded',
        command: 'Seatalk1',
        seatalk1Command: 'Compass heading Autopilot course and Rudder position'
      }
    })
    Buffer.from(data).toString('hex').slice(0, 4).should.equal('3b9f')
  })

  it('takes an explicit null match value as given, not as left out', () => {
    // industryCode null contradicts every 126720 Raymarine variant (4), as
    // selectDefinition reads it: no variant is chosen and filled in with 4.
    const data = toPgn({
      pgn: 126720,
      fields: {
        manufacturerCode: 'Raymarine',
        industryCode: null,
        proprietaryId: 'Seatalk 1 Encoded',
        command: 'Seatalk1'
      }
    })
    Buffer.from(data).toString('hex').slice(0, 4).should.not.equal('3b9f')
  })

  it('is written with the catch-all when every variant is contradicted', () => {
    // canboat's JSON of a 130817 from manufacturer 256, which no 130817
    // variant is for: susteranna2020.raw.
    Buffer.from(
      toPgn({
        pgn: 130817,
        fields: {
          manufacturerCode: 256,
          reserved: '02',
          industryCode: 'Construction',
          data: '8C 80 93 02 54 65'
        }
      })
    )
      .toString('hex')
      .should.equal('00718c8093025465')
  })
})

// A 64-bit NAME is more than a number holds exactly: it is given as its
// digits, as canboat's JSON has them, and written back as they are.
describe('a 64-bit NAME', () => {
  it('decodes as its exact digits and encodes back', () => {
    // maretron-alm100-alert.raw; canboat gives 865255281116828392.
    const { pgn, got, want } = roundTrip(
      '2026-08-10T21:49:32.206Z,2,130819,128,255,29,89,98,01,ff,ff,92,10,e8,d2,ff,06,18,01,02,0c,80,18,11,01,00,09,01,54,72,69,70,70,65,64'
    )
    pgn.fields.dataSourceNetworkIdName.should.equal('865255281116828392')
    // The NAME's bytes come back; the trailing extension is padded to its
    // width, as canboat's encoder does.
    got.slice(0, 32).should.equal(want.slice(0, 32))
  })
})

// bit-buffer keeps 32 bits of a value it shifts, so a field wider than 32
// bits (40 or 56; no built-in definition has one) is written in two parts.
describe('a 40-bit number', () => {
  const field = (order, id, bits, signed) => ({
    Order: order,
    Id: id,
    Name: id,
    BitLength: bits,
    BitOffset: 0,
    BitStart: 0,
    FieldType: 'NUMBER',
    Resolution: 1,
    Signed: signed
  })
  before(() => {
    addCustomPgns(
      {
        PGNs: [
          {
            PGN: 130990,
            Id: 'test40Bit',
            Description: '40-bit numbers',
            Type: 'Single',
            Complete: true,
            Length: 8,
            Fields: [
              field(1, 'unsigned', 40, false),
              field(2, 'signed', 24, true)
            ]
          },
          {
            PGN: 130991,
            Id: 'test40BitSigned',
            Description: 'a signed 40-bit number',
            Type: 'Single',
            Complete: true,
            Length: 8,
            Fields: [field(1, 'value', 40, true), field(2, 'rest', 24, false)]
          },
          {
            PGN: 130992,
            Id: 'test56Bit',
            Description: 'an unsigned 56-bit number',
            Type: 'Single',
            Complete: true,
            Length: 8,
            Fields: [field(1, 'value', 56, false), field(2, 'rest', 8, false)]
          },
          {
            PGN: 130993,
            Id: 'test56BitSigned',
            Description: 'a signed 56-bit number',
            Type: 'Single',
            Complete: true,
            Length: 8,
            Fields: [field(1, 'value', 56, true), field(2, 'rest', 8, false)]
          }
        ]
      },
      'test'
    )
  })
  const decode = (pgn, buf) =>
    new FromPgn({ useCamel: true }).parseString(
      `2026-01-01T00:00:00.000Z,2,${pgn},1,255,8,${[...buf].map((b) => b.toString(16).padStart(2, '0')).join(',')}`
    ).fields

  it('keeps the bits above 32', () => {
    ;[0x80000000, 2 ** 39 + 5].forEach((value) => {
      const buf = Buffer.from(
        toPgn({ pgn: 130990, fields: { unsigned: value, signed: 1 } })
      )
      decode(130990, buf).unsigned.should.equal(value)
    })
  })

  it('writes a negative one as its two’s complement', () => {
    const buf = Buffer.from(
      toPgn({ pgn: 130991, fields: { value: -(2 ** 33) - 3, rest: 1 } })
    )
    buf.subarray(0, 5).toString('hex').should.equal('fdfffffffd')
    decode(130991, buf).value.should.equal(-(2 ** 33) - 3)
  })

  it('reads all ones as not available, and only that', () => {
    const fromHex = (hex) => Buffer.from(hex.replace(/ /g, ''), 'hex')
    // unsigned: all 40 bits set; 2^32 - 1 is a value
    should.not.exist(decode(130990, fromHex('ffffffffff 010000')).unsigned)
    decode(130990, fromHex('ffffffff00 010000')).unsigned.should.equal(
      2 ** 32 - 1
    )
    // signed: 2^39 - 1
    should.not.exist(decode(130991, fromHex('ffffffff7f 010000')).value)
    // 56 bits, unsigned and signed
    should.not.exist(decode(130992, fromHex('ffffffffffffff 01')).value)
    should.not.exist(decode(130993, fromHex('ffffffffffff7f 01')).value)
    // 2^56 - 2 and 2^55 - 2 round onto the not-available value as Numbers
    decode(130992, fromHex('feffffffffffff 01')).value.should.equal(2 ** 56)
    decode(130993, fromHex('feffffffffff7f 01')).value.should.equal(2 ** 55)
  })

  it('reads the most negative 56-bit number', () => {
    const buf = Buffer.from(
      toPgn({ pgn: 130993, fields: { value: -(2 ** 55), rest: 1 } })
    )
    buf.subarray(0, 7).toString('hex').should.equal('00000000000080')
    decode(130993, buf).value.should.equal(-(2 ** 55))
  })

  it('refuses a value too wide for 56 bits', () => {
    ;(() =>
      toPgn({ pgn: 130992, fields: { value: 2 ** 56, rest: 1 } })).should.throw(
      /outside its range/
    )
  })
})
