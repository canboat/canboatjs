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

// Mock dgram too, so discover()'s UDP listeners never touch the real network.
// bind() resolves immediately; send() is a no-op (no broadcast onto the LAN —
// this is what keeps a live IPG on the test host from polluting these tests).
// Created sockets are tracked so a test can replay an inbound frame by emitting
// a 'message' event on the listener.
class FakeUdpSocket extends EventEmitter {
  setBroadcast = jest.fn()
  send = jest.fn(
    (_buf: Buffer, _port: number, _addr: string, cb?: (e?: Error) => void) => {
      if (cb) cb()
    }
  )
  bind = jest.fn((portOrCb?: any, cb?: () => void) => {
    const done = typeof portOrCb === 'function' ? portOrCb : cb
    if (done) done()
    return this
  })
  close = jest.fn()
}
const mockUdpSockets: FakeUdpSocket[] = []
jest.mock('dgram', () => ({
  createSocket: jest.fn(() => {
    const s = new FakeUdpSocket()
    mockUdpSockets.push(s)
    return s
  })
}))

import {
  discover,
  isMaretronAnnounce,
  buildMaretronRequest,
  sendMaretronRequest
} from './discovery'

// A real 34-byte IPG100 announce/response captured off the wire: the ASCII
// string "IPG, return ping ACK\0" followed by the 0x01 discriminator and a
// binary flags/identifier tail.
const IPG_ANNOUNCE = Buffer.from(
  '4950472c2072657475726e2070696e672041434b000100000000dcff7b24a0bd1800',
  'hex'
)

// The 22-byte request frame other hosts (e.g. Maretron N2KAnalyzer) broadcast:
// the same prefix + NUL + a 0x00 discriminator, with no device tail.
const IPG_REQUEST = Buffer.from(
  '4950472c2072657475726e2070696e672041434b0000',
  'hex'
)

// Full-length (34-byte) negative fixtures derived from IPG_ANNOUNCE by flipping
// a single byte, so each clears the length check and exercises exactly the one
// guard it is named for (rather than being rejected early on length):
//   - REQUEST_FLAG: byte 21 is 0x00 (request) instead of 0x01 → discriminator guard
//   - BAD_SEPARATOR: byte 20 is 0xff instead of the NUL 0x00  → NUL-separator guard
const IPG_REQUEST_FLAG_FULL = Buffer.from(
  '4950472c2072657475726e2070696e672041434b000000000000dcff7b24a0bd1800',
  'hex'
)
const IPG_BAD_SEPARATOR_FULL = Buffer.from(
  '4950472c2072657475726e2070696e672041434bff0100000000dcff7b24a0bd1800',
  'hex'
)

describe('isMaretronAnnounce', () => {
  test('matches a real IPG100 announce frame', () => {
    expect(isMaretronAnnounce(IPG_ANNOUNCE)).toBe(true)
  })

  test('rejects a truncated 0x01 frame missing the 12-byte body', () => {
    // Prefix + NUL + 0x01 but only 22 bytes — a genuine ACK is 34 bytes, so a
    // header-only frame (truncated or spoofed) must not match.
    expect(
      isMaretronAnnounce(
        Buffer.from('4950472c2072657475726e2070696e672041434b0001', 'hex')
      )
    ).toBe(false)
  })

  test('rejects the 22-byte 0x00 request frame other hosts broadcast', () => {
    // The actual on-the-wire request: 22 bytes, 0x00 flag. Rejected (on length).
    expect(isMaretronAnnounce(IPG_REQUEST)).toBe(false)
  })

  test('rejects a full-length frame whose flag byte is the 0x00 request flag', () => {
    // 34 bytes, so the discriminator guard (not length) is what rejects it.
    expect(isMaretronAnnounce(IPG_REQUEST_FLAG_FULL)).toBe(false)
  })

  test('rejects a bare prefix with no discriminator', () => {
    expect(isMaretronAnnounce(Buffer.from('IPG, return ping ACK'))).toBe(false)
  })

  test('rejects a full-length frame with a non-NUL separator at offset 20', () => {
    // 34 bytes with 0xff at offset 20 and 0x01 at 21, so the NUL-separator
    // guard (not length) is what rejects it.
    expect(isMaretronAnnounce(IPG_BAD_SEPARATOR_FULL)).toBe(false)
  })

  test('rejects YDRAW and other unrelated traffic', () => {
    expect(isMaretronAnnounce(Buffer.from('$YDRAW'))).toBe(false)
    expect(isMaretronAnnounce(Buffer.from('CONNECT\t""'))).toBe(false)
    expect(isMaretronAnnounce(Buffer.alloc(0))).toBe(false)
    expect(isMaretronAnnounce(Buffer.from('IPG'))).toBe(false)
  })
})

