module.exports = [
  {
    expected: {
      timestamp: '2016-02-28T19:57:03.931Z',
      prio: 2,
      src: 24,
      dst: 255,
      pgn: 130824,
      description: 'Maretron: Annunciator',
      fields: {
        manufacturerCode: 'Maretron',
        industryCode: 'Marine Industry',
        annunciatorInstance: 0,
        annunciatorState: 0,
        reserved: null,
        pattern: null,
        field7: null,
        alertId: null
      }
    },
    input:
      '2016-02-28T19:57:03.931Z,2,130824,24,255,9,89,98,00,00,ff,ff,ff,ff,ff'
  }
]
