module.exports = [
  {
    expected: {
      timestamp: '2019-04-15T15:12:21.553Z',
      prio: 4,
      pgn: 129038,
      src: 43,
      dst: 255,
      fields: {
        messageId: 'Scheduled Class A position report',
        repeatIndicator: 'Initial',
        userId: 367306490,
        longitude: -76.5379949,
        latitude: 39.241965,
        positionAccuracy: 'Low',
        raim: 'not in use',
        timeStamp: '22',
        cog: 5.4297,
        sog: 1.95,
        communicationState: 2257,
        aisTransceiverInformation: 'Channel B VDL reception',
        specialManeuverIndicator: 'Not available',
        reserved: 0,
        spare18: 0,
        reserved19: 0,
        sequenceId: null,
        rateOfTurn: null,
        navStatus: null,
        heading: null
      },
      description: 'AIS Class A Position Report'
    },
    input:
      '2019-04-15T15:12:21.553Z,4,129038,43,255,28,01,fa,a6,e4,15,93,3a,61,d2,42,d9,63,17,58,19,d4,c3,00,d1,08,08,ff,ff,ff,7f,0f,00,ff'
  }
]
