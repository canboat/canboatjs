module.exports = [
  {
    expected: {
      timestamp: '2017-04-15T14:58:08.982Z',
      prio: 6,
      src: 44,
      dst: 172,
      pgn: 60928,
      description: 'ISO Address Claim',
      fields: {
        uniqueNumber: 1072,
        manufacturerCode: 'Yacht Devices',
        deviceInstanceLower: 0,
        deviceInstanceUpper: 0,
        deviceFunction: 130,
        deviceClass: 'Sensor Communication Interface',
        systemInstance: 0,
        industryGroup: 'Marine Industry',
        spare: 1,
        arbitraryAddressCapable: 'Yes'
      }
    },
    input: '2017-04-15T14:58:08.982Z,6,60928,44,172,8,30,04,a0,59,00,82,97,c0'
  },
  {
    expected: {
      timestamp: '2026-01-01T00:00:00.000Z',
      prio: 6,
      src: 7,
      dst: 255,
      pgn: 60928,
      description: 'ISO Address Claim',
      fields: {
        uniqueNumber: 2838,
        manufacturerCode: 'Furuno',
        deviceInstanceLower: 7,
        deviceInstanceUpper: 0,
        deviceFunction: 190,
        deviceClass: 'Communication',
        systemInstance: 0,
        industryGroup: 'Marine Industry',
        spare: 0,
        arbitraryAddressCapable: 'Yes'
      }
    },
    input: '2026-01-01T00:00:00.000Z,6,60928,7,255,8,16,0b,e0,e7,07,be,8c,c0'
  }
]
