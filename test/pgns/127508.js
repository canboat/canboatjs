module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.473Z',
      prio: 6,
      src: 17,
      dst: 255,
      pgn: 127508,
      description: 'Battery Status',
      fields: {
        instance: 1,
        voltage: 14.62,
        sid: 0,
        current: null,
        temperature: null
      }
    },
    input: '2017-04-15T14:57:58.473Z,6,127508,17,255,8,01,b6,05,ff,7f,ff,ff,00'
  }
]
