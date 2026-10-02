module.exports = [
  {
    expected: {
      timestamp: '2023-07-22T13:41:17.102Z',
      prio: 6,
      pgn: 129810,
      src: 43,
      dst: 255,
      fields: {
        messageId: 'Static data report',
        repeatIndicator: 'Initial',
        userId: '338254261',
        typeOfShip: 'Pleasure',
        vendorId: 'GARMIN',
        callsign: null,
        length: 14,
        beam: 27,
        positionReferenceFromStarboard: 25,
        positionReferenceFromBow: 6,
        mothershipUserId: '338254262',
        reserved: 0,
        spare13: 0,
        aisTransceiverInformation: 'Channel B VDL reception',
        reserved16: 0,
        sequenceId: null,
        gnssType: 'GLONASS'
      },
      description: 'AIS Class B static data (msg 24 Part B)'
    },
    input:
      '2023-07-22T13:41:17.102Z,6,129810,43,255,35,18,b5,59,29,14,25,47,41,52,4d,49,4e,ff,40,40,40,40,40,40,40,8c,00,0e,01,fa,00,3c,00,b6,59,29,14,20,01,ff'
  },
  {
    // A Class B unit with no mothership (canboat samples/ikonvert.log): it sends
    // MMSI 0, which is no station's MMSI, so the field is not available, as
    // canboat decodes it. Re-encoded, not available is 0xffffffff.
    expected: {
      prio: 6,
      pgn: 129810,
      dst: 255,
      src: 43,
      timestamp: '2022-11-30T12:00:00.000Z',
      fields: {
        messageId: 'Static data report',
        repeatIndicator: 'Initial',
        userId: '235116174',
        typeOfShip: 'Sailing',
        vendorId: 'NVCGJW7',
        callsign: '2JIK9',
        length: 12,
        beam: 4,
        positionReferenceFromStarboard: 4,
        positionReferenceFromBow: 6,
        mothershipUserId: null,
        reserved: 0,
        spare13: 0,
        gnssType: 'Default: undefined',
        aisTransceiverInformation: 'Channel A VDL reception',
        reserved16: 0,
        sequenceId: null
      },
      description: 'AIS Class B static data (msg 24 Part B)'
    },
    input:
      '2022-11-30T12:00:00.000Z,6,129810,43,255,35,18,8e,96,03,0e,24,4e,56,43,47,4a,57,37,32,4a,49,4b,39,40,40,78,00,28,00,28,00,3c,00,00,00,00,00,00,00,ff',
    encoded:
      '2022-11-30T12:00:00.000Z,6,129810,43,255,35,18,8e,96,03,0e,24,4e,56,43,47,4a,57,37,32,4a,49,4b,39,ff,ff,78,00,28,00,28,00,3c,00,ff,ff,ff,ff,00,00,ff'
  }
]
