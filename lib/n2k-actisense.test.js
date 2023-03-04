const { readN2KActisense, encodeN2KActisense } = require('./n2k-actisense')


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


describe('encodeN2KActisense', () => {
  test('basic msg', () => {
    const expected = '1002d01500ff0501f80900000000000d474717e2da69d2001003'
    const pgn = {
      "data": Buffer.from('0d474717e2da69d2', 'hex'),
      "dst": 255,
      "pgn": 129025,
      "prio": 2,
      "src": 5,
    }

    const encoded = encodeN2KActisense(pgn)
    expect(encoded).toEqual(Buffer.from(expected, 'hex'))

    const read = readN2KActisense(encoded, false, {})
    delete read.pgn.timestamp
    
    expect(read).toEqual({
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


