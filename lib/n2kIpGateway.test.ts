import { EventEmitter } from 'events'

// A minimal stand-in for net.Socket. The constructor (called via `new
// net.Socket()` inside the gateway) hands the test a reference via the global
// hook below so the test can drive its data events and inspect everything
// that's written to it.
class MockSocket extends EventEmitter {
  written: string[] = []
  connectedTo?: { port: number; host: string }
  destroyed = false

  connect(port: number, host: string, cb: () => void) {
    this.connectedTo = { port, host }
    // Defer to the next tick so listeners attached after .connect() still see
    // subsequent events.
    setImmediate(cb)
    return this
  }

  write(chunk: string | Buffer) {
    this.written.push(
      typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    )
    return true
  }

  end() {}
  destroy() {
    this.destroyed = true
  }

  // Test helpers
  feed(data: string) {
    this.emit('data', Buffer.from(data, 'utf8'))
  }
}

let lastSocket: MockSocket | undefined

jest.mock('net', () => ({
  Socket: jest.fn().mockImplementation(() => {
    lastSocket = new MockSocket()
    return lastSocket
  })
}))

// Avoid touching the real on-disk persisted unique number when CanDevice
// starts up — it writes/reads from process cwd which we don't want in tests.
jest.mock('./persist', () => ({
  getPersistedData: jest.fn(() => undefined),
  savePersistedData: jest.fn()
}))

import { N2kIpGateway } from './n2kIpGateway'

function makeApp() {
  const app = new EventEmitter() as any
  app.setProviderStatus = jest.fn()
  app.setProviderError = jest.fn()
  return app
}

async function waitForConnect() {
  // setImmediate inside MockSocket.connect — flush microtasks + one macrotask.
  await new Promise((r) => setImmediate(r))
}

