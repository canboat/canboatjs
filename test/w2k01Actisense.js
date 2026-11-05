const chai = require('chai')
chai.Should()
const { EventEmitter } = require('events')
const { W2K01Stream } = require('../dist/w2k01')

// A W2K-1 (or PRO-NDC-1E2K) in Actisense format sends as well as receives
// (#511): output is BST-D0 in BDTP. The expected bytes are the ones a W2K-2
// put on the bus on 2026-11-05, seen there by an NGT-1.
describe('W2K-1 in Actisense format', function () {
  function setUp() {
    const app = new EventEmitter()
    app.setProviderStatus = () => {}
    app.setProviderError = () => {}
    const sent = []
    app.on('w2k-1-out', (buf) => sent.push(Buffer.from(buf).toString('hex')))
    let available = 0
    app.on('nmea2000OutAvailable', () => available++)
    const stream = new W2K01Stream(
      { app, providerId: 'w2k', outEvent: 'nmea2000out' },
      'actisense'
    )
    return { app, sent, stream, available: () => available }
  }

  it('writes an ISO request to one device as BST-D0', function () {
    const { app, sent } = setUp()
    app.emit('nmea2000JsonOut', {
      pgn: 59904,
      dst: 40,
      prio: 6,
      fields: { pgn: 126996 }
    })
    sent.should.deep.equal(['1002d0101000280028ea18080000000014f001c11003'])
  })

  it('stuffs a 0x10 in the data', function () {
    const { app, sent } = setUp()
    app.emit('nmea2000JsonOut', {
      pgn: 59904,
      dst: 40,
      prio: 6,
      fields: { pgn: 126992 }
    })
    // 10 f0 01, the 10 doubled
    sent.should.deep.equal(['1002d0101000280028ea1808000000001010f001c51003'])
  })

  it('writes a fast-packet PGN whole', function () {
    const { app, sent } = setUp()
    app.emit('nmea2000JsonOut', {
      pgn: 126208,
      dst: 40,
      prio: 3,
      fields: {
        functionCode: 'Request',
        pgn: 126998,
        numberOfParameters: 0,
        list: []
      }
    })
    sent.should.deep.equal([
      '1002d01800280028ed0d09000000000016f001ffffffffffff00c41003'
    ])
  })

  it('writes an Actisense string given on nmea2000out', function () {
    const { app, sent } = setUp()
    app.emit('nmea2000out', '2026-11-05T17:40:38.947Z,6,59904,0,40,3,14,f0,01')
    sent.should.have.length(1)
    sent[0].should.equal('1002d0101000280028ea18080000000014f001c11003')
  })

  it('says it can send once the gateway is heard from', function () {
    const { stream, available } = setUp()
    available().should.equal(0)
    stream.write(Buffer.alloc(0))
    available().should.equal(1)
    stream.write(Buffer.alloc(0))
    available().should.equal(1)
  })
})
