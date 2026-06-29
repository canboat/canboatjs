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
        field4: 0,
        field5: 0,
        reserved: null,
        field6: null,
        field7: null,
        field8: null
      }
    },
    input:
      '2016-02-28T19:57:03.931Z,2,130824,24,255,9,89,98,00,00,ff,ff,ff,ff,ff'
  },
  {
    // B&G "key-value data" is a repeating field set of
    // {key (DYNAMIC_FIELD_KEY), length (DYNAMIC_FIELD_LENGTH), value
    // (DYNAMIC_FIELD_VALUE)} triplets. The value's bit length is carried by the
    // sibling length field, so it must be resolved from the current repetition's
    // accumulated fields, not the top-level pgn.fields. This exercises decoding
    // the value of each list entry (Target Boat Speed = 80, Polar Performance =
    // 100); previously the value was dropped and the list de-synced.
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
          { key: 'Target Boat Speed', length: 2, value: 80 },
          { key: 'Polar Performance', length: 2, value: 100 }
        ]
      }
    },
    input:
      '2024-01-01T12:00:00.000Z,7,130824,16,255,10,7d,99,7d,20,50,00,7c,20,64,00',
    skipEncoderTest: true
  }
]
