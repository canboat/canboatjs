module.exports = [
  {
    expected: {
      prio: 2,
      pgn: 126208,
      dst: 67,
      src: 0,
      timestamp: '2020-04-19T00:35:55.571Z',
      fields: {
        'Function Code': 'Command',
        PGN: 126998,
        'Number of Parameters': 1,
        Priority: null,
        Reserved1: null,
        list: [{ Parameter: 2, Value: 'YD:VOLUME 60' }]
      },
      description: 'NMEA - Command group function'
    },
    input:
      '2020-04-19T00:35:55.571Z,2,126208,0,67,21,01,16,f0,01,ff,01,02,0e,01,59,44,3a,56,4f,4c,55,4d,45,20,36,30'
  },
  {
    expected: {
      pgn: 126208,
      description: 'NMEA - Command group function',
      dst: 35,
      prio: 3,
      src: 0,
      fields: {
        'Function Code': 'Command',
        PGN: 126720,
        Priority: 'Leave unchanged',
        'Number of Parameters': 20,
        Reserved1: null,
        list: [
          { Parameter: 1, Value: 135 },
          { Parameter: 3, Value: 4 },
          { Parameter: 4, Value: 41 },
          { Parameter: 5, Value: 8 },
          { Parameter: 6, Value: 16 },
          { Parameter: 7, Value: 51 },
          { Parameter: 8, Value: 70 },
          { Parameter: 9, Value: 102 },
          { Parameter: 10, Value: 163 },
          { Parameter: 11, Value: 205 },
          { Parameter: 12, Value: 236 },
          { Parameter: 13, Value: 308 },
          { Parameter: 14, Value: 290 },
          { Parameter: 15, Value: 411 },
          { Parameter: 16, Value: 340 },
          { Parameter: 17, Value: 617 },
          { Parameter: 18, Value: 336 },
          { Parameter: 19, Value: 7.2 },
          { Parameter: 20, Value: 312 },
          { Parameter: 21, Value: 8.23 }
        ]
      }
    },
    input:
      '2023-09-25T00:20:09.551Z,3,126208,0,35,63,01,00,ef,01,f8,14,01,87,00,03,04,04,29,05,08,06,a0,00,07,ec,13,08,bc,02,09,d8,27,0a,5e,06,0b,14,50,0c,38,09,0d,50,78,0e,54,0b,0f,8c,a0,10,48,0d,11,04,f1,12,20,0d,13,d0,02,14,30,0c,15,37,03'
  }
]
