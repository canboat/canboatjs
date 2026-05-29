module.exports = [
  {
    expected: {
      pgn: 127503,
      prio: 2,
      src: 0,
      dst: 255,
      timestamp: '2026-05-29T12:17:02.604Z',
      description: 'AC Input Status',
      fields: {
        instance: 0,
        numberOfLines: 1,
        list: [
          {
            line: 'Line 1',
            acceptability: 'Good',
            voltage: 121.02,
            current: 0.6,
            frequency: 60.31,
            breakerSize: 30,
            realPower: 4,
            reactivePower: 4,
            powerFactor: 1,
            reserved: null
          }
        ]
      },
    },

    input: '2026-05-29T12:17:02.604Z,2,127503,0,255,20,00,01,fc,46,2f,06,00,8f,17,2c,01,04,00,00,00,04,00,00,00,64'
  }
]
