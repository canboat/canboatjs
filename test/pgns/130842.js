module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T15:00:51.300Z',
      prio: 6,
      src: 43,
      dst: 255,
      pgn: 130842,
      description: 'Simnet: AIS Class B static data (msg 24 Part A)',
      fields: {
        manufacturerCode: 'Simrad',
        industryCode: 'Marine Industry',
        messageId: 'Msg 24 Part A',
        repeatIndicator: 'Second retransmission',
        e: 24,
        userId: 338184312,
        name: 'WILHELM',
        d: null,
        reserved: null
      }
    },
    input:
      '2017-04-15T15:00:51.300Z,6,130842,43,255,29,41,9f,80,ff,18,78,48,28,14,57,49,4c,48,45,4c,4d,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff,ff'
  }
]
