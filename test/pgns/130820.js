module.exports = [
{
  expected: {
    timestamp: '2017-04-15T14:57:58.469Z',
    prio: 7,
    src: 10,
    dst: 255,
    pgn: 130820,
    description: 'Fusion: Power State',
    fields: {
      manufacturerCode: 'Fusion Electronics',
      industryCode: 'Marine Industry',
      messageId: 'Power',
      state: 'On',
      reserved: null
    }
  },
  input: '2017-04-15T14:57:58.469Z,7,130820,10,255,5,a3,99,20,80,01'
}
,
{
  expected: {
    prio: 7,
    pgn: 130820,
    dst: 255,
    src: 11,
    timestamp: '2023-03-30T18:28:03.510Z',
    fields: {
      manufacturerCode: 'Fusion Electronics',
      industryCode: 'Marine Industry',
      messageId: 'Source',
      flags: 197,
      sourceId: 1,
      currentSourceId: 11,
      source: 'FM',
      reserved: null,
      sourceType: 'FM'
    },
    description: 'Fusion: Source'
  },
  input: '2023-03-30T18:28:03.510Z,7,130820,11,255,12,a3,99,02,80,01,0b,01,c5,02,46,4d,00'
}
,
]
