import { EventEmitter } from 'events'
import {
  parseMaretronFrame,
  buildMaretronFrame,
  buildConnectMessage,
  SET_MODE_BINARY,
  MaretronIPGStream,
  MaretronDecodedFrame
} from './maretron-ipg'

// ---------------------------------------------------------------------------
// Canonical wire-format vectors covering each combination of PDU
// (1 / 2), msg_type (1 / 2 / 3), and length encoding (8-bit / 16-bit).
// RX vectors are parsed; TX vectors are also rebuilt byte-for-byte.
// ---------------------------------------------------------------------------

interface Vector {
  name: string
  direction: 'rx' | 'tx'
  wireHex: string
  decoded: {
    pgn: number
    src: number
    dst: number
    priority: number
    dp: number
    edp: number
    msg_type: number
    payload_length: number
    payload_hex: string
  }
}

// 260 bytes: i mod 256 for i = 0..259.
function buildPayload260Hex(): string {
  const out: string[] = []
  for (let i = 0; i < 260; i++) {
    out.push((i & 0xff).toString(16).padStart(2, '0'))
  }
  return out.join('')
}

const VECTORS: Vector[] = [
  // PGN 127488 (Engine Parameters, Rapid Update) from SA 0x0F, priority 2,
  // PDU2 broadcast, single frame.
  {
    name: 'rx-pgn127488-pdu2-singleframe',
    direction: 'rx',
    wireHex: 'a5a3f2000f0800a8160000 00ffff',
    decoded: {
      pgn: 127488,
      src: 0x0f,
      dst: 0xff,
      priority: 2,
      dp: 1,
      edp: 0,
      msg_type: 1,
      payload_length: 8,
      payload_hex: '00a8160000 00ffff'
    }
  },
  // PGN 59904 (ISO Request) PDU1 directed to SA 0x23 from SA 0x05.
  {
    name: 'rx-pgn59904-pdu1-singleframe',
    direction: 'rx',
    wireHex: 'a5e2ea2305030 0ee01',
    decoded: {
      pgn: 59904,
      src: 5,
      dst: 0x23,
      priority: 6,
      dp: 0,
      edp: 0,
      msg_type: 1,
      payload_length: 3,
      payload_hex: '00ee01'
    }
  },
  // PGN 60928 (ISO Address Claim) PDU1 broadcast (dst=0xFF) from SA 0x29.
  {
    name: 'rx-pgn60928-pdu1-broadcast',
    direction: 'rx',
    wireHex: 'a5e2eeff290801020304 05060708',
    decoded: {
      pgn: 60928,
      src: 41,
      dst: 0xff,
      priority: 6,
      dp: 0,
      edp: 0,
      msg_type: 1,
      payload_length: 8,
      payload_hex: '0102030405060708'
    }
  },
  // PGN 126996 (Product Information) reassembled fast-packet envelope.
  {
    name: 'rx-pgn126996-pdu2-fastpacket',
    direction: 'rx',
    wireHex:
      'a5e5f014294001020304050607 08090a0b0c0d0e0f10111213141516171819 1a1b1c1d1e1f202122232425262728292a 2b2c2d2e2f303132333435363738393a3b 3c3d3e3f40',
    decoded: {
      pgn: 126996,
      src: 41,
      dst: 0xff,
      priority: 6,
      dp: 1,
      edp: 0,
      msg_type: 2,
      payload_length: 64,
      payload_hex:
        '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40'
    }
  },
  // PGN 130820 with msg_type=3 and a 260-byte payload — the only case
  // that exercises the 16-bit length encoding (LL=0x04 LH=0x01 = 260).
  {
    name: 'rx-pgn130820-pdu2-transport',
    direction: 'rx',
    wireHex: 'a5e7ff04290401' + buildPayload260Hex(),
    decoded: {
      pgn: 130820,
      src: 41,
      dst: 0xff,
      priority: 6,
      dp: 1,
      edp: 0,
      msg_type: 3,
      payload_length: 260,
      payload_hex: buildPayload260Hex()
    }
  },
  // TX: ISO Request with SA=0xFF sentinel.
  {
    name: 'tx-pgn59904-iso-request-sa0xff',
    direction: 'tx',
    wireHex: 'a5e2ea23ff0300ee01',
    decoded: {
      pgn: 59904,
      src: 0xff,
      dst: 0x23,
      priority: 6,
      dp: 0,
      edp: 0,
      msg_type: 1,
      payload_length: 3,
      payload_hex: '00ee01'
    }
  },
  // TX: PGN 126720 — PDU1 (PF=0xEF, just below the PDU2 boundary), so
  // PS carries the destination SA. msg_type=2 fast packet.
  {
    name: 'tx-pgn126720-fastpacket',
    direction: 'tx',
    wireHex: 'a5b5ef14ff108924038000006400000000000000001f',
    decoded: {
      pgn: 126720,
      src: 0xff,
      dst: 0x14,
      priority: 3,
      dp: 1,
      edp: 0,
      msg_type: 2,
      payload_length: 16,
      payload_hex: '8924038000006400000000000000001f'
    }
  }
]

