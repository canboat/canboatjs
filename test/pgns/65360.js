module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:58.468Z',
      prio: 7,
      src: 204,
      dst: 255,
      pgn: 65360,
      description: 'Seatalk: Pilot Locked Heading',
      fields: {
        manufacturerCode: 'Raymarine',
        industryCode: 'Marine Industry',
        targetHeadingMagnetic: 2.4599,
        reserved: null,
        reserved7: null,
        sid: null,
        targetHeadingTrue: null
      }
    },
    input: '2017-04-15T14:57:58.468Z,7,65360,204,255,8,3b,9f,ff,ff,ff,17,60,ff'
  }
]
