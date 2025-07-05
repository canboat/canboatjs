module.exports = [
  {
    expected: {
      prio: 5,
      pgn: 127497,
      dst: 255,
      src: 57,
      timestamp: '2020-03-31T02:34:18.529Z',
      fields: {
        instance: 224,
        tripFuelUsed: 9,
        fuelRateAverage: -3100.2,
        instantaneousFuelEconomy: -0.1,
        fuelRateEconomy: null
      },
      description: 'Trip Parameters, Engine'
    },
    input:
      '2020-03-31T02:34:18.529Z,5,127497,57,255,9,e0,09,00,e6,86,ff,7f,ff,ff'
  }
]