function hexStringToBuffer(hex: string): Buffer {
  return Buffer.from(hex.replace(/\s+/g, ''), 'hex')
}

describe('Maretron IPG wire format — vectors', () => {
  for (const v of VECTORS) {
    const wire = hexStringToBuffer(v.wireHex)

    if (v.direction === 'rx') {
      test(`${v.name} — parseMaretronFrame decodes correctly`, () => {
        const result = parseMaretronFrame(wire, 0)
        expect(result.invalid).toBeFalsy()
        expect(result.consumed).toBe(wire.length)
        const frame = result.frame!
        expect(frame.pgn).toBe(v.decoded.pgn)
        expect(frame.src).toBe(v.decoded.src)
        expect(frame.dst).toBe(v.decoded.dst)
        expect(frame.priority).toBe(v.decoded.priority)
        expect(frame.dp).toBe(v.decoded.dp)
        expect(frame.edp).toBe(v.decoded.edp)
        expect(frame.msg_type).toBe(v.decoded.msg_type)
        expect(frame.payload_length).toBe(v.decoded.payload_length)
        expect(frame.payload.toString('hex')).toBe(
          v.decoded.payload_hex.replace(/\s+/g, '')
        )
      })
    } else {
      test(`${v.name} — buildMaretronFrame produces exact wire bytes`, () => {
        const payload = hexStringToBuffer(v.decoded.payload_hex)
        const built = buildMaretronFrame({
          pgn: v.decoded.pgn,
          src: v.decoded.src,
          dst: v.decoded.dst,
          priority: v.decoded.priority,
          msg_type: v.decoded.msg_type,
          edp: v.decoded.edp,
          payload
        })
        expect(built.toString('hex')).toBe(
          v.wireHex.replace(/\s+/g, '').toLowerCase()
        )
      })

      // Feeding the built bytes back through the parser must yield the
      // exact same `decoded` fields. Ensures parse/build are inverses.
      test(`${v.name} — parse(build(decoded)) round-trips`, () => {
        const payload = hexStringToBuffer(v.decoded.payload_hex)
        const built = buildMaretronFrame({
          pgn: v.decoded.pgn,
          src: v.decoded.src,
          dst: v.decoded.dst,
          priority: v.decoded.priority,
          msg_type: v.decoded.msg_type,
          edp: v.decoded.edp,
          payload
        })
        const reparsed = parseMaretronFrame(built, 0).frame!
        expect(reparsed.pgn).toBe(v.decoded.pgn)
        expect(reparsed.src).toBe(v.decoded.src)
        expect(reparsed.dst).toBe(v.decoded.dst)
        expect(reparsed.priority).toBe(v.decoded.priority)
        expect(reparsed.dp).toBe(v.decoded.dp)
        expect(reparsed.msg_type).toBe(v.decoded.msg_type)
        expect(reparsed.payload_length).toBe(v.decoded.payload_length)
      })
    }
  }
})

