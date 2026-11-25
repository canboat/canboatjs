const { expect } = require('chai')
const { EventEmitter } = require('events')
const { Ydgw02 } = require('../dist/index')

// Feed the provider's public event interface and inspect its transport output.
describe('Yacht Devices outgoing source address', function () {
  function gateway(device) {
    const app = new EventEmitter()
    const sent = []
    app.on('ydwg02-out', (message) => sent.push(message))
    const stream = new Ydgw02({ app, createDevice: !!device }, 'tcp')
    stream.device = device
    if (device) device.stop = () => {}
    stream.sentAvailable = true
    return { app, sent, stream }
  }

  function line(src, pgn = 129025, length = 8) {
    return `2026-11-25T12:00:00.000Z,2,${pgn},${src},255,${length},${Array(length).fill('01').join(',')}`
  }

  function sourceAddresses(sent) {
    return sent.flatMap((message) =>
      message
        .trim()
        .split('\r\n')
        .map(
          (frame) =>
            parseInt(frame.split(' ')[frame.includes(' R ') ? 2 : 0], 16) & 255
        )
    )
  }

  it('uses the claimed address for text messages and follows address changes', function () {
    const device = { address: 100, cansend: true }
    const g = gateway(device)
    try {
      g.app.emit('nmea2000out', line(0))
      device.address = 101
      g.app.emit('nmea2000out', line(0))
      expect(sourceAddresses(g.sent)).to.deep.equal([100, 101])
    } finally {
      g.stream.end()
    }
  })

  it('uses the claimed address in every fast-packet frame', function () {
    const g = gateway({ address: 100, cansend: true })
    try {
      g.app.emit('nmea2000out', line(0, 129284, 34))
      expect(g.sent).to.have.length(1)
      expect(sourceAddresses(g.sent)).to.deep.equal(Array(5).fill(100))
    } finally {
      g.stream.end()
    }
  })

  it('preserves the null source address, as the JSON send path does', function () {
    const g = gateway({ address: 100, cansend: true })
    try {
      g.app.emit('nmea2000out', line(254))
      expect(sourceAddresses(g.sent)).to.deep.equal([254])
    } finally {
      g.stream.end()
    }
  })

  it('leaves the supplied address intact without a local device', function () {
    const g = gateway()
    try {
      g.app.emit('nmea2000out', line(32))
      expect(sourceAddresses(g.sent)).to.deep.equal([32])
    } finally {
      g.stream.end()
    }
  })

  it('does not transmit before the local device can send', function () {
    const g = gateway({ address: 100, cansend: false })
    try {
      g.app.emit('nmea2000out', line(0))
      expect(g.sent).to.deep.equal([])
    } finally {
      g.stream.end()
    }
  })
})
