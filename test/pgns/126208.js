module.exports = [
{
  expected: {
    prio: 2,
    pgn: 126208,
    dst: 67,
    src: 0,
    timestamp: '2020-04-19T00:35:55.571Z',
    fields: {
      list: [ { parameter: 2, value: 'YD:VOLUME 60' } ],
      functionCode: 'Command',
      pgn: 126998,
      numberOfParameters: 1,
      priority: null,
      reserved: null
    },
    description: 'NMEA - Command group function'
  },
  input: '2020-04-19T00:35:55.571Z,2,126208,0,67,21,01,16,f0,01,ff,01,02,0e,01,59,44,3a,56,4f,4c,55,4d,45,20,36,30'
}
,
{
  expected: {
    pgn: 126208,
    description: 'NMEA - Command group function',
    dst: 35,
    prio: 3,
    src: 0,
    fields: {
      list: [
        { parameter: 1, value: 135 },
        { parameter: 3, value: 4 },
        { parameter: 4, value: 41 },
        { parameter: 5, value: 8 },
        { parameter: 6, value: 16 },
        { parameter: 7, value: 51 },
        { parameter: 8, value: 70 },
        { parameter: 9, value: 102 },
        { parameter: 10, value: 163 },
        { parameter: 11, value: 205 },
        { parameter: 12, value: 236 },
        { parameter: 13, value: 308 },
        { parameter: 14, value: 290 },
        { parameter: 15, value: 411 },
        { parameter: 16, value: 340 },
        { parameter: 17, value: 617 },
        { parameter: 18, value: 336 },
        { parameter: 19, value: 7.2 },
        { parameter: 20, value: 312 },
        { parameter: 21, value: 8.23 }
      ],
      functionCode: 'Command',
      pgn: 126720,
      priority: 'Leave unchanged',
      numberOfParameters: 20,
      reserved: null
    }
  },
  input: '2023-09-25T00:20:09.551Z,3,126208,0,35,63,01,00,ef,01,f8,14,01,87,00,03,04,04,29,05,08,06,a0,00,07,ec,13,08,bc,02,09,d8,27,0a,5e,06,0b,14,50,0c,38,09,0d,50,78,0e,54,0b,0f,8c,a0,10,48,0d,11,04,f1,12,20,0d,13,d0,02,14,30,0c,15,37,03'
}
,
]
