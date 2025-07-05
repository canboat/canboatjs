module.exports = [
  {
    expected: {
      timestamp: '2019-04-15T15:13:37.159Z',
      prio: 4,
      pgn: 129041,
      src: 43,
      dst: 255,
      fields: {
        messageId: 'ATON report',
        repeatIndicator: 'Initial',
        userId: 993672312,
        longitude: -76.5295832,
        latitude: 39.2160667,
        positionAccuracy: 'High',
        raim: 'not in use',
        timeStamp: 'Manual input mode',
        atonType: 'Fixed beacon: port hand',
        offPositionIndicator: 'No',
        virtualAtonFlag: 'Yes',
        assignedModeFlag: 'Autonomous and continuous',
        spare: 0,
        positionFixingDeviceType: 'Surveyed',
        reserved19: 0,
        atonStatus: 0,
        aisTransceiverInformation: 'Channel A VDL reception',
        reserved22: 0,
        atonName: 'SC',
        positionReferenceFromTrueNorthFacingEdge: null,
        positionReferenceFromStarboardEdge: null,
        lengthDiameter: null,
        beamDiameter: null
      },
      description: 'AIS Aids to Navigation (AtoN) Report'
    },
    input:
      '2019-04-15T15:13:37.159Z,4,129041,43,255,46,15,78,3c,3a,3b,28,83,62,d2,9b,e5,5f,17,f5,ff,ff,ff,ff,ff,ff,ff,ff,4d,0e,00,00,14,01,53,43,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20,20'
  }
]
