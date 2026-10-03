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
  },
  {
    // B&G "key-value data" is a repeating field set of
    // {key (DYNAMIC_FIELD_KEY), length (DYNAMIC_FIELD_LENGTH), value
    // (DYNAMIC_FIELD_VALUE)} triplets. Each value is sized by its own record's
    // length and decoded as its key's type: Target Boat Speed is 80 x 0.01 m/s,
    // Polar Performance 100 x 0.1 % = 0.1, as canboat decodes them. Previously the
    // value was dropped and the list de-synced.
    expected: {
      timestamp: '2024-01-01T12:00:00.000Z',
      prio: 7,
      src: 16,
      dst: 255,
      pgn: 130824,
      description: 'B&G: key-value data',
      fields: {
        manufacturerCode: 'B & G',
        reserved: null,
        industryCode: 'Marine Industry',
        list: [
          { key: 'Target Boat Speed', length: 2, value: 0.8 },
          { key: 'Polar Performance', length: 2, value: 0.1 }
        ]
      }
    },
    input:
      '2024-01-01T12:00:00.000Z,7,130824,16,255,10,7d,99,7d,20,50,00,7c,20,64,00'
  }
]
