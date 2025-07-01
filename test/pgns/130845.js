module.exports = [
  {
    expected: {
      timestamp: '2023-09-20T14:11:11.577Z',
      prio: 3,
      src: 2,
      dst: 255,
      pgn: 130845,
      description: 'Simnet: Key Value',
      fields: {
        'Manufacturer Code': 'Simrad',
        'Industry Code': 'Marine Industry',
        'Display Group': 'Default',
        Key: 'Backlight level',
        MinLength: 1,
        Value: 88,
        Spare: 0,
        Address: null,
        'Repeat Indicator': null,
        Reserved1: null,
        Reserved2: null
      }
    },
    input:
      '2023-09-20T14:11:11.577Z,3,130845,2,255,11,41,9f,ff,ff,01,ff,ff,12,00,01,58'
  },
  {
    expected: {
      timestamp: '2023-09-20T14:11:11.577Z',
      prio: 3,
      src: 2,
      dst: 255,
      pgn: 130845,
      description: 'Simnet: Key Value',
      fields: {
        manufacturerCode: 'Simrad',
        industryCode: 'Marine Industry',
        displayGroup: 'Default',
        key: 'Backlight level',
        minlength: 1,
        value: 88,
        spare9: 0,
        address: null,
        repeatIndicator: null,
        reserved: null,
        reserved7: null
      }
    },
    input:
      '2023-09-20T14:11:11.577Z,3,130845,2,255,11,41,9f,ff,ff,01,ff,ff,12,00,01,58',
    useCamel: true
  }
]
