const chai = require('chai')
chai.Should()
const fs = require('fs')
const path = require('path')

const { FromPgn } = require('../dist/index')
const { pgnToYdgwRawFormat } = require('../dist/toPgn')

// excludePgns: FromPgn drops these PGNs before reassembly and decoding, on
// every input.

function parser(excludePgns) {
  const fromPgn = new FromPgn({ useCamel: true, excludePgns })
  const errors = []
  const pgns = []
  fromPgn.on('error', (pgn, error) => errors.push(error))
  fromPgn.on('warning', (pgn, warning) => errors.push(new Error(warning)))
  fromPgn.on('pgn', (pgn) => pgns.push(pgn))
  return { fromPgn, errors, pgns }
}

const heading = {
  pgn: 127250,
  prio: 2,
  src: 3,
  dst: 255,
  fields: { sid: 1, heading: 1.5, reference: 'Magnetic' }
}

// Fast-packet, 8 bytes: two frames.
const battery = {
  pgn: 127513,
  prio: 6,
  src: 3,
  dst: 255,
  fields: {
    instance: 1,
    batteryType: 'AGM',
    nominalVoltage: '12V',
    chemistry: 'Pb (Lead)',
    capacity: 720000
  }
}

const lines = (...pgns) => pgns.flatMap((pgn) => pgnToYdgwRawFormat(pgn))

describe('excludePgns in FromPgn', function () {
  it('drops a single-frame and a fast-packet PGN, and passes the rest', function () {
    const { fromPgn, errors, pgns } = parser([127513])
    lines(heading, battery, heading).forEach((l) => fromPgn.parseString(l))
    errors.should.deep.equal([])
    pgns.map((p) => p.pgn).should.deep.equal([127250, 127250])

    const other = parser('127250')
    lines(heading, battery).forEach((l) => other.fromPgn.parseString(l))
    other.errors.should.deep.equal([])
    other.pgns.map((p) => p.pgn).should.deep.equal([127513])
  })

  it('drops a PGN that arrives as a decoded CAN frame, as from canbus', function () {
    const { fromPgn, pgns } = parser([127250])
    const [line] = pgnToYdgwRawFormat(heading)
    const data = Buffer.from(line.split(' ').slice(1).join(''), 'hex')
    const header = { pgn: 127250, prio: 2, src: 3, dst: 255 }
    fromPgn.parse({ pgn: { ...header }, length: data.length, data })
    pgns.should.deep.equal([])

    const all = parser()
    all.fromPgn.parse({ pgn: { ...header }, length: data.length, data })
    all.pgns.map((p) => p.pgn).should.deep.equal([127250])
  })

  it('drops a PGN carried by the ISO transport protocol, once it is complete', function () {
    const input = fs
      .readFileSync(
        path.join(__dirname, 'data', 'reassembly', 'iso-tp-test.in'),
        'utf8'
      )
      .split('\n')
      .filter((l) => l.length > 0 && !l.startsWith('#'))

    const dropped = parser([129540])
    input.forEach((l) => dropped.fromPgn.parseString(l))
    dropped.pgns.should.deep.equal([])

    const kept = parser([130824])
    input.forEach((l) => kept.fromPgn.parseString(l))
    kept.pgns.map((p) => p.pgn).should.deep.equal([129540])
  })

  it('never drops network management', function () {
    const claim = {
      pgn: 60928,
      prio: 6,
      src: 3,
      dst: 255,
      fields: {
        uniqueNumber: 1,
        manufacturerCode: 'Garmin',
        deviceInstanceLower: 0,
        deviceInstanceUpper: 0,
        deviceFunction: 130,
        deviceClass: 'Navigation',
        systemInstance: 0,
        industryGroup: 'Marine',
        arbitraryAddressCapable: 'Yes'
      }
    }
    const { fromPgn, pgns } = parser([60928])
    lines(claim).forEach((l) => fromPgn.parseString(l))
    pgns.map((p) => p.pgn).should.deep.equal([60928])
  })
})
