import dgram from 'dgram'
import { EventEmitter } from 'events'

// Mock dnssd before importing discovery — keeps tests off the multicast
// network and gives us deterministic control over serviceUp events.
class FakeBrowser extends EventEmitter {
  start = jest.fn()
  stop = jest.fn()
}
const mockBrowsers: FakeBrowser[] = []
jest.mock('dnssd', () => ({
  Browser: jest.fn().mockImplementation(() => {
    const b = new FakeBrowser()
    mockBrowsers.push(b)
    return b
  }),
  tcp: jest.fn((name: string) => `_${name}._tcp`)
}))

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

describe('discover — SensESP-N2K (mDNS)', () => {
  function makeApp(): EventEmitter & { config: any } {
    const app = new EventEmitter() as EventEmitter & { config: any }
    app.config = { settings: { pipedProviders: [] } }
    return app
  }

  beforeEach(() => {
    mockBrowsers.length = 0
  })

  // The mocked dnssd module advertises one Browser per `discover()` call —
  // grab the most recent one and replay an mDNS serviceUp event through it.
  function lastBrowser(): FakeBrowser {
    return mockBrowsers[mockBrowsers.length - 1]
  }

  test('emits a navlink2-tcp provider when a sensesp-n2k service is announced', (done) => {
    const app = makeApp()
    app.on('discovered', (provider: any) => {
      try {
        expect(provider.id).toBe('SensESP-N2K-192.168.1.42')
        const sub = provider.pipeElements[0].options.subOptions
        expect(sub.type).toBe('navlink2-tcp-canboatjs')
        expect(sub.host).toBe('192.168.1.42')
        expect(sub.port).toBe('2599')
        done()
      } catch (err) {
        done(err)
      }
    })

    discover(app)

    lastBrowser().emit('serviceUp', {
      fullname: 'n2k-gateway._sensesp-n2k._tcp.local',
      name: 'n2k-gateway',
      addresses: ['192.168.1.42'],
      port: 2599,
      txt: {
        txtvers: '1',
        format: 'candump3',
        iface: 'can0',
        model: 'sensesp-n2k-gateway'
      }
    })
  })

  test('prefers an IPv4 address when both v4 and v6 are advertised', (done) => {
    const app = makeApp()
    app.on('discovered', (provider: any) => {
      try {
        expect(provider.id).toBe('SensESP-N2K-192.168.1.42')
        expect(provider.pipeElements[0].options.subOptions.host).toBe(
          '192.168.1.42'
        )
        done()
      } catch (err) {
        done(err)
      }
    })

    discover(app)

    lastBrowser().emit('serviceUp', {
      addresses: ['fe80::1', '192.168.1.42'],
      port: 2599,
      txt: { format: 'candump3' }
    })
  })

  test('ignores services with a non-candump3 format', () => {
    const app = makeApp()
    const emitted: any[] = []
    app.on('discovered', (p: any) => emitted.push(p))

    discover(app)

    lastBrowser().emit('serviceUp', {
      addresses: ['192.168.1.42'],
      port: 2599,
      txt: { format: 'actisense' }
    })

    expect(emitted).toEqual([])
  })

  test('does not re-discover when the same host is already configured', () => {
    const app = makeApp()
    app.config.settings.pipedProviders = [
      {
        id: 'SensESP-N2K-192.168.1.42',
        pipeElements: [
          {
            type: 'providers/simple',
            options: {
              type: 'NMEA2000',
              subOptions: {
                type: 'navlink2-tcp-canboatjs',
                host: '192.168.1.42',
                port: '2599'
              }
            }
          }
        ]
      }
    ]
    const emitted: any[] = []
    app.on('discovered', (p: any) => emitted.push(p))

    discover(app)

    lastBrowser().emit('serviceUp', {
      addresses: ['192.168.1.42'],
      port: 2599,
      txt: { format: 'candump3' }
    })

    expect(emitted).toEqual([])
  })
})
