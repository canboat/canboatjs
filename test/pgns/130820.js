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
  },
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
    input:
      '2023-03-30T18:28:03.510Z,7,130820,11,255,12,a3,99,02,80,01,0b,01,c5,02,46,4d,00'
  },
  {
    // Fusion MS-RA70N tuner (MS-NRX300): the RDS station name arrives in the
    // RDS G0 character set, not UTF-8 or Latin-1 -- 0x91 is U+00E4. The field
    // declares Encoding RDS_G0, so "Bohuslän" decodes as canboat does.
    expected: {
      timestamp: '2026-09-19T06:17:55.032Z',
      prio: 7,
      pgn: 130820,
      src: 12,
      dst: 255,
      fields: {
        manufacturerCode: 'Fusion Electronics',
        reserved: null,
        industryCode: 'Marine Industry',
        messageId: 'Tuner',
        sourceId: 'FM',
        scanning: 2,
        frequency: 107500000,
        signalStrength: 199,
        track: 'Bohuslän'
      },
      description: 'Fusion: Tuner'
    },
    format: 0,
    input: [
      '2026-09-19T06:17:55.030Z,7,130820,12,255,8,60,15,a3,99,0b,80,01,02',
      '2026-09-19T06:17:55.031Z,7,130820,12,255,8,61,e0,51,68,06,c7,08,42',
      '2026-09-19T06:17:55.032Z,7,130820,12,255,8,62,6f,68,75,73,6c,91,6e',
      '2026-09-19T06:17:55.032Z,7,130820,12,255,8,63,00,ff,ff,ff,ff,ff,ff'
    ]
  }
]
