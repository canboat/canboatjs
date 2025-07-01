module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.469Z',
      prio: 2,
      src: 35,
      dst: 255,
      pgn: 128259,
      description: 'Speed',
      fields: {
        SID: 20,
        'Speed Water Referenced': 0.0,
        'Speed Water Referenced Type': 'Paddle wheel',
        Reserved1: null,
        'Speed Direction': null,
        'Speed Ground Referenced': null
      }
    },
    input: '2017-04-15T14:57:58.469Z,2,128259,35,255,8,14,00,00,ff,ff,00,ff,ff'
  }
]
