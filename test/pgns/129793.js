module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:58:00.590Z',
      prio: 7,
      src: 43,
      dst: 255,
      pgn: 129793,
      description: 'AIS UTC and Date Report',
      fields: {
        messageId: 'Base station report',
        repeatIndicator: 'Initial',
        userId: 3660611,
        longitude: -76.4541382,
        latitude: 38.97897,
        positionAccuracy: 'High',
        raim: 'in use',
        positionTime: '14:58:00',
        communicationState: 82201,
        aisTransceiverInformation: 'Channel A VDL reception',
        positionDate: '2017.04.15',
        reserved: null,
        reserved13: null,
        gnssType: null
      }
    },
    input:
      '2017-04-15T14:58:00.590Z,7,129793,43,255,24,04,43,db,37,00,3a,06,6e,d2,04,b8,3b,17,ff,80,6f,1d,20,19,41,01,77,43,ff'
  }
]