// ---------------------------------------------------------------------------
// Parser edge cases
// ---------------------------------------------------------------------------

describe('parseMaretronFrame — incremental input', () => {
  // A PGN 127488 PDU2 frame, used as the seed for partial-input cases.
  const VECTOR_01 = Buffer.from(
    'a5a3f2000f0800a8160000 00ffff'.replace(/\s+/g, ''),
    'hex'
  )

  test('returns consumed=0 (not invalid) when fewer than 6 bytes are present', () => {
    for (let i = 0; i < 6; i++) {
      const slice = VECTOR_01.subarray(0, i)
      const r = parseMaretronFrame(slice, 0)
      expect(r.consumed).toBe(0)
      expect(r.frame).toBeUndefined()
      expect(r.invalid).toBeFalsy()
    }
  })

  test('returns consumed=0 when payload is incomplete', () => {
    // 6-byte header advertises 8-byte payload but we only have 6+4 bytes.
    const slice = VECTOR_01.subarray(0, 10)
    const r = parseMaretronFrame(slice, 0)
    expect(r.consumed).toBe(0)
    expect(r.frame).toBeUndefined()
  })

  test('rejects frames with F1 sync bit unset as invalid', () => {
    const bad = Buffer.from(VECTOR_01)
    bad[1] = bad[1] & 0x7f // clear sync bit
    const r = parseMaretronFrame(bad, 0)
    expect(r.invalid).toBe(true)
  })

  test('rejects frames not starting with 0xA5 as invalid', () => {
    const bad = Buffer.from(VECTOR_01)
    bad[0] = 0x00
    const r = parseMaretronFrame(bad, 0)
    expect(r.invalid).toBe(true)
  })

  test('msg_type=3 needs 7 bytes of header before length is known', () => {
    // Construct a minimal msg_type=3 frame with a 1-byte payload.
    const built = buildMaretronFrame({
      pgn: 130820,
      src: 41,
      priority: 6,
      msg_type: 3,
      payload: Buffer.from([0xaa])
    })
    expect(parseMaretronFrame(built.subarray(0, 6), 0).consumed).toBe(0)
    expect(parseMaretronFrame(built, 0).frame?.payload[0]).toBe(0xaa)
  })

  test('PDU2 broadcast: PS becomes PGN low byte, dst=0xFF regardless of input dst', () => {
    const built = buildMaretronFrame({
      pgn: 127488,
      src: 0x0f,
      dst: 0x42, // ignored because PDU2
      priority: 2,
      msg_type: 1,
      payload: Buffer.alloc(8)
    })
    expect(built[3]).toBe(0x00) // PS = PGN low byte (0x1F200 & 0xFF)
    expect(parseMaretronFrame(built, 0).frame?.dst).toBe(0xff)
  })

  test('PDU1 directed: PS carries dst, dst is preserved through round-trip', () => {
    const built = buildMaretronFrame({
      pgn: 59904,
      src: 0xff,
      dst: 0x23,
      priority: 6,
      msg_type: 1,
      payload: Buffer.from([0x00, 0xee, 0x01])
    })
    expect(built[3]).toBe(0x23)
    expect(parseMaretronFrame(built, 0).frame?.dst).toBe(0x23)
  })

  test('rejects payloads > 255 bytes when msg_type != 3', () => {
    expect(() =>
      buildMaretronFrame({
        pgn: 127488,
        msg_type: 1,
        payload: Buffer.alloc(256)
      })
    ).toThrow(/Transport Protocol/)
  })

  test('handles back-to-back frames in a single buffer', () => {
    const a = buildMaretronFrame({
      pgn: 127488,
      src: 0x0f,
      priority: 2,
      msg_type: 1,
      payload: Buffer.from('00a816000000ffff', 'hex')
    })
    const b = buildMaretronFrame({
      pgn: 60928,
      src: 0x29,
      priority: 6,
      msg_type: 1,
      payload: Buffer.from('0102030405060708', 'hex')
    })
    const both = Buffer.concat([a, b])

    const r1 = parseMaretronFrame(both, 0)
    expect(r1.frame?.pgn).toBe(127488)
    const r2 = parseMaretronFrame(both, r1.consumed)
    expect(r2.frame?.pgn).toBe(60928)
    expect(r1.consumed + r2.consumed).toBe(both.length)
  })
})

