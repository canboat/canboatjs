module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T15:43:57.658Z',
      prio: 6,
      src: 3,
      dst: 255,
      pgn: 129542,
      description: 'GNSS Pseudorange Noise Statistics',
      fields: {
        sid: 120,
        rmsOfPositionUncertainty: 0.73,
        stdOfMajorAxis: 0,
        stdOfMinorAxis: 0,
        orientationOfMajorAxis: 0,
        stdOfAltError: 0,
        stdOfLatError: 0,
        stdOfLonError: 0
      }
    },
    input:
      '2017-04-15T15:43:57.658Z,6,129542,3,255,15,78,49,00,00,00,00,00,00,00,00,00,00,00,00,00'
  }
]
