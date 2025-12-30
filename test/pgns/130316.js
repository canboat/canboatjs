module.exports = [
  {
    expected: {
      canId: 167578727,
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
    input: 'can0  09fd0c67   [8]  ff 65 01 32 4c 04 ff ff'
  },
  {
    expected: {
      canId: 167578727,
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
    input: 'can0  09fd0c67   [8]  ff 65 01 ff ff ff ff ff'
  }
]
