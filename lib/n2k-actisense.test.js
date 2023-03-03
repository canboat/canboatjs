const { readN2KActisense } = require('./n2k-actisense')


describe('readN2KActisense', () => {
  test('basic msg', () => {
    const buffer = Buffer.from('1002d01500ff0502f809004c86fe00fffccba56800ffff7310031002d01500ff0501f809004c86fe000d474717e2da69d29c1003', 'hex')
    const res = readN2KActisense(buffer, false, {})
    delete res.pgn.timestamp
    expect(res).toEqual({
      "coalesced": true,
      "data": Buffer.from('0d474717e2da69d2', 'hex'),
      "length": 8,
      "pgn": {
        "canId": 167248133,
        "dst": 255,
        "pgn": 129025,
        "prio": 2,
        "src": 5,
      }
    })
  })
})