// ---------------------------------------------------------------------------
// Handshake helpers
// ---------------------------------------------------------------------------

describe('handshake helpers', () => {
  test('buildConnectMessage wraps the password in double quotes and NUL-terminates', () => {
    const buf = buildConnectMessage('')
    expect(buf.toString('utf8')).toBe('CONNECT\t""\t\tMOBILE\0')
    expect(buf[buf.length - 1]).toBe(0)
  })

  test('buildConnectMessage carries the supplied password verbatim inside the quotes', () => {
    expect(buildConnectMessage('hunter2').toString('utf8')).toBe(
      'CONNECT\t"hunter2"\t\tMOBILE\0'
    )
  })

  test('buildConnectMessage rejects passwords with handshake-breaking characters', () => {
    for (const bad of [
      'has"quote',
      'has\ttab',
      'has\0nul',
      'has\rcr',
      'has\nlf'
    ]) {
      expect(() => buildConnectMessage(bad)).toThrow(/quotes, tabs, or NUL/)
    }
  })

  test('SET_MODE_BINARY matches the documented wire bytes', () => {
    expect(SET_MODE_BINARY.toString('utf8')).toBe('SET_MODE\tBINARY\0')
  })
})

// ---------------------------------------------------------------------------
// Stream wiring — drive the parser via a fake socket (no real TCP)
// ---------------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  public written: Buffer[] = []
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  write(data: Buffer | string): boolean {
    if (typeof data === 'string') {
      this.written.push(Buffer.from(data, 'utf8'))
    } else {
      this.written.push(Buffer.from(data))
    }
    return true
  }
  end() {
    this.emit('close')
  }
  destroy() {
    this.emit('close')
  }
}

