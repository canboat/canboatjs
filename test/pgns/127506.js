module.exports = [
  {
    expected: {
      timestamp: '2023-04-01T17:28:01.128Z',
      prio: 2,
      src: 60,
      dst: 255,
      pgn: 127506,
      description: 'DC Detailed Status',
      fields: {
        Instance: 3,
        'State of Charge': 100,
        'Time Remaining': '00:20:00',
        'DC Type': null,
        'Remaining capacity': null,
        'Ripple Voltage': null,
        SID: null,
        'State of Health': null
      }
    },
    input:
      '2023-04-01T17:28:01.128Z,2,127506,60,255,11,ff,03,ff,64,ff,14,00,ff,ff,ff,ff'
    //"2016-02-28T19:57:02.829Z,6,127506,60,255,11,ff,03,ff,64,ff,ff,ff,ff,ff,ff,ff"
  }
]
