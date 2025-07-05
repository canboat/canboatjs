module.exports = [
  {
    expected: {
      timestamp: '2016-02-28T19:57:03.277Z',
      prio: 3,
      src: 193,
      dst: 255,
      pgn: 65012,
      description: 'Utility Phase A AC Reactive Power',
      fields: {
        reactivePower: -6,
        powerFactorLagging: 'Leading',
        powerFactor: 2,
        reserved: null
      }
    },
    input: '2016-02-28T19:57:03.277Z,3,65012,193,255,8,fa,93,35,77,00,80,fc,ff'
  }
]