describe('MaretronIPGStream — handshake & frame routing', () => {
  test('sends CONNECT on connect, SET_MODE BINARY on CONNECTED, then emits parsed frames', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      port: 6543,
      password: '',
      reconnect: false,
      _socketFactory: () => fake as any
    })

    const frames: MaretronDecodedFrame[] = []
    stream.on('n2kFrame', (f: MaretronDecodedFrame) => frames.push(f))

    // 1. Fake socket connects.
    fake.emit('connect')
    expect(fake.written.length).toBe(1)
    expect(fake.written[0].toString('utf8')).toBe('CONNECT\t""\t\tMOBILE\0')

    // 2. Daemon streams the four handshake replies in order.
    fake.emit(
      'data',
      Buffer.from(
        'SERVER_VERSION\t4.2.0.1\tIPG100\0' +
          'INSTANCE_DATA\t41\t1\0' +
          'LICENSES_USED\t1\t1\t1\t1\0',
        'utf8'
      )
    )
    // Still awaiting CONNECTED — no SET_MODE yet.
    expect(fake.written.length).toBe(1)

    fake.emit('data', Buffer.from('CONNECTED\t12345\0', 'utf8'))
    expect(fake.written.length).toBe(2)
    expect(fake.written[1].toString('utf8')).toBe('SET_MODE\tBINARY\0')
    expect(stream.state).toBe('streaming')
    expect(stream.ipgBusAddress).toBe(41)
    expect(stream.deviceSerial).toBe('12345')

    // 3. Inject a binary frame (Vector 01's bytes).
    fake.emit('data', Buffer.from('a5a3f2000f0800a816000000ffff', 'hex'))
    expect(frames.length).toBe(1)
    expect(frames[0].pgn).toBe(127488)
    expect(frames[0].src).toBe(0x0f)
    expect(frames[0].priority).toBe(2)
  })

  test('sendPGN writes a 0xA5-framed buffer to the socket when streaming', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: false,
      _socketFactory: () => fake as any
    })
    fake.emit('connect')
    fake.emit('data', Buffer.from('CONNECTED\t1\0', 'utf8'))
    fake.written.length = 0

    // sendPGN with a minimal handcrafted PGN — toPgn will pad/format it.
    stream.sendPGN({
      pgn: 59904,
      prio: 6,
      src: 0,
      dst: 0x23,
      fields: { PGN: 126464 }
    } as any)

    expect(fake.written.length).toBeGreaterThan(0)
    const wire = fake.written[fake.written.length - 1]
    expect(wire[0]).toBe(0xa5)
    // PF = byte 2 = 0xEA, PS = byte 3 = 0x23 (PDU1 directed)
    expect(wire[2]).toBe(0xea)
    expect(wire[3]).toBe(0x23)
    // SA = byte 4 = 0xFF (always 0xFF on TX — IPG substitutes its claim)
    expect(wire[4]).toBe(0xff)
  })

  test('sendString accepts canboat plain CSV and frames it', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: false,
      _socketFactory: () => fake as any
    })
    fake.emit('connect')
    fake.emit('data', Buffer.from('CONNECTED\t1\0', 'utf8'))
    fake.written.length = 0

    stream.sendString('2026-05-13-10:00:00.000,6,59904,5,35,3,00,ee,01')

    expect(fake.written.length).toBe(1)
    const wire = fake.written[0]
    expect(wire.toString('hex')).toBe('a5e2ea23ff0300ee01')
  })

  test('drops outbound PGNs before handshake completes', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: false,
      _socketFactory: () => fake as any
    })
    fake.emit('connect') // not yet CONNECTED
    fake.written.length = 0
    stream.sendPGN({
      pgn: 59904,
      prio: 6,
      dst: 0x23,
      src: 0,
      fields: {}
    } as any)
    expect(fake.written.length).toBe(0)
  })

  test('reassembles frames split across multiple data chunks', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: false,
      _socketFactory: () => fake as any
    })
    const frames: MaretronDecodedFrame[] = []
    stream.on('n2kFrame', (f: MaretronDecodedFrame) => frames.push(f))
    fake.emit('connect')
    fake.emit('data', Buffer.from('CONNECTED\t1\0', 'utf8'))

    const whole = Buffer.from('a5a3f2000f0800a816000000ffff', 'hex')
    // Split arbitrarily — first chunk doesn't even contain a full header.
    fake.emit('data', whole.subarray(0, 3))
    expect(frames.length).toBe(0)
    fake.emit('data', whole.subarray(3, 8))
    expect(frames.length).toBe(0)
    fake.emit('data', whole.subarray(8))
    expect(frames.length).toBe(1)
    expect(frames[0].pgn).toBe(127488)
  })

  test('resyncs past a junk high-bit byte preceding a valid 0xA5 frame', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: false,
      _socketFactory: () => fake as any
    })
    const frames: MaretronDecodedFrame[] = []
    stream.on('n2kFrame', (f: MaretronDecodedFrame) => frames.push(f))
    fake.emit('connect')
    fake.emit('data', Buffer.from('CONNECTED\t1\0', 'utf8'))

    // 0x90 has the high bit set so it can't be parsed as an ASCII text
    // frame, and isn't 0xA5 so it can't start a binary frame either.
    // Real-world cause: brief desync after the SET_MODE BINARY toggle.
    // The driver must skip exactly one byte and find the real frame.
    const good = Buffer.from('a5a3f2000f0800a816000000ffff', 'hex')
    const junk = Buffer.from([0x90])
    fake.emit('data', Buffer.concat([junk, good]))

    expect(frames.length).toBe(1)
    expect(frames[0].pgn).toBe(127488)
  })

  test('NO authentication reply emits authfail and ends the socket', () => {
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: false,
      _socketFactory: () => fake as any
    })
    let authfailed = false
    stream.on('authfail', () => (authfailed = true))
    fake.emit('connect')
    fake.emit('data', Buffer.from('NO\0', 'utf8'))
    expect(authfailed).toBe(true)
  })

  test('NO authentication failure does not schedule a reconnect or emit a fail-fast error', () => {
    jest.useFakeTimers()
    let factoryCalls = 0
    const sockets: FakeSocket[] = []
    const factory = () => {
      factoryCalls += 1
      const s = new FakeSocket()
      sockets.push(s)
      return s as any
    }
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: true, // would otherwise schedule a retry on close
      _socketFactory: factory
    })

    const errors: Error[] = []
    stream.on('error', (e: Error) => errors.push(e))
    let authfailed = false
    stream.on('authfail', () => (authfailed = true))

    sockets[0].emit('connect')
    sockets[0].emit('data', Buffer.from('NO\0', 'utf8'))
    // FakeSocket.end() synchronously emits 'close', which would normally
    // run the reconnect / fail-fast paths.
    expect(authfailed).toBe(true)
    expect(stream.reconnectTimer).toBeNull()
    expect(errors.length).toBe(0)
    jest.advanceTimersByTime(60_000)
    expect(factoryCalls).toBe(1)

    jest.useRealTimers()
  })
})