describe('buildMaretronRequest', () => {
  test('produces the exact 22-byte request frame', () => {
    expect(buildMaretronRequest()).toEqual(IPG_REQUEST)
  })

  test('carries the 0x00 request discriminator and never self-triggers', () => {
    const req = buildMaretronRequest()
    expect(req[21]).toBe(0x00)
    expect(isMaretronAnnounce(req)).toBe(false)
  })
})

describe('sendMaretronRequest', () => {
  class FakeSocket extends EventEmitter {
    send = jest.fn(
      (
        _buf: Buffer,
        _port: number,
        _addr: string,
        cb?: (e?: Error) => void
      ) => {
        if (cb) cb()
      }
    )
  }

  test('broadcasts the request frame to port 65499 on the given socket', () => {
    const fake = new FakeSocket()
    sendMaretronRequest(fake as any, () => false)
    expect(fake.send).toHaveBeenCalled()
    const [buf, port, addr] = fake.send.mock.calls[0]
    expect(Buffer.from(buf).equals(buildMaretronRequest())).toBe(true)
    expect(port).toBe(65499)
    expect(addr).toBe('255.255.255.255')
  })

  test('does not send when discovery is already done', () => {
    const fake = new FakeSocket()
    sendMaretronRequest(fake as any, () => true)
    expect(fake.send).not.toHaveBeenCalled()
  })

  test('bursts the request on its retry schedule until all timers fire', () => {
    jest.useFakeTimers()
    try {
      const fake = new FakeSocket()
      sendMaretronRequest(fake as any, () => false)
      // One immediate send before any timer fires.
      expect(fake.send).toHaveBeenCalledTimes(1)
      // Draining the burst timers produces the remaining retry sends.
      jest.runOnlyPendingTimers()
      expect(fake.send.mock.calls.length).toBeGreaterThan(1)
      // Every send targets port 65499 with the request frame.
      for (const [buf, port, addr] of fake.send.mock.calls) {
        expect(Buffer.from(buf).equals(buildMaretronRequest())).toBe(true)
        expect(port).toBe(65499)
        expect(addr).toBe('255.255.255.255')
      }
    } finally {
      jest.useRealTimers()
    }
  })

  test('stops bursting once a reply has been handled', () => {
    jest.useFakeTimers()
    try {
      const fake = new FakeSocket()
      // Flip to "done" right after the immediate send, before any retry fires.
      let done = false
      sendMaretronRequest(fake as any, () => done)
      expect(fake.send).toHaveBeenCalledTimes(1)
      done = true
      jest.runOnlyPendingTimers()
      // No further sends after isDone() returns true.
      expect(fake.send).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('discover — Maretron IPG', () => {
  function makeApp(): EventEmitter & { config: any } {
    const app = new EventEmitter() as EventEmitter & { config: any }
    app.config = { settings: { pipedProviders: [] } }
    return app
  }

  beforeEach(() => {
    mockUdpSockets.length = 0
  })

  // The first socket created by discover() is the Maretron listener; replay an
  // inbound UDP frame on it by emitting a 'message' event (host, port).
  function announceTo(buffer: Buffer, address = '192.168.0.179') {
    const listener = mockUdpSockets[0]
    listener.emit('message', buffer, { address, port: 65499 })
  }

  test('emits a maretron-ipg-canboatjs provider on receiving an announce', () => {
    const app = makeApp()
    const providers: any[] = []
    app.on('discovered', (p: any) => providers.push(p))

    discover(app)
    announceTo(IPG_ANNOUNCE, '192.168.0.179')

    const maretron = providers.find(
      (p) =>
        p.pipeElements[0].options.subOptions.type === 'maretron-ipg-canboatjs'
    )
    expect(maretron).toBeDefined()
    const sub = maretron.pipeElements[0].options.subOptions
    expect(sub.host).toBe('192.168.0.179')
    expect(sub.port).toBe('6543')
    expect(maretron.id).toBe('Maretron-IPG-192.168.0.179')
  })

  test('ignores a 0x00 request frame from another host', () => {
    const app = makeApp()
    const providers: any[] = []
    app.on('discovered', (p: any) => providers.push(p))

    discover(app)
    // A request frame (0x00) arriving from some other host must not be
    // mis-discovered as the IPG.
    announceTo(IPG_REQUEST, '10.0.0.99')

    expect(
      providers.find(
        (p) =>
          p.pipeElements[0].options.subOptions.type === 'maretron-ipg-canboatjs'
      )
    ).toBeUndefined()
  })

  test('does not re-discover when a maretron-ipg provider already exists', () => {
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
    // The existing provider short-circuits the Maretron listener; even if a
    // frame did arrive it must not emit.
    if (mockUdpSockets.length > 0) announceTo(IPG_ANNOUNCE)
    expect(emitted).toBe(false)
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
