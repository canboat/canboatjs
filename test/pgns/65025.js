module.exports = [
  {
    expected: {
      timestamp: '2016-02-28T19:57:02.826Z',
      prio: 3,
      src: 196,
      dst: 255,
      pgn: 65025,
      description: 'Generator Phase A AC Reactive Power',
      fields: {
        'Reactive Power': 38170,
        'Power Factor Lagging': 'Leading',
        'Power Factor Lagging': 'Lagging',
        'Power factor': 1.89844,
        Reserved1: null,
        'Reactive Power': 282
      }
    },
    input: '2016-02-28T19:57:02.826Z,3,65025,196,255,8,1a,95,35,77,80,79,fd,ff',

    disabled: false
  }
]
