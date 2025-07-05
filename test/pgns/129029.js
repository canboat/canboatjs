module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.470Z',
      prio: 3,
      src: 3,
      dst: 255,
      pgn: 129029,
      description: 'GNSS Position Data',
      fields: {
        list: [],
        sid: 155,
        date: '2017.04.15',
        time: '14:57:56.89500',
        latitude: 39.0700875,
        longitude: -76.4640319,
        gnssType: 'GPS+SBAS/WAAS',
        method: 'DGNSS fix',
        integrity: 'No integrity checking',
        numberOfSvs: 18,
        hdop: 0.65,
        referenceStations: 0,
        reserved: null,
        altitude: null,
        geoidalSeparation: null,
        pdop: null
      }
    },
    input:
      '2017-04-15T14:57:58.470Z,3,129029,3,255,43,9b,77,43,36,f6,1c,20,00,2e,cf,33,60,0c,6c,05,ff,49,10,5d,ae,73,63,f5,ff,ff,ff,ff,ff,ff,ff,7f,23,fc,12,41,00,ff,7f,ff,ff,ff,7f,00'
  },
  {
    expected: {
      canId: 234358051,
      prio: 3,
      src: 35,
      dst: 255,
      pgn: 129029,
      fields: {
        list: [],
        sid: 126,
        date: '2020.03.09',
        time: '17:47:47.80000',
        latitude: 42.4913166,
        longitude: -70.8850733,
        altitude: 41.4,
        gnssType: 'GPS+SBAS/WAAS',
        method: 'DGNSS fix',
        integrity: 'No integrity checking',
        numberOfSvs: 10,
        hdop: 0.9,
        pdop: 1.6,
        geoidalSeparation: -30.9,
        referenceStations: 0,
        reserved: null
      },
      description: 'GNSS Position Data'
    },
    format: 0,
    input: [
      'can0  0DF80523   [8]  C0 2B 7E 9A 47 70 F8 2F',
      'can0  0DF80523   [8]  C1 26 00 0C D1 EF 45 98',
      'can0  0DF80523   [8]  C2 E5 05 00 7E C2 94 03',
      'can0  0DF80523   [8]  C3 A8 29 F6 C0 B6 77 02',
      'can0  0DF80523   [8]  C4 00 00 00 00 23 FC 0A',
      'can0  0DF80523   [8]  C5 5A 00 A0 00 EE F3 FF',
      'can0  0DF80523   [8]  C6 FF 00 FF FF FF FF FF'
    ]
  },
  {
    expected: {
      prio: 3,
      pgn: 129029,
      dst: 255,
      src: 5,
      timestamp: '2023-07-22T15:25:03.923Z',
      fields: {
        list: [],
        date: '2023.07.22',
        gnssType: 'GPS+SBAS/WAAS+GLONASS',
        method: 'GNSS fix',
        integrity: 'No integrity checking',
        numberOfSvs: 0,
        referenceStations: 0,
        altitude: null,
        geoidalSeparation: null,
        hdop: null,
        pdop: null,
        reserved: null,
        sid: null,
        longitude: null,
        latitude: null
      },
      description: 'GNSS Position Data'
    },
    input:
      '2023-07-22T15:25:03.923Z,3,129029,5,255,43,ff,68,4c,fe,ff,ff,ff,fe,ff,ff,ff,ff,ff,ff,7f,fe,ff,ff,ff,ff,ff,ff,7f,fe,ff,ff,ff,ff,ff,ff,7f,14,fc,00,fe,7f,fe,7f,fe,ff,ff,7f,00',
    skipEncoderTest: true
  }
]
