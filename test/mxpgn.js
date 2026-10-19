const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

const { FromPgn, encodeMXPGN, pgnToMXPGN } = require('../dist/index')

// $MXPGN as specified in the ShipModul Proprietary Command Reference
// (https://www.shipmodul.com/download/commands-v3.40.0.pdf): one CAN frame
// per sentence, its data written last byte first. Unless noted, the
// sentences are the reference's own examples or MiniPlex output.

function parse(sentences, options = {}) {
  const fromPgn = new FromPgn({ useCamel: false, ...options })
  const errors = []
  const pgns = []
  fromPgn.on('error', (pgn, error) => errors.push(error))
  fromPgn.on('warning', (pgn, warning) => errors.push(new Error(warning)))
  fromPgn.on('pgn', (pgn) => {
    delete pgn.input
    delete pgn.timestamp
    delete pgn.id
    pgns.push(pgn)
  })
  ;[].concat(sentences).forEach((s) => fromPgn.parseString(s))
  return { pgns, errors }
}

function parseOne(sentence, options) {
  const { pgns, errors } = parse(sentence, options)
  errors.should.deep.equal([])
  pgns.should.have.length(1)
  return pgns[0]
}

const position = {
  pgn: 129025,
  src: 1,
  dst: 255,
  prio: 2,
  fields: {
    Latitude: 20.7479619,
    Longitude: -105.3783356
  },
  description: 'Position, Rapid Update'
}

describe('from mxpgn data converts', function () {
  it('129025 from a MiniPlex', function () {
    parseOne('$MXPGN,01F801,2801,C1308AC40C5DE343*19').should.jsonEqual(
      position
    )
  })

  it('129025 with tags', function () {
    parseOne(
      '\\s:serial,c:1696759212*3E\\$MXPGN,01F801,2801,C1308AC40C5DE343*19'
    ).should.jsonEqual(position)
  })

  it('129025 from the ShipModul developer, matching their RMC', function () {
    // https://github.com/canboat/canboatjs/issues/493, converted from
    // $GNRMC,130208.00,A,5301.70625,N,00634.56966,E,0.023,,121026,,,A*6B
    const pgn = parseOne('$MXPGN,01F801,280A,03EB71821F9B7F2D*66')
    pgn.src.should.equal(10)
    pgn.fields.should.deep.equal({
      Latitude: 53.0284333,
      Longitude: 6.5761666
    })
  })

  it('reads the old littleEndianMXPGN: true as the default order', function () {
    parseOne('$MXPGN,01F801,2801,C1308AC40C5DE343*19', {
      littleEndianMXPGN: true
    }).should.jsonEqual(position)
  })

  // The same frame as the MiniPlex's above, its data in bus order, as
  // Actisense firmware up to v3.120 writes it.
  const busOrder = '$MXPGN,01F801,2801,43E35D0CC48A30C1*19'

  it('129025 in bus order with mxpgnBusOrder', function () {
    parseOne(busOrder, { mxpgnBusOrder: true }).should.jsonEqual(position)
  })

  it('129025 in bus order with an explicit littleEndianMXPGN: false', function () {
    parseOne(busOrder, { littleEndianMXPGN: false }).should.jsonEqual(position)
  })

  it('the Actisense SDK example (127508 at 12.00 V), firmware v3.121 on', function () {
    // https://github.com/Actisense/SDK/issues/6
    const pgn = parseOne('$MXPGN,01F214,6842,FFFFFF7FFF04B000*1F')
    pgn.should.include({ pgn: 127508, src: 0x42, prio: 6 })
    pgn.fields.should.include({ Instance: 0, Voltage: 12 })
  })

  it('the old Actisense SDK example in bus order, firmware up to v3.120', function () {
    const pgn = parseOne('$MXPGN,01F214,6842,00B004FF7FFFFFFF', {
      mxpgnBusOrder: true
    })
    pgn.should.include({ pgn: 127508, src: 0x42, prio: 6 })
    pgn.fields.should.include({ Voltage: 12 })
  })

  it('127250 received from source 7', function () {
    const pgn = parseOne('$MXPGN,01F112,2807,FC7FFF7FFF168012*11')
    pgn.should.include({ pgn: 127250, src: 7, dst: 255, prio: 2 })
    pgn.fields.should.include({ SID: 18, Heading: 0.576 })
  })

  it('a received ISO Request, destination in the PGN field', function () {
    const pgn = parseOne('$MXPGN,00EA09,6303,01F016*1B')
    pgn.should.include({ pgn: 59904, src: 3, dst: 9, prio: 6 })
    pgn.fields.should.deep.equal({ PGN: 126998 })
  })

  it('an ISO Request to send, destination in the attribute', function () {
    const pgn = parseOne('$MXPGN,00EA00,F309,01F016*68')
    pgn.should.include({ pgn: 59904, dst: 9, prio: 7 })
  })

  it('an ISO Request to send without an attribute', function () {
    const pgn = parseOne('$MXPGN,00EA09,,01F016*1D')
    pgn.should.include({ pgn: 59904, dst: 9, prio: 7 })
  })

  it('reassembles a fast-packet PGN sent one frame per sentence', function () {
    // Constructed: the frames pgnToMXPGN writes, as a MiniPlex would
    // forward them (S=0, from source 1).
    const pgn = parseOne([
      '$MXPGN,01F805,3801,F8A5005102012B40*69',
      '$MXPGN,01F805,3801,F2CA926B82401B41*61',
      '$MXPGN,01F805,3801,E305C49400075B42*6F',
      '$MXPGN,01F805,3801,FFFFFFFF00E9A143*1B',
      '$MXPGN,01F805,3801,09FF127FFFFFFF44*6B',
      '$MXPGN,01F805,3801,FFFFFF7FFF005A45*14',
      '$MXPGN,01F805,3801,FFFFFFFFFFFF7F46*63'
    ])
    pgn.should.include({ pgn: 129029, src: 1 })
    pgn.fields.should.include({
      Latitude: 53.0284333,
      Longitude: 6.5761666,
      'Number of SVs': 9
    })
  })

  it('rejects more than 8 data bytes', function () {
    const { pgns, errors } = parse('$MXPGN,01F801,2801,C1308AC40C5DE34300*19')
    pgns.should.have.length(0)
    errors.should.have.length(1)
  })
})

