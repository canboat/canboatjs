module.exports = [
  {
    expected: {
      timestamp: '2024-08-02T13:42:25.815Z',
      prio: 7,
      src: 204,
      dst: 255,
      pgn: 65379,
      description: 'Seatalk: Pilot Mode',
      fields: {
        manufacturerCode: 'Raymarine',
        industryCode: 'Marine Industry',
        pilotMode: 'Auto, compass commanded',
        subMode: 0,
        pilotModeData: 0,
        reserved7: null,
        reserved: null
      }
    },
    input: '2024-08-02T13:42:25.815Z,7,65379,204,255,8,3b,9f,40,00,00,00,00,ff'
  }
]
