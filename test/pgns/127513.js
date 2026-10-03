// Peukert Exponent: uint8, resolution 0.002, range 1 - 1.5 (NMEA 2000 DF101),
// so the wire value is (exponent - 1) / 0.002. canboat.json gives the offset
// in the field's own units (Offset: 1), so it is added after scaling.
const input = (peukert) =>
  `2026-05-06T12:00:00.000Z,6,127513,35,255,8,00,12,01,64,00,fb,${peukert},5a`

const expected = (peukertExponent) => ({
  timestamp: '2026-05-06T12:00:00.000Z',
  prio: 6,
  src: 35,
  dst: 255,
  pgn: 127513,
  description: 'Battery Configuration Status',
  fields: {
    instance: 0,
    batteryType: 'AGM',
    supportsEqualization: 'Yes',
    reserved: 0,
    nominalVoltage: '12V',
    chemistry: 'Pb (Lead)',
    capacity: 360000,
    temperatureCoefficient: -0.05,
    peukertExponent,
    chargeEfficiencyFactor: 0.9
  }
})

module.exports = [
  { expected: expected(1), input: input('00') },
  { expected: expected(1.25), input: input('7d') },
  { expected: expected(1.5), input: input('fa') }
]
