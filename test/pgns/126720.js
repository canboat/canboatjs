module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T16:02:48.913Z',
      prio: 7,
      src: 1,
      dst: 255,
      pgn: 126720,
      description: 'Seatalk1: Device Identification',
      fields: {
        command: 'Device Identification',
        device: 'S100',
        manufacturerCode: 'Raymarine',
        industryCode: 'Marine Industry',
        proprietaryId: 'Seatalk',
        reserved: null,
        reserved6: null
      }
    },
    input: '2017-04-15T16:02:48.913Z,7,126720,1,255,7,3b,9f,f0,81,90,ff,03'
  },
  {
    expected: {
      timestamp: '2023-09-25T18:06:16.648Z',
      prio: 7,
      src: 35,
      dst: 100,
      pgn: 126720,
      description: 'Airmar: Calibrate Speed',
      fields: {
        list: [
          { inputFrequency: 2.3, outputSpeed: 0.51 },
          { inputFrequency: 7.9, outputSpeed: 1.03 },
          { inputFrequency: 17.9, outputSpeed: 2.06 },
          { inputFrequency: 26.6, outputSpeed: 3.09 },
          { inputFrequency: 34, outputSpeed: 4.12 },
          { inputFrequency: 44.6, outputSpeed: 6.17 },
          { inputFrequency: 47.9, outputSpeed: 7.2 },
          { inputFrequency: 49.9, outputSpeed: 8.23 }
        ],
        manufacturerCode: 'Airmar',
        industryCode: 'Marine Industry',
        proprietaryId: 'Calibrate Speed',
        numberOfPairsOfDataPoints: 8,
        reserved: null
      }
    },
    format: 0,
    input: [
      '2023-09-25T18:06:16.632Z,7,126720,35,100,8,c0,24,87,98,29,08,17,00',
      '2023-09-25T18:06:16.636Z,7,126720,35,100,8,c1,33,00,4f,00,67,00,b3',
      '2023-09-25T18:06:16.639Z,7,126720,35,100,8,c2,00,ce,00,0a,01,35,01',
      '2023-09-25T18:06:16.641Z,7,126720,35,100,8,c3,54,01,9c,01,be,01,69',
      '2023-09-25T18:06:16.645Z,7,126720,35,100,8,c4,02,df,01,d0,02,f3,01',
      '2023-09-25T18:06:16.648Z,7,126720,35,100,8,c5,37,03,ff,ff,ff,ff,ff'
    ]
  }
]
