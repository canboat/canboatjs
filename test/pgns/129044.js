module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:58:06.474Z',
      prio: 6,
      src: 3,
      dst: 255,
      pgn: 129044,
      description: 'Datum',
      fields: {
        localDatum: 'W84',
        deltaLatitude: 0,
        deltaLongitude: 0,
        deltaAltitude: 0,
        referenceDatum: 'W84'
      }
    },
    input:
      '2017-04-15T14:58:06.474Z,6,129044,3,255,20,57,38,34,ff,00,00,00,00,00,00,00,00,00,00,00,00,57,38,34,ff'
  },
  {
    expected: {
      timestamp: '2017-04-15T14:58:06.474Z',
      prio: 6,
      src: 3,
      dst: 255,
      pgn: 129044,
      description: 'Datum',
      fields: {
        localDatum: 'W8',
        deltaLatitude: 0,
        deltaLongitude: 0,
        deltaAltitude: 0,
        referenceDatum: 'W84'
      }
    },
    input:
      '2017-04-15T14:58:06.474Z,6,129044,3,255,20,57,38,00,ff,00,00,00,00,00,00,00,00,00,00,00,00,57,38,34,ff',
    skipEncoderTest: true
  }
]
