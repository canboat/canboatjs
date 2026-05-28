import dgram from 'dgram'
import { EventEmitter } from 'events'
import { discover, isMaretronAnnounce } from './discovery'

// A real 34-byte IPG100 announce captured off the wire: the ASCII string
// "IPG, return ping ACK\0" followed by a binary flags/identifier tail.
const IPG_ANNOUNCE = Buffer.from(
  '4950472c2072657475726e2070696e672041434b000100000000dcff7b24a0bd1800',
  'hex'
)

describe('isMaretronAnnounce', () => {
  test('matches a real IPG100 announce frame', () => {
    expect(isMaretronAnnounce(IPG_ANNOUNCE)).toBe(true)
  })

  test('matches the prefix regardless of the binary tail', () => {
    expect(isMaretronAnnounce(Buffer.from('IPG, return ping ACK'))).toBe(true)
  })

  test('rejects YDRAW and other unrelated traffic', () => {
    expect(isMaretronAnnounce(Buffer.from('$YDRAW'))).toBe(false)
    expect(isMaretronAnnounce(Buffer.from('CONNECT\t""'))).toBe(false)
    expect(isMaretronAnnounce(Buffer.alloc(0))).toBe(false)
    expect(isMaretronAnnounce(Buffer.from('IPG'))).toBe(false)
  })
})

describe('discover — Maretron IPG', () => {
  function makeApp(): EventEmitter & { config: any } {
    const app = new EventEmitter() as EventEmitter & { config: any }
    app.config = { settings: { pipedProviders: [] } }
    return app
  }

  test('emits a maretron-ipg-canboatjs provider on receiving an announce', (done) => {
    const app = makeApp()
    app.on('discovered', (provider: any) => {
      try {
        const subOptions = provider.pipeElements[0].options.subOptions
        expect(subOptions.type).toBe('maretron-ipg-canboatjs')
        expect(subOptions.host).toBe('127.0.0.1')
        expect(subOptions.port).toBe('6543')
        expect(provider.id).toBe('Maretron-IPG-127.0.0.1')
        done()
      } catch (err) {
        done(err)
      }
    })

    discover(app)

    // Give the discovery socket a moment to bind before announcing.
    setTimeout(() => {
      const sender = dgram.createSocket('udp4')
      sender.send(IPG_ANNOUNCE, 65499, '127.0.0.1', () => sender.close())
    }, 200)
  })

  test('does not re-discover when a maretron-ipg provider already exists', (done) => {
    const app = makeApp()
    app.config.settings.pipedProviders = [
      {
        pipeElements: [
          {
            type: 'providers/simple',
            options: {
              type: 'NMEA2000',
              subOptions: { type: 'maretron-ipg-canboatjs', host: '10.0.0.5' }
            }
          }
        ]
      }
    ]
    let emitted = false
    app.on('discovered', () => {
      emitted = true
    })

    discover(app)

    setTimeout(() => {
      const sender = dgram.createSocket('udp4')
      sender.send(IPG_ANNOUNCE, 65499, '127.0.0.1', () => sender.close())
    }, 200)

    setTimeout(() => {
      expect(emitted).toBe(false)
      done()
    }, 600)
  })
})