describe('N2kIpGateway', () => {
  const created: any[] = []

  beforeEach(() => {
    lastSocket = undefined
    created.length = 0
  })

  afterEach(() => {
    // Tear down any gateways created during the test so their CanDevice's
    // setTimeout(0) for address-claim and any reconnect timers don't keep
    // the Jest event loop alive.
    while (created.length) {
      const gw = created.pop()
      try {
        gw.end()
      } catch (_e) {
        // ignore
      }
    }
  })

  function newGateway(opts: any) {
    const gw = new (N2kIpGateway as any)(opts)
    created.push(gw)
    return gw
  }

  test('requires options.host', () => {
    expect(() => new (N2kIpGateway as any)({} as any)).toThrow(/host/)
  })

  test('rejects unknown format', () => {
    expect(
      () =>
        new (N2kIpGateway as any)({
          app: makeApp(),
          host: 'h',
          format: 'totally-fake',
          actAsCanDevice: false
        })
    ).toThrow(/unsupported format/)
  })

  test('connects to default port 2599', async () => {
    newGateway({
      app: makeApp(),
      host: 'gw.local',
      actAsCanDevice: false
    })
    await waitForConnect()
    expect(lastSocket!.connectedTo).toEqual({ port: 2599, host: 'gw.local' })
  })

  test('honors explicit port', async () => {
    newGateway({
      app: makeApp(),
      host: 'gw.local',
      port: 9999,
      actAsCanDevice: false
    })
    await waitForConnect()
    expect(lastSocket!.connectedTo).toEqual({ port: 9999, host: 'gw.local' })
  })

  test('RX candump3: parses a line and pushes a frame downstream', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    const pushed: any[] = []
    gw.on('data', (frame: any) => pushed.push(frame))

    // CAN ID 09F11274 = prio 2, PGN 127250, src 116, dst (PDU2) implied 255.
    lastSocket!.feed('(1502979132.106111) can0 09F11274#0001020304050607\n')

    expect(pushed).toHaveLength(1)
    expect(pushed[0].pgn.pgn).toBe(127250)
    expect(pushed[0].pgn.src).toBe(0x74)
    expect(pushed[0].pgn.prio).toBe(2)
    expect(pushed[0].data.length).toBe(8)
    expect(pushed[0].data.toString('hex')).toBe('0001020304050607')
  })

  test('RX candump3: rewrites the raw "(sec.usec)" timestamp to an ISO date', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    const pushed: any[] = []
    gw.on('data', (frame: any) => pushed.push(frame))

    // 1502979132.106111 → 2017-08-17T14:12:12.106Z
    lastSocket!.feed('(1502979132.106111) can0 09F11274#0001020304050607\n')

    expect(pushed).toHaveLength(1)
    expect(pushed[0].pgn.timestamp).toBe('2017-08-17T14:12:12.106Z')
    expect(new Date(pushed[0].pgn.timestamp).getTime()).not.toBeNaN()
  })

  test('RX candump3: drops timestamps from devices with unsynced clocks (pre-2000)', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    const pushed: any[] = []
    gw.on('data', (frame: any) => pushed.push(frame))

    // Epoch 56702 = uptime-derived timestamp (1970-01-01 + ~15h45m), which
    // is what the SensESP gateway emits before NTP has synced. We drop it
    // so downstream code falls back to the server's own clock.
    lastSocket!.feed('(56702.123456) can0 09F11274#0001020304050607\n')

    expect(pushed).toHaveLength(1)
    expect(pushed[0].pgn.timestamp).toBeUndefined()
  })

  test('RX candump3: drops the timestamp field when it cannot be parsed', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    const pushed: any[] = []
    gw.on('data', (frame: any) => pushed.push(frame))

    // Pathological line: "(invalid)" — the parser will still split it, but
    // the timestamp should be dropped (not left as Invalid Date) so the
    // analyzer can fall back to "now".
    lastSocket!.feed('(invalid) can0 09F11274#0001020304050607\n')

    expect(pushed).toHaveLength(1)
    expect(pushed[0].pgn.timestamp).toBeUndefined()
  })

  test('RX candump3: re-buffers partial lines across socket chunks', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    const pushed: any[] = []
    gw.on('data', (frame: any) => pushed.push(frame))

    lastSocket!.feed('(1502979132.106111) can0 09F1127')
    expect(pushed).toHaveLength(0)
    lastSocket!.feed('4#0001020304050607\n')
    expect(pushed).toHaveLength(1)
  })

  test('TX candump3: encodes outbound PGN to a candump line on the socket', async () => {
    const app = makeApp()
    const gw = newGateway({
      app,
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    // Drive the sendPGN path through a raw Buffer in `data` so this test
    // doesn't depend on field encoding for any specific PGN definition.
    gw.sendPGN({
      pgn: 127245,
      prio: 2,
      src: 17,
      dst: 255,
      data: Buffer.from('0001020304050607', 'hex')
    })

    expect(lastSocket!.written.length).toBeGreaterThanOrEqual(1)
    const line = lastSocket!.written[0]
    // Shape: "(<ts>) <iface> <8 hex CAN ID>#<hex data>\n". The CAN ID is
    // lower-case (canIdString), the hex bytes are upper-case (encodeCandump3).
    expect(line).toMatch(/^\([0-9.]+\) \S+ [0-9a-f]{8}#[0-9A-Fa-f]+\n$/)
  })

  test('TX candump3: splits fast-packet payloads into multiple lines', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    // 12-byte raw payload — > 8 bytes triggers the fast-packet split.
    gw.sendPGN({
      pgn: 129029,
      prio: 3,
      src: 17,
      dst: 255,
      data: Buffer.from('000102030405060708090a0b', 'hex')
    })

    expect(lastSocket!.written.length).toBeGreaterThan(1)
    lastSocket!.written.forEach((line) => {
      expect(line).toMatch(/^\([0-9.]+\) \S+ [0-9a-f]{8}#[0-9A-Fa-f]+\n$/)
    })
  })

  test('actAsCanDevice: true creates a CanDevice and emits address claim', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    try {
      const app = makeApp()
      const gw = newGateway({
        app,
        providerId: 't',
        host: 'gw.local',
        format: 'candump3',
        actAsCanDevice: true,
        manufacturerCode: 999,
        uniqueNumber: 12345,
        preferredAddress: 100
      })
      await waitForConnect()
      // n2kDevice.start() schedules sendAddressClaim() via setTimeout(1000);
      // advance fake timers to fire it.
      jest.advanceTimersByTime(1100)

      expect(gw.candevice).toBeDefined()
      // Address claim is PGN 60928. In the encoded CAN ID it appears as
      // PDU1 form `prio EE dst src`, e.g. "18eeff64" (dst=255, src=100).
      const seenClaim = lastSocket!.written.some((line) =>
        /\s[0-9a-f]{2}ee[0-9a-f]{2}64#/i.test(line)
      )
      expect(seenClaim).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  test('actAsCanDevice: false skips CanDevice and still encodes outbound PGNs', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()

    expect(gw.candevice).toBeUndefined()

    gw.sendPGN({
      pgn: 127245,
      prio: 2,
      src: 17,
      dst: 255,
      data: Buffer.from('0001020304050607', 'hex')
    })
    expect(lastSocket!.written.length).toBeGreaterThanOrEqual(1)
  })

  test('format selection: ydraw uses YDRAW encoder', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'ydraw',
      actAsCanDevice: false
    })
    await waitForConnect()

    gw.sendPGN({
      pgn: 127245,
      prio: 2,
      src: 17,
      dst: 255,
      data: Buffer.from('0001020304050607', 'hex')
    })
    // YDRAW: "<CANID> <hex bytes space-separated>\r\n", no leading "(".
    expect(lastSocket!.written[0]).not.toMatch(/^\(/)
    expect(lastSocket!.written[0]).toMatch(
      /^[0-9a-f]{8} ([0-9A-Fa-f]{2} ?)+\r\n$/
    )
  })

  test('end() closes socket', async () => {
    const gw = newGateway({
      app: makeApp(),
      host: 'gw.local',
      format: 'candump3',
      actAsCanDevice: false
    })
    await waitForConnect()
    const sock = lastSocket!
    gw.end()
    expect(sock.destroyed).toBe(true)
  })
})
