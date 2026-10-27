const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')

// A set BITLOOKUP bit without a name is given as its value, as canboat
// gives it, instead of null. The frames are canboat's analyzer/tests/
// pgn-bitlookup-64.in: Fusion System Capabilities, a 64-bit BITLOOKUP.
const TWO_UNNAMED =
  '2026-09-19T06:23:22.137Z,7,130820,12,255,12,a3,99,3d,80,83,64,00,18,00,14,00,00'
const BIT_63 =
  '2026-09-24T03:35:36.610Z,7,130820,51,255,12,a3,99,3d,80,01,00,00,00,00,00,00,80'

function decode(line) {
  return new FromPgn({ useCamel: true }).parseString(line)
}

describe('a BITLOOKUP bit without a name', function () {
  it('is given as its value, as canboat gives it', function () {
    decode(TWO_UNNAMED).fields.capabilities.should.deep.equal([
      'ANT',
      'Bluetooth',
      'Power Button',
      'USB Connector',
      'AM/FM Antenna',
      'DAB Antenna',
      134217728,
      268435456,
      'Zone 1 Amplifier 4 Ohm Stable',
      'Zone 2 Amplifier 4 Ohm Stable'
    ])
  })

  it('is given as its value in the top bit of 64', function () {
    decode(BIT_63).fields.capabilities.should.deep.equal(['ANT', 2 ** 63])
  })

  it('is encoded from its value', function () {
    for (const line of [TWO_UNNAMED, BIT_63]) {
      const data = line.split(',').slice(6).join('')
      Buffer.from(toPgn(decode(line)))
        .toString('hex')
        .should.equal(data)
    }
  })
})
