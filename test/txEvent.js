const { expect } = require('chai')
const { EventEmitter } = require('events')
const { iKonvertStream } = require('../dist/ikonvert')
const { Ydgw02Stream } = require('../dist/ydgw02')
const { W2K01Stream } = require('../dist/w2k01')

// The event a gateway driver hands its encoded output to the transport on
// (#550): txEvent when given, else the driver's own option or default.
describe('Gateway transmit event', function () {
  const heading = {
    pgn: 127250,
    prio: 2,
    dst: 255,
    fields: { Heading: 1, Reference: 'Magnetic' }
  }
  const actisense =
    '2017-04-15T14:57:58.468Z,2,127250,1,255,8,00,e8,03,ff,7f,ff,7f,fd'

  function newApp() {
    const app = new EventEmitter()
    app.setProviderStatus = () => {}
    app.setProviderError = () => {}
    return app
  }

  function record(app, event) {
    const sent = []
    app.on(event, (msg) => sent.push(msg))
    return sent
  }

  // A Ydwg02 sends once it has heard from the gateway; pretend it has.
  function ydgw02(options) {
    const stream = new Ydgw02Stream(options, 'network')
    stream.sentAvailable = true
    return stream
  }

  const drivers = [
    {
      name: 'iKonvert serial',
      create: (options) => {
        const stream = new iKonvertStream(options)
        stream.cansend = true // skip the init handshake
        return stream
      },
      defaultEvent: 'ikonvertOut'
    },
    {
      name: 'iKonvert TCP',
      create: (options) => {
        const stream = new iKonvertStream({ ...options, tcp: true })
        stream.cansend = true
        return stream
      },
      defaultEvent: 'navlink2-out'
    },
    {
      name: 'Ydwg02',
      create: ydgw02,
      defaultEvent: 'ydwg02-out'
    },
    {
      name: 'W2k01',
      create: (options) => new W2K01Stream(options, 'ascii'),
      defaultEvent: 'w2k-1-out'
    }
  ]

  drivers.forEach((driver) => {
    describe(driver.name, function () {
      it('sends on its default event without txEvent', function () {
        const app = newApp()
        const sent = record(app, driver.defaultEvent)
        driver.create({ app, providerId: 'a' })
        app.emit('nmea2000JsonOut', { ...heading })
        expect(sent).to.have.length(1)
      })

      it('sends on txEvent instead of its default', function () {
        const app = newApp()
        const sentDefault = record(app, driver.defaultEvent)
        const sentTx = record(app, 'tx:a')
        driver.create({ app, providerId: 'a', txEvent: 'tx:a' })
        app.emit('nmea2000JsonOut', { ...heading })
        expect(sentTx).to.have.length(1)
        expect(sentDefault).to.have.length(0)
      })

      it('keeps two connections apart', function () {
        const app = newApp()
        const sentA = record(app, 'tx:a')
        const sentB = record(app, 'tx:b')
        driver.create({
          app,
          providerId: 'a',
          txEvent: 'tx:a',
          outEvent: 'out:a',
          jsonOutEvent: 'json:a'
        })
        driver.create({
          app,
          providerId: 'b',
          txEvent: 'tx:b',
          outEvent: 'out:b',
          jsonOutEvent: 'json:b'
        })
        app.emit('json:b', { ...heading })
        app.emit('out:b', actisense)
        expect(sentA).to.have.length(0)
        expect(sentB).to.have.length(2)
      })
    })
  })

  it('Ydwg02 still takes ydgwOutEvent, below txEvent', function () {
    const app = newApp()
    const sentLegacy = record(app, 'legacy')
    ydgw02({ app, ydgwOutEvent: 'legacy' })
    app.emit('nmea2000JsonOut', { ...heading })
    expect(sentLegacy).to.have.length(1)

    const app2 = newApp()
    const sentLegacy2 = record(app2, 'legacy')
    const sentTx = record(app2, 'tx')
    ydgw02({ app: app2, ydgwOutEvent: 'legacy', txEvent: 'tx' })
    app2.emit('nmea2000JsonOut', { ...heading })
    expect(sentTx).to.have.length(1)
    expect(sentLegacy2).to.have.length(0)
  })

  it('W2k01 still takes the event as an argument, below txEvent', function () {
    const app = newApp()
    const sentLegacy = record(app, 'legacy')
    new W2K01Stream({ app }, 'ascii', 'legacy')
    app.emit('nmea2000JsonOut', { ...heading })
    expect(sentLegacy).to.have.length(1)

    const app2 = newApp()
    const sentLegacy2 = record(app2, 'legacy')
    const sentTx = record(app2, 'tx')
    new W2K01Stream({ app: app2, txEvent: 'tx' }, 'ascii', 'legacy')
    app2.emit('nmea2000JsonOut', { ...heading })
    expect(sentTx).to.have.length(1)
    expect(sentLegacy2).to.have.length(0)
  })
})
