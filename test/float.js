const chai = require('chai')
chai.Should()

const { FromPgn, toPgn } = require('../dist/index')

// FLOAT fields are IEEE-754 singles, given with the six significant
// digits canboat prints them with (decode_float, fieldPrintFloat).
describe('FLOAT fields', () => {
  const decode = (line) =>
    new FromPgn({ useCamel: true }).parseString(line).fields

  it('decodes an IEEE-754 single', () => {
    // canboat's analyzer/tests/pgn-float-units.in: Garmin Heading to
    // Steer 2.7274 rad.
    decode(
      '2023-01-01-00:00:00.000,7,126720,0,255,13,e5,98,10,17,04,04,00,0b,00,b4,8d,2e,40'
    ).headingToSteer.should.equal(2.7274)
  })

  it('leaves out a NaN, which is not available', () => {
    decode(
      '2023-01-01-00:00:00.000,7,126720,0,255,13,e5,98,10,17,04,04,00,0b,00,ff,ff,ff,ff'
    ).should.not.have.property('headingToSteer')
  })

  it('encodes a value as a single, and not available as all ones', () => {
    const msg = (headingToSteer) => ({
      pgn: 126720,
      prio: 7,
      src: 0,
      dst: 255,
      fields: {
        manufacturerCode: 'Garmin',
        industryCode: 'Marine Industry',
        subProtocolId: 'Autopilot transport',
        wrapperByte1: 4,
        wrapperByte2: 4,
        fieldGroup: 0,
        field: 'Heading to Steer',
        headingToSteer
      }
    })
    const tail = (v) =>
      Buffer.from(toPgn(msg(v)))
        .toString('hex')
        .slice(-8)
    tail(2.7274).should.equal(
      Buffer.from(new Float32Array([2.7274]).buffer).toString('hex')
    )
    tail(undefined).should.equal('ffffffff')
  })
})
