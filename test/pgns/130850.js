module.exports = [
  {
    expected: {
      prio: 2,
      pgn: 130850,
      dst: 255,
      src: 5,
      timestamp: '2025-10-15T22:12:21.248Z',
      fields: {
        manufacturerCode: 'Simrad',
        reserved: null,
        industryCode: 'Marine Industry',
        address: 3,
        reserved5: null,
        proprietaryId: 'Autopilot',
        commandType: 'AP Command',
        event: 'No Drift mode',
        unknown: 0,
        reserved10: null,
        reserved11: null,
        reserved12: null
      },
      description: 'Simnet: Command AP NoDrift'
    },
    format: 0,
    input:
      '2025-10-15T22:12:21.248Z,2,130850,5,255,11,41,9f,03,ff,ff,0a,0c,00,ff,ff,ff'
  },
  {
    expected: {
      prio: 2,
      pgn: 130850,
      dst: 255,
      src: 5,
      timestamp: '2025-10-15T23:32:01.383Z',
      fields: {
        manufacturerCode: 'Simrad',
        reserved: null,
        industryCode: 'Marine Industry',
        address: 3,
        reserved5: null,
        proprietaryId: 'Autopilot',
        commandType: 'AP Command',
        event: 'Change course',
        unknown: 0,
        direction: 'Starboard',
        angle: 0.1745,
        reserved12: null
      },
      description: 'Simnet: Command AP Change Course'
    },
    format: 0,
    input:
      '2025-10-15T23:32:01.383Z,2,130850,5,255,12,41,9f,03,ff,ff,0a,1a,00,03,d1,06,ff'
  }
]
