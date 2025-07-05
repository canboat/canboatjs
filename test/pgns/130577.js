module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.468Z',
      prio: 3,
      src: 3,
      dst: 255,
      pgn: 130577,
      description: 'Direction Data',
      fields: {
        dataMode: 'Autonomous',
        cogReference: 'True',
        sid: 156,
        cog: 2.0961,
        sog: 2.46,
        set: 2.0914,
        drift: 2.45,
        reserved: null,
        heading: null,
        speedThroughWater: null
      }
    },
    input:
      '2017-04-15T14:57:58.468Z,3,130577,3,255,14,c0,9c,e1,51,f6,00,ff,ff,ff,ff,b2,51,f5,00'
  }
]
