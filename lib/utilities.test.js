const { byteString, getPlainPGNs } = require('./utilities')

describe('byteString', () => {
  test('Buffer to string', () => {
    const data = Buffer.from('00ff7f520021feff', 'hex')
    expect(byteString(data)).toEqual('00,ff,7f,52,00,21,fe,ff')
  })
})

describe('getPlainPGNs', () => {
  const data = Buffer.from('000102030405060708090a0b0c0d', 'hex')
  // The first byte of each frame: sequence counter, frame counter.
  const counters = (frames) => frames.map((f) => [f[0] >> 5, f[0] & 0x1f])

  test('splits a message into a first frame of 6 bytes, then 7 each', () => {
    expect(getPlainPGNs(data, 126996, 1).map((f) => f.toString('hex'))).toEqual(
      ['000e000102030405', '01060708090a0b0c', '020dffffffffffff']
    )
  })

  test('consecutive messages get sequence counters 0 to 7, then 0 again', () => {
    const sequences = []
    for (let i = 0; i < 10; i++) {
      sequences.push(counters(getPlainPGNs(data, 129029, 2))[0][0])
    }
    expect(sequences).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1])
  })

  test('every frame of a message has its sequence counter', () => {
    getPlainPGNs(data, 126464, 3)
    expect(counters(getPlainPGNs(data, 126464, 3))).toEqual([
      [1, 0],
      [1, 1],
      [1, 2]
    ])
  })

  test('each PGN and source counts on its own', () => {
    getPlainPGNs(data, 130820, 4)
    getPlainPGNs(data, 130820, 4)
    expect(counters(getPlainPGNs(data, 130820, 4))[0][0]).toBe(2)
    expect(counters(getPlainPGNs(data, 130820, 5))[0][0]).toBe(0)
    expect(counters(getPlainPGNs(data, 130821, 4))[0][0]).toBe(0)
  })
})
