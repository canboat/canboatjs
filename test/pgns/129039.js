module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:57:59.409Z',
      prio: 4,
      src: 43,
      dst: 255,
      pgn: 129039,
      description: 'AIS Class B Position Report',
      fields: {
        messageId: 'Standard Class B position report',
        repeatIndicator: 'Initial',
        userId: 338184312,
        longitude: -76.4640032,
        latitude: 39.0700267,
        positionAccuracy: 'High',
        raim: 'in use',
        timeStamp: '59',
        cog: 2.1206,
        sog: 2.46,
        communicationState: 393222,
        aisTransceiverInformation: 'Own information not broadcast',
        regionalApplication: 0,
        regionalApplicationB: 0,
        unitType: 'CS',
        integratedDisplay: 'No',
        dsc: 'Yes',
        band: 'Entire marine band',
        canHandleMsg22: 'Yes',
        aisMode: 'Autonomous',
        aisCommunicationState: 'ITDMA',
        reserved: null,
        heading: null
      }
    },
    input:
      '2017-04-15T14:57:59.409Z,4,129039,43,255,27,12,78,48,28,14,e0,84,6c,d2,eb,9c,49,17,ef,d6,52,f6,00,06,00,26,ff,ff,00,74,ff,ff'
  }
]
