module.exports = [
{
  expected: {
    timestamp: '2017-04-15T14:57:58.469Z',
    prio: 6,
    src: 3,
    dst: 255,
    pgn: 129540,
    description: 'GNSS Sats in View',
    fields: {
      list: [
        {
          prn: 3,
          elevation: 0.5585,
          azimuth: 5.3407,
          snr: 31,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 4,
          elevation: 1.0297,
          azimuth: 3.002,
          snr: 28,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 10,
          elevation: 0.1047,
          azimuth: 2.8972,
          snr: 28,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 14,
          elevation: 1.1519,
          azimuth: 1.5359,
          snr: 30,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 16,
          elevation: 0.4014,
          azimuth: 3.4383,
          snr: 33,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 22,
          elevation: 0.8029,
          azimuth: 4.8346,
          snr: 31,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 25,
          elevation: 0.4538,
          azimuth: 0.7679,
          snr: 33,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 26,
          elevation: 0.9076,
          azimuth: 3.2463,
          snr: 26,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 31,
          elevation: 1.2217,
          azimuth: 0.2269,
          snr: 31,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 67,
          elevation: 0.7505,
          azimuth: 2.7751,
          snr: 32,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 68,
          elevation: 1.309,
          azimuth: 5.2709,
          snr: 34,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 69,
          elevation: 0.4014,
          azimuth: 5.7072,
          snr: 26,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 77,
          elevation: 0.5934,
          azimuth: 0.6109,
          snr: 29,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 78,
          elevation: 1.2392,
          azimuth: 5.2011,
          snr: 27,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 79,
          elevation: 0.6632,
          azimuth: 4.2761,
          snr: 35,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 46,
          elevation: 0.6632,
          azimuth: 3.6826,
          snr: 30,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 48,
          elevation: 0.2967,
          azimuth: 4.311,
          snr: 29,
          rangeResiduals: 0,
          status: 'Used+Diff'
        },
        {
          prn: 51,
          elevation: 0.6109,
          azimuth: 3.9095,
          snr: 35,
          rangeResiduals: 0,
          status: 'Used+Diff'
        }
      ],
      sid: 184,
      satsInView: 18,
      reserved: null,
      rangeResidualMode: null
    }
  },
  input: '2017-04-15T14:57:58.469Z,6,129540,3,255,219,b8,ff,12,03,d1,15,9f,d0,1c,0c,00,00,00,00,f5,04,39,28,44,75,f0,0a,00,00,00,00,f5,0a,17,04,2c,71,f0,0a,00,00,00,00,f5,0e,ff,2c,ff,3b,b8,0b,00,00,00,00,f5,10,ae,0f,4f,86,e4,0c,00,00,00,00,f5,16,5d,1f,da,bc,1c,0c,00,00,00,00,f5,19,ba,11,ff,1d,e4,0c,00,00,00,00,f5,1a,74,23,cf,7e,28,0a,00,00,00,00,f5,1f,b9,2f,dd,08,1c,0c,00,00,00,00,f5,43,51,1d,67,6c,80,0c,00,00,00,00,f5,44,22,33,e5,cd,48,0d,00,00,00,00,f5,45,ae,0f,f0,de,28,0a,00,00,00,00,f5,4d,2e,17,dd,17,54,0b,00,00,00,00,f5,4e,68,30,2b,cb,8c,0a,00,00,00,00,f5,4f,e8,19,09,a7,ac,0d,00,00,00,00,f5,2e,e8,19,da,8f,b8,0b,00,00,00,00,f5,30,97,0b,66,a8,54,0b,00,00,00,00,f5,33,dd,17,b7,98,ac,0d,00,00,00,00,f5'
}
,
{
  expected: {
    prio: 6,
    pgn: 129540,
    dst: 255,
    src: 1,
    timestamp: '2020-08-16T09:00:00.364Z',
    fields: {
      list: [
        {
          prn: 7,
          elevation: 0.2443,
          azimuth: 5.6199,
          snr: 33,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 10,
          elevation: 0.6632,
          azimuth: 3.0543,
          snr: 35,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 13,
          elevation: 0.3141,
          azimuth: 0.5934,
          snr: 37,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 15,
          elevation: 0.4363,
          azimuth: 1.1693,
          snr: 39,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 16,
          elevation: 0.8028,
          azimuth: 4.0142,
          snr: 31,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 18,
          elevation: 0.8203,
          azimuth: 1.4311,
          snr: 32,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 20,
          elevation: 1.0471,
          azimuth: 2.3038,
          snr: 36,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 21,
          elevation: 0.9599,
          azimuth: 4.2935,
          snr: 28,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 26,
          elevation: 0.3316,
          azimuth: 3.4557,
          snr: 35,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 27,
          elevation: 1.0471,
          azimuth: 4.8869,
          snr: 35,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 8,
          elevation: 0.4886,
          azimuth: 5.1661,
          snr: 24,
          rangeResiduals: 0,
          status: 'Used'
        },
        {
          prn: 87,
          elevation: 1.2217,
          azimuth: 5.2359,
          snr: 28,
          rangeResiduals: 0,
          status: 'Used'
        }
      ],
      reserved: null,
      sid: 82,
      rangeResidualMode: 2,
      satsInView: 12
    },
    description: 'GNSS Sats in View'
  },
  format: 0,
  input: [
    '2020-08-16T09:00:00.333Z,6,129540,1,255,8,20,93,52,fe,0c,07,8b,09',
    '2020-08-16T09:00:00.334Z,6,129540,1,255,8,21,87,db,e4,0c,00,00,00',
    '2020-08-16T09:00:00.334Z,6,129540,1,255,8,22,00,f2,0a,e8,19,4f,77',
    '2020-08-16T09:00:00.335Z,6,129540,1,255,8,23,ac,0d,00,00,00,00,f2',
    '2020-08-16T09:00:00.335Z,6,129540,1,255,8,24,0d,45,0c,2e,17,74,0e',
    '2020-08-16T09:00:00.336Z,6,129540,1,255,8,25,00,00,00,00,f2,0f,0b',
    '2020-08-16T09:00:00.336Z,6,129540,1,255,8,26,11,ad,2d,3c,0f,00,00',
    '2020-08-16T09:00:00.337Z,6,129540,1,255,8,27,00,00,f2,10,5c,1f,ce',
    '2020-08-16T09:00:00.337Z,6,129540,1,255,8,28,9c,1c,0c,00,00,00,00',
    '2020-08-16T09:00:00.338Z,6,129540,1,255,8,29,f2,12,0b,20,e7,37,80',
    '2020-08-16T09:00:00.339Z,6,129540,1,255,8,2a,0c,00,00,00,00,f2,14',
    '2020-08-16T09:00:00.358Z,6,129540,1,255,8,2b,e7,28,fe,59,10,0e,00',
    '2020-08-16T09:00:00.359Z,6,129540,1,255,8,2c,00,00,00,f2,15,7f,25',
    '2020-08-16T09:00:00.360Z,6,129540,1,255,8,2d,b7,a7,f0,0a,00,00,00',
    '2020-08-16T09:00:00.360Z,6,129540,1,255,8,2e,00,f2,1a,f4,0c,fd,86',
    '2020-08-16T09:00:00.361Z,6,129540,1,255,8,2f,ac,0d,00,00,00,00,f2',
    '2020-08-16T09:00:00.361Z,6,129540,1,255,8,30,1b,e7,28,e5,be,ac,0d',
    '2020-08-16T09:00:00.361Z,6,129540,1,255,8,31,00,00,00,00,f2,08,16',
    '2020-08-16T09:00:00.362Z,6,129540,1,255,8,32,13,cd,c9,60,09,00,00',
    '2020-08-16T09:00:00.363Z,6,129540,1,255,8,33,00,00,f2,57,b9,2f,87',
    '2020-08-16T09:00:00.363Z,6,129540,1,255,8,34,cc,f0,0a,00,00,00,00',
    '2020-08-16T09:00:00.364Z,6,129540,1,255,8,35,f2,ff,ff,ff,ff,ff,ff'
  ]
}
,
]
