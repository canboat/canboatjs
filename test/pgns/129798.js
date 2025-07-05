module.exports = [
{
  expected: {
    prio: 4,
    pgn: 129798,
    dst: 255,
    src: 43,
    timestamp: '2023-07-22T13:43:31.021Z',
    fields: {
      messageId: 'Standard SAR aircraft position report',
      repeatIndicator: 'Initial',
      userId: 338254269,
      longitude: -75.8338099,
      latitude: 39.6475617,
      positionAccuracy: 'High',
      raim: 'in use',
      timeStamp: '10',
      cog: 2.227,
      sog: 694.4,
      communicationState: 33188,
      aisTransceiverInformation: 'Channel A VDL reception',
      altitude: 796,
      reservedForRegionalApplications: 0,
      dte: 'Not available',
      reserved17: 0,
      spare: 0
    },
    description: 'AIS SAR Aircraft Position Report'
  },
  input: '2023-07-22T13:43:31.021Z,4,129798,43,255,27,09,bd,59,29,14,cd,ad,cc,d2,e1,bc,a1,17,2b,fe,56,20,1b,a4,81,00,f0,36,01,00,00,01'
}
,
]
