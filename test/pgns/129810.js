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
      userId: 338254261,
      typeOfShip: 'Pleasure',
      vendorId: 'GARMIN',
      length: 14,
      beam: 27,
      positionReferenceFromStarboard: 25,
      positionReferenceFromBow: 6,
      mothershipUserId: 338254262,
      reserved: 0,
      spare13: 0,
      aisTransceiverInformation: 'Channel B VDL reception',
      reserved16: 0,
      sequenceId: null,
      gnssType: 'GLONASS'
    },
    description: 'AIS Class B static data (msg 24 Part B)'
  },
  input: '2023-07-22T13:41:17.102Z,6,129810,43,255,35,18,b5,59,29,14,25,47,41,52,4d,49,4e,ff,40,40,40,40,40,40,40,8c,00,0e,01,fa,00,3c,00,b6,59,29,14,20,01,ff'
}
,
]