describe('to mxpgn', function () {
  it('a global PGN, as in the reference', function () {
    encodeMXPGN({
      pgn: 127250,
      prio: 2,
      src: 7,
      data: Buffer.from('128016FF7FFF7FFC', 'hex')
    }).should.equal('$MXPGN,01F112,A800,FC7FFF7FFF168012*65')
  })

  it('an addressed PGN, destination in the attribute', function () {
    encodeMXPGN({
      pgn: 59904,
      prio: 7,
      dst: 9,
      data: Buffer.from('16F001', 'hex')
    }).should.equal('$MXPGN,00EA00,F309,01F016*68')
  })

  it('a global PGN in bus order with mxpgnBusOrder', function () {
    encodeMXPGN(
      {
        pgn: 127250,
        prio: 2,
        data: Buffer.from('128016FF7FFF7FFC', 'hex')
      },
      { mxpgnBusOrder: true }
    ).should.equal('$MXPGN,01F112,A800,128016FF7FFF7FFC*65')
  })

  it('reads back what it writes, in either order', function () {
    const msg = { pgn: 129025, prio: 2, fields: position.fields }
    for (const options of [undefined, { mxpgnBusOrder: true }]) {
      parseOne(pgnToMXPGN(msg, options), options).fields.should.deep.equal(
        position.fields
      )
    }
  })

  it('a fast-packet PGN of 8 bytes still goes out in fast-packet frames', function () {
    // 127513 Battery Configuration Status is fast-packet, 8 bytes long.
    const msg = {
      pgn: 127513,
      prio: 6,
      fields: {
        Instance: 1,
        'Battery Type': 'AGM',
        'Supports Equalization': 'No',
        'Nominal Voltage': '12V',
        Chemistry: 'Lead Acid',
        // SI: 200 Ah in coulombs, 95 % as a ratio.
        Capacity: 720000,
        'Temperature Coefficient': 0,
        'Peukert Exponent': 1.25,
        'Charge Efficiency Factor': 0.95
      }
    }
    const sentences = pgnToMXPGN(msg)
    sentences.should.be.an('array').with.length(2)
    sentences.forEach((s) => s.should.match(/^\$MXPGN,01F219,E[0-9A-F]00,/))
    // The first frame: the fast-packet header, then the length, 8.
    sentences[0].should.match(/^\$MXPGN,01F219,E800,[0-9A-F]{12}08[0-9A-F]0\*/)
    parseOne(sentences).fields.should.include({
      Instance: 1,
      'Battery Type': 'AGM',
      'Nominal Voltage': '12V'
    })
  })

  it('a fast-packet PGN, one sentence per frame', function () {
    const msg = {
      pgn: 129029,
      prio: 3,
      src: 1,
      dst: 255,
      fields: {
        SID: 1,
        Date: '2026.10.12',
        Time: '13:02:08',
        Latitude: 53.0284333,
        Longitude: 6.5761666,
        'GNSS type': 'GPS+GLONASS',
        Method: 'GNSS fix',
        'Number of SVs': 9,
        HDOP: 0.9
      }
    }
    const sentences = pgnToMXPGN(msg)
    sentences.should.have.length(7)
    sentences.forEach((s) => s.should.match(/^\$MXPGN,01F805,B800,/))

    const pgn = parseOne(sentences)
    pgn.fields.should.include({
      Latitude: 53.0284333,
      Longitude: 6.5761666,
      'Number of SVs': 9
    })
  })
})
