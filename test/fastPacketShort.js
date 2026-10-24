const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const {
  pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat,
  pgnToCandump1,
  pgnToCandump2,
  pgnToCandump3
} = require('../dist/toPgn')

// A fast-packet PGN with a payload of 8 bytes or fewer still goes out in
// fast-packet frames: its receiver reads the first byte as the frame header
// (#523).

// 127513 Battery Configuration Status is fast-packet, 8 bytes long.
const battery = {
  pgn: 127513,
  prio: 6,
  src: 3,
  dst: 255,
  fields: {
    Instance: 1,
    'Battery Type': 'AGM',
    'Nominal Voltage': '12V',
    Chemistry: 'Pb (Lead)',
    Capacity: 720000
  }
}

function parseOne(lines) {
  const fromPgn = new FromPgn({ useCamel: false })
  const errors = []
  const pgns = []
  fromPgn.on('error', (pgn, error) => errors.push(error))
  fromPgn.on('warning', (pgn, warning) => errors.push(new Error(warning)))
  fromPgn.on('pgn', (pgn) => pgns.push(pgn))
  lines.forEach((line) => fromPgn.parseString(line))
  errors.should.deep.equal([])
  pgns.should.have.length(1)
  return pgns[0]
}

/* The data bytes of each line, as hex, the part after the CAN id. */
const encoders = [
  {
    name: 'YDWG RAW',
    encode: pgnToYdgwRawFormat,
    data: (line) => line.split(' ').slice(1).join('')
  },
  {
    name: 'YDWG RAW, with time and direction',
    encode: pgnToYdgwFullRawFormat,
    data: (line) => line.split(' ').slice(3).join('')
  },
  {
    name: 'candump, format 1',
    encode: pgnToCandump1,
    data: (line) => line.split(/\s+/).slice(2).join('')
  },
  {
    name: 'candump, format 2',
    encode: pgnToCandump2,
    data: (line) => line.split(/\s+/).slice(3).join('')
  },
  {
    name: 'candump, format 3',
    encode: pgnToCandump3,
    data: (line) => line.split('#')[1]
  }
]

describe('a fast-packet PGN of 8 bytes or fewer', function () {
  encoders.forEach(({ name, encode, data }) => {
    it(`${name}: two fast-packet frames, which decode back`, function () {
      const lines = encode(battery)
      lines.should.be.an('array').with.length(2)
      // The first frame: the sequence and frame counter, then the length, 8.
      data(lines[0]).should.match(/^[0-9A-Fa-f]008/)
      parseOne(lines).fields.should.include({
        Instance: 1,
        'Battery Type': 'AGM',
        'Nominal Voltage': '12V',
        Chemistry: 'Pb (Lead)',
        Capacity: 720000
      })
    })
  })
})
