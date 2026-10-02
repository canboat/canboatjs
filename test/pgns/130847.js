module.exports = [
  {
    // Navico ends its ASCII Identifier with a newline. canboat trims the
    // whole C isspace() set off a string, so the newline goes too.
    expected: {
      timestamp: '2026-06-08T02:26:09.104Z',
      prio: 7,
      pgn: 130847,
      src: 21,
      dst: 255,
      fields: {
        manufacturerCode: 'Navico',
        reserved: null,
        industryCode: 'Marine Industry',
        identifier: '107473373'
      },
      description: 'Navico: ASCII Identifier'
    },
    input:
      '2026-06-08T02:26:09.104Z,7,130847,21,255,13,13,99,0a,31,30,37,34,37,33,33,37,33,0a',
    // Re-encoding drops the newline the device sent.
    skipEncoderTest: true
  }
]
