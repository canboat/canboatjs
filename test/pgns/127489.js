module.exports = [
{
  expected: {
    timestamp: '2023-04-01T17:24:51.634Z',
    prio: 2,
    src: 16,
    dst: 255,
    pgn: 127489,
    description: 'Engine Parameters, Dynamic',
    fields: {
      instance: 'Single Engine or Dual Engine Port',
      oilPressure: 158300,
      temperature: 296.67,
      alternatorPotential: 13.82,
      discreteStatus1: [ 'Over Temperature', 'Low Oil Pressure' ],
      discreteStatus2: [],
      totalEngineHours: '00:10:00',
      coolantPressure: null,
      engineLoad: null,
      engineTorque: null,
      fuelPressure: null,
      fuelRate: null,
      oilTemperature: null,
      reserved: null
    }
  },
  input: '2023-04-01T17:24:51.634Z,2,127489,16,255,26,00,2f,06,ff,ff,e3,73,66,05,ff,7f,58,02,00,00,ff,ff,ff,ff,ff,06,00,00,00,7f,7f'
}
,
{
  expected: {
    timestamp: '2017-04-15T14:57:58.469Z',
    prio: 2,
    src: 17,
    dst: 255,
    pgn: 127489,
    description: 'Engine Parameters, Dynamic',
    fields: {
      instance: 'Single Engine or Dual Engine Port',
      oilPressure: 393000,
      temperature: 330.43,
      discreteStatus1: [],
      discreteStatus2: [],
      alternatorPotential: null,
      coolantPressure: null,
      engineLoad: null,
      engineTorque: null,
      fuelPressure: null,
      fuelRate: null,
      oilTemperature: null,
      reserved: null,
      totalEngineHours: null
    }
  },
  input: '2017-04-15T14:57:58.469Z,2,127489,17,255,26,00,5a,0f,ff,ff,13,81,ff,7f,ff,7f,ff,ff,ff,ff,ff,ff,ff,ff,ff,00,00,00,00,7f,7f'
}
,
]
