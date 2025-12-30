module.exports = [
  {
    expected: {
      prio: 2,
      src: 103,
      dst: 255,
      pgn: 130316,
      description: 'Temperature Extended Range',
      fields: {
        sid: null,
        instance: 101,
        source: 'Outside Temperature',
        temperature: 281.65,
        setTemperature: null
      }
    },
    input: '2025-12-30T20:41:29.053Z,2,130316,103,255,8,ff,65,01,32,4c,04,ff,ff'
  },
  {
    expected: {
      prio: 2,
      src: 103,
      dst: 255,
      pgn: 130316,
      description: 'Temperature Extended Range',
      fields: {
        sid: null,
        instance: 101,
        source: 'Outside Temperature',
        temperature: null,
        setTemperature: null
      }
    },
    input: '2025-12-30T20:42:41.056Z,2,130316,103,255,8,ff,65,01,ff,ff,ff,ff,ff'
  }
]