// ---------------------------------------------------------------------------
// Reconnect semantics — fail fast on initial connect (standalone),
// retry after success, with exponential backoff
// ---------------------------------------------------------------------------

describe('MaretronIPGStream — reconnect policy', () => {
  test('initial connection failure emits stream error and does not schedule a retry', () => {
    jest.useFakeTimers()
    const fake = new FakeSocket()
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: true,
      _socketFactory: () => fake as any
    })

    const errors: Error[] = []
    stream.on('error', (e: Error) => errors.push(e))

    // Simulate ECONNREFUSED with no prior 'connect' event.
    fake.emit(
      'error',
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )
    fake.emit('close')

    expect(errors.length).toBe(1)
    expect(errors[0].message).toBe('ECONNREFUSED')
    expect(stream.reconnectTimer).toBeNull()

    // Advancing time should not trigger a new socket factory call.
    jest.advanceTimersByTime(60_000)
    expect(stream.reconnectTimer).toBeNull()

    jest.useRealTimers()
  })

  test('post-handshake socket close schedules a reconnect with the timer ref-d', () => {
    jest.useFakeTimers()
    let factoryCalls = 0
    const sockets: FakeSocket[] = []
    const factory = () => {
      factoryCalls += 1
      const s = new FakeSocket()
      sockets.push(s)
      return s as any
    }
    const stream: any = MaretronIPGStream({
      host: 'fakehost',
      reconnect: true,
      reconnectInitialMs: 5000,
      _socketFactory: factory
    })

    expect(factoryCalls).toBe(1)

    // Complete the handshake on socket 0.
    sockets[0].emit('connect')
    sockets[0].emit('data', Buffer.from('CONNECTED\t1\0', 'utf8'))
    expect(stream.hasEverConnected).toBe(true)

    // Socket drops mid-session.
    sockets[0].emit('close')
    expect(stream.reconnectTimer).not.toBeNull()
    // Critically: the timer must NOT be unref'd. We verify by checking
    // hasRef() — if the implementation regresses to unref(), this fails.
    expect(stream.reconnectTimer.hasRef()).toBe(true)

    // Advance time to fire the reconnect.
    jest.advanceTimersByTime(5000)
    expect(factoryCalls).toBe(2)

    jest.useRealTimers()
  })

  test('SignalK-mode initial failure (app provided) retries instead of emitting error', () => {
    jest.useFakeTimers()
    let factoryCalls = 0
    const sockets: FakeSocket[] = []
    const factory = () => {
      factoryCalls += 1
      const s = new FakeSocket()
      sockets.push(s)
      return s as any
    }
    const app = new EventEmitter()
    ;(app as any).setProviderError = jest.fn()
    ;(app as any).setProviderStatus = jest.fn()

    const stream: any = MaretronIPGStream({
      app,
      providerId: 'maretron',
      host: 'fakehost',
      reconnect: true,
      reconnectInitialMs: 5000,
      _socketFactory: factory
    })

    const errors: Error[] = []
    stream.on('error', (e: Error) => errors.push(e))

    // Initial connect fails — no 'connect' event ever fired.
    sockets[0].emit(
      'error',
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )
    sockets[0].emit('close')

    // No stream-level error — SignalK keeps trying.
    expect(errors.length).toBe(0)
    expect(stream.reconnectTimer).not.toBeNull()
    expect((app as any).setProviderError).toHaveBeenCalled()

    // Advance time; retry should fire and call the factory again.
    jest.advanceTimersByTime(5000)
    expect(factoryCalls).toBe(2)

    jest.useRealTimers()
  })

  test('failFastOnInitialConnect:true override forces fail-fast even with an app', () => {
    jest.useFakeTimers()
    const fake = new FakeSocket()
    const app = new EventEmitter()
    ;(app as any).setProviderError = jest.fn()
    const stream: any = MaretronIPGStream({
      app,
      providerId: 'maretron',
      failFastOnInitialConnect: true,
      reconnect: true,
      _socketFactory: () => fake as any
    })

    const errors: Error[] = []
    stream.on('error', (e: Error) => errors.push(e))

    fake.emit(
      'error',
      Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    )
    fake.emit('close')

    expect(errors.length).toBe(1)
    expect(stream.reconnectTimer).toBeNull()

    jest.useRealTimers()
  })

  test('initial failure without an error listener logs to stderr instead of throwing', () => {
    const fake = new FakeSocket()
    const consoleErr = jest.spyOn(console, 'error').mockImplementation(() => {})

    // No stream.on('error') listener — emit('error') would otherwise crash.
    MaretronIPGStream({
      host: 'fakehost',
      reconnect: true,
      _socketFactory: () => fake as any
    })

    expect(() => {
      fake.emit(
        'error',
        Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
      )
      fake.emit('close')
    }).not.toThrow()

    expect(consoleErr).toHaveBeenCalled()
    consoleErr.mockRestore()
  })

  test('reconnect delay doubles on each failure, caps at reconnectMaxMs, resets on CONNECTED', () => {
    jest.useFakeTimers()
    const sockets: FakeSocket[] = []
    const factory = () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s as any
    }
    const app = new EventEmitter()
    ;(app as any).setProviderError = () => {}
    ;(app as any).setProviderStatus = () => {}

    const stream: any = MaretronIPGStream({
      app,
      providerId: 'maretron',
      reconnect: true,
      reconnectInitialMs: 100,
      reconnectMaxMs: 800,
      _socketFactory: factory
    })

    // First socket constructed in the constructor.
    expect(stream.reconnectDelayMs).toBe(100)

    // Walk through six failed attempts: 100, 200, 400, 800, 800, 800.
    const expected = [100, 200, 400, 800, 800, 800]
    for (let i = 0; i < expected.length; i++) {
      const delay = expected[i]
      sockets[i].emit(
        'error',
        Object.assign(new Error('flap'), { code: 'ECONNREFUSED' })
      )
      sockets[i].emit('close')
      // Next scheduled delay is doubled, capped.
      expect(stream.reconnectDelayMs).toBe(Math.min(delay * 2, 800))
      jest.advanceTimersByTime(delay)
      expect(sockets.length).toBe(i + 2)
    }

    // Successful handshake on the next socket resets the delay.
    sockets[sockets.length - 1].emit('connect')
    sockets[sockets.length - 1].emit(
      'data',
      Buffer.from('CONNECTED\t1\0', 'utf8')
    )
    expect(stream.reconnectDelayMs).toBe(100)

    // A subsequent close starts the backoff cycle over from initial.
    const lastIndex = sockets.length - 1
    sockets[lastIndex].emit('close')
    expect(stream.reconnectDelayMs).toBe(200)
    jest.advanceTimersByTime(100)
    expect(sockets.length).toBe(lastIndex + 2)

    jest.useRealTimers()
  })
})
