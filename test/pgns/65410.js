module.exports = [
  {
    expected: {
      timestamp: '2016-02-28T19:57:02.828Z',
      prio: 7,
      src: 36,
      dst: 255,
      pgn: 65410,
      description: 'Airmar: Device Information',
      fields: {
        manufacturerCode: 'Airmar',
        industryCode: 'Marine Industry',
        sid: 46,
        internalDeviceTemperature: 317.59,
        supplyVoltage: 12.3,
        reserved: null,
        reserved7: null
      }
    },
    input: '2016-02-28T19:57:02.828Z,7,65410,36,255,8,87,98,2e,0f,7c,ce,04,ff'
  }
]
