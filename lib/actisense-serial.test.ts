import { EventEmitter } from 'events'
import { PGN } from '@canboat/ts-pgns'
import {
  ActisenseStream,
  composeMessage,
  firmwareVersion
} from './actisense-serial'

const DLE = 0x10
const STX = 0x02
const ETX = 0x03
const N2K_MSG_SEND = 0x94

// Reference framing parser matching the NGT-1's byte-stuffing protocol.
// Returns the unescaped payload (command byte + body) extracted from a
// well-formed DLE/STX...DLE/ETX frame, or null if framing is broken.
function unframe(bytes: Buffer): Buffer | null {
  const out: number[] = []
  let i = 0
  if (bytes[i++] !== DLE || bytes[i++] !== STX) return null
  while (i < bytes.length) {
    const c = bytes[i++]
    if (c === DLE) {
      const next = bytes[i++]
      if (next === ETX) {
        // checksum is the last unescaped byte before DLE ETX
        out.pop()
        return Buffer.from(out)
      }
      if (next === DLE) {
        out.push(DLE)
        continue
      }
      return null // unexpected DLE escape
    }
    out.push(c)
  }
  return null // never saw DLE ETX
}

describe('composeMessage DLE escaping', () => {
  test('payload of exactly 16 bytes escapes the length byte (regression for unescaped len == DLE)', () => {
    // The 126208 NMEA Command Group Function with two parameters produces
    // a 10-byte data payload, which becomes a 16-byte framed body
    // (1 prio + 3 pgn + 1 dst + 1 bytecount + 10 data). The body length
    // 0x10 collides with the DLE escape byte. Without escaping, the NGT-1
    // sees `94 10 02 ...` and resets framing on `DLE STX`, losing the
    // command byte and the rest of the message.
    const body = Buffer.from([
      0x02, 0x00, 0xed, 0x01, 0x10, 0x0a, 0x01, 0x0d, 0xf2, 0x01, 0xf8, 0x02,
      0x01, 0x2a, 0x0d, 0x01
    ])
    expect(body.length).toBe(0x10)

    const framed = composeMessage(N2K_MSG_SEND, body, body.length)

    // After the leading DLE STX command, the length byte 0x10 must be
    // doubled so the receiver doesn't mistake it for a framing escape.
    expect(framed[0]).toBe(DLE)
    expect(framed[1]).toBe(STX)
    expect(framed[2]).toBe(N2K_MSG_SEND)
    expect(framed[3]).toBe(0x10) // length
    expect(framed[4]).toBe(0x10) // escape — this is what the old code missed
  })

  test('payload of exactly 16 bytes round-trips through framing parser', () => {
    const body = Buffer.from([
      0x02, 0x00, 0xed, 0x01, 0x10, 0x0a, 0x01, 0x0d, 0xf2, 0x01, 0xf8, 0x02,
      0x01, 0x2a, 0x0d, 0x01
    ])

    const framed = composeMessage(N2K_MSG_SEND, body, body.length)
    const unframed = unframe(framed)

    expect(unframed).not.toBeNull()
    // unframed = [command, length, ...body]
    expect(unframed![0]).toBe(N2K_MSG_SEND)
    expect(unframed![1]).toBe(body.length)
    expect(unframed!.subarray(2)).toEqual(body)
  })

  test('checksum byte is escaped when it equals DLE', () => {
    // Construct a body whose checksum collides with DLE.
    // checksum = (256 - (command + len + sum(body))) mod 256
    // For checksum = 0x10, need (command + len + sum(body)) mod 256 == 0xf0.
    // command 0x94 (148) + len 1 + body[0] = 240  =>  body[0] = 91 (0x5b)
    const body = Buffer.from([0x5b])
    const framed = composeMessage(N2K_MSG_SEND, body, body.length)

    // Trailing pattern: ... <escaped checksum> DLE ETX
    // With escape: [..., 0x10, 0x10, 0x10, 0x03]
    const tail = Array.from(framed.slice(framed.length - 4))
    expect(tail).toEqual([0x10, 0x10, 0x10, 0x03])

    // Round-trip parse must still yield the original body and the
    // computed checksum byte (0x10) without confusing the parser.
    const unframed = unframe(framed)
    expect(unframed).not.toBeNull()
    expect(unframed![0]).toBe(N2K_MSG_SEND)
    expect(unframed![1]).toBe(body.length)
    expect(unframed!.subarray(2)).toEqual(body)
  })

  test('payload with embedded DLE byte is escaped (existing behavior, regression guard)', () => {
    const body = Buffer.from([0x01, DLE, 0x02])
    const framed = composeMessage(N2K_MSG_SEND, body, body.length)
    const unframed = unframe(framed)

    expect(unframed).not.toBeNull()
    expect(unframed![0]).toBe(N2K_MSG_SEND)
    expect(unframed![1]).toBe(body.length)
    expect(unframed!.subarray(2)).toEqual(body)
  })
})

describe('framing error recovery', () => {
  test('framing error clears bufferOffset so the next DLE ETX cannot dispatch a stale frame', () => {
    const app = new EventEmitter()
    const rawOutputs: string[] = []
    // signalk-server attaches a 'canboatjs:rawoutput' listener for the
    // activity log; that's what makes the non-plainText path call
    // binToActisense and exposes the crash.
    app.on('canboatjs:rawoutput', (data: string) => rawOutputs.push(data))
    const stream: any = new (ActisenseStream as any)({
      fromFile: true,
      app
    })
    // Capture the other downstream sink — `that.push(buffer.slice(2,
    // len))` — so this test pins both consumers, not just the
    // rawoutput emit.
    const downstream: Buffer[] = []
    stream.on('data', (chunk: Buffer) => downstream.push(chunk))

    // Reproduces the production crash:
    //   "DLE followed by unexpected char , ignore message"
    //   "Error: Trying to read past the end of the stream"
    //
    // Stage 1 — DLE STX 0x93 0x01 0x6c: start an N2K_MSG_RECEIVED
    // frame and collect 3 bytes whose sum (147+1+108) is 256 ≡ 0
    // mod 256, so the checksum check in processN2KMessage will pass
    // if it ever runs on this stale buffer.
    stream._transform(
      Buffer.from([DLE, STX, 0x93, 0x01, 0x6c]),
      'binary',
      () => {}
    )
    expect(stream.bufferOffset).toBe(3)

    // Stage 2 — DLE 0x99: DLE followed by an unexpected byte; the
    // framing state machine bails. The fix must clear bufferOffset
    // here. Asserting it explicitly pins the fix to *this* mechanism
    // — a future change that drops the bufferOffset reset but keeps
    // the length guard in processN2KMessage would still hide the
    // crash, but would fail this assertion.
    stream._transform(Buffer.from([DLE, 0x99]), 'binary', () => {})
    expect(stream.bufferOffset).toBe(0)

    // Stage 3 — DLE ETX without an intervening STX. Under the bug
    // this dispatches processN2KMessage on the stale 3-byte buffer
    // and BitStream throws "Trying to read past the end". With the
    // fix, bufferOffset is 0 — but note buffer[0] is *still* 0x93
    // from the stale frame, so the dispatch in read1Byte's MSG_ESCAPE
    // / ETX branch still calls processN2KMessage. Both layers of the
    // fix cooperate: the bufferOffset reset means the call passes
    // len=0, and the length guard in processN2KMessage rejects it
    // because the (still-stale) buffer[1] = 1 is below the minimum
    // declared payload of 11.
    expect(() => {
      stream._transform(Buffer.from([DLE, ETX]), 'binary', () => {})
    }).not.toThrow()
    expect(rawOutputs).toHaveLength(0)
    expect(downstream).toHaveLength(0)
  })

  test('reject Actisense frames whose declared payload is too short for the N2K header', () => {
    const app = new EventEmitter()
    const rawOutputs: string[] = []
    app.on('canboatjs:rawoutput', (data: string) => rawOutputs.push(data))
    const stream: any = new (ActisenseStream as any)({
      fromFile: true,
      app
    })
    const downstream: Buffer[] = []
    stream.on('data', (chunk: Buffer) => downstream.push(chunk))

    // Structurally-valid Actisense frame whose declared payload (10
    // bytes) is one byte too short to contain the 11-byte N2K header
    // that binToActisense reads. With no minimum-payload guard,
    // BitStream succeeds at reading 11 bytes (the buffered total is
    // long enough), but the byte read as the N2K data-length field
    // is actually the checksum byte — a silently-misparsed output
    // line ends up on the rawoutput listener.
    //   command 0x93 (147) + payloadLen 0x0a (10)
    //   + 10 zero data bytes (no DLE escaping needed)
    //   + checksum 0x63 (99)            (sum = 256 ≡ 0 mod 256)
    const frame = Buffer.from([
      DLE,
      STX,
      0x93,
      0x0a,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0x63,
      DLE,
      ETX
    ])

    stream._transform(frame, 'binary', () => {})

    expect(rawOutputs).toHaveLength(0)
    expect(downstream).toHaveLength(0)
  })
})

describe('parser state and buffer bounds (#457)', () => {
  // A received N2K frame: 0x93, payload length, 11-byte header (prio, PGN,
  // dst, src, timestamp, data length), data, checksum; no DLE bytes in it.
  function receivedFrame(): Buffer {
    const header = [2, 0x12, 0xf1, 0x01, 0xff, 0x01, 0, 0, 0, 0, 8]
    const data = [0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]
    const body = [0x93, header.length + data.length, ...header, ...data]
    const sum = body.reduce((a, b) => a + b, 0)
    return Buffer.from([DLE, STX, ...body, (256 - (sum % 256)) % 256, DLE, ETX])
  }

  function fileStream() {
    const app = new EventEmitter()
    const stream: any = new (ActisenseStream as any)({
      fromFile: true,
      plainText: true,
      app
    })
    const lines: string[] = []
    stream.on('data', (line: string) => lines.push(line))
    return { stream, lines }
  }

  test('the parser reads the state start() sets', () => {
    const { stream } = fileStream()
    expect(stream.state).toBe(1) // MSG_START
    // Inside a message, a byte is stored: the parser follows `state`.
    stream.state = 3 // MSG_MESSAGE
    stream._transform(Buffer.from([0x55]), 'binary', () => {})
    expect(stream.bufferOffset).toBe(1)
  })

  test('a frame longer than the buffer is cut short, not thrown on', () => {
    const { stream, lines } = fileStream()
    const runaway = Buffer.concat([
      Buffer.from([DLE, STX, 0x93]),
      Buffer.alloc(600, 0x55)
    ])
    expect(() => stream._transform(runaway, 'binary', () => {})).not.toThrow()
    expect(stream.bufferOffset).toBe(500)
    // The runaway frame ends at its DLE ETX (and is dropped as malformed);
    // the next frame decodes normally.
    stream._transform(Buffer.from([DLE, ETX]), 'binary', () => {})
    stream._transform(receivedFrame(), 'binary', () => {})
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(',127250,')
  })
})

describe('NGT frames must match their declared length', () => {
  // An NGT startup response: 0xa0, length 1, command 0x11, checksum.
  const ngt = (body: number[]) => {
    const sum = body.reduce((a, b) => a + b, 0)
    return Buffer.from([DLE, STX, ...body, (256 - (sum % 256)) % 256, DLE, ETX])
  }
  const stream = () => {
    const s: any = new (ActisenseStream as any)({
      fromFile: true,
      app: new EventEmitter()
    })
    s.outAvailable = true // no transmit-list request to schedule
    return s
  }

  test('a startup response is taken', () => {
    const s = stream()
    s._transform(ngt([0xa0, 0x01, 0x11]), 'binary', () => {})
    expect(s.gotStartupResponse).toBe(true)
  })

  test('a frame longer than it says is dropped, even with a good checksum', () => {
    const s = stream()
    s._transform(ngt([0xa0, 0x01, 0x11, 0x00, 0x00]), 'binary', () => {})
    expect(s.gotStartupResponse).toBeUndefined()
  })
})

describe('BEM answers to Set Operating Mode and Get Product Info (#502)', () => {
  // Answers of an NGT-1-USB, firmware 2.690, serial 110763, from canboat's
  // samples/actisense-ngt1-fw2690.txt: the payload of each NGT_MSG_RECEIVED,
  // after its length byte.
  const header = '01 0e 00 ab b0 01 00 00 00 00 00'
  const capture = {
    operatingMode: `11 ${header} 02 00`,
    productInfo: [
      `41 ${header} 34 08 27 6e 02 01`,
      `41 02 0e 00 ab b0 01 00 00 00 00 00 4e 4d 45 41 20 32 30 30 30 20 50 43 20 49 6e 74 65 72 66 61 63 65 20 28 4e 47 54 2d 31 29 ff ff`,
      `41 03 0e 00 ab b0 01 00 00 00 00 00 31 2e 31 30 30 2c 20 32 2e 36 39 30 ${'ff '.repeat(20).trim()}`,
      `41 04 0e 00 ab b0 01 00 00 00 00 00 4e 47 54 2d 31 2d 55 53 42 20 20 5b 35 5d ${'ff '.repeat(18).trim()}`,
      `41 05 0e 00 ab b0 01 00 00 00 00 00 31 31 30 37 36 33 ${'ff '.repeat(26).trim()}`
    ]
  }
  const hex = (s: string) => Buffer.from(s.replace(/ /g, ''), 'hex')
  const answer = (payload: Buffer) =>
    composeMessage(0xa0, payload, payload.length)

  let warn: jest.SpyInstance
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => warn.mockRestore())

  const stream = () => {
    const statuses: string[] = []
    const app = Object.assign(new EventEmitter(), {
      setProviderStatus: (_id: string, msg: string) => statuses.push(msg)
    })
    const s: any = new (ActisenseStream as any)({
      fromFile: true,
      device: '/dev/ttyUSB0',
      app
    })
    s.outAvailable = true // no transmit-list request to schedule
    statuses.length = 0
    const receive = (payload: Buffer) =>
      s._transform(answer(payload), 'binary', () => {})
    return { s, statuses, receive }
  }

  test('the gateway in NGT Transfer Rx All Mode is not warned about', () => {
    const { s, receive } = stream()
    receive(hex(capture.operatingMode))
    expect(s.gotStartupResponse).toBe(true)
    expect(warn).not.toHaveBeenCalled()
  })

  test('a gateway in another mode is warned about', () => {
    const { receive } = stream()
    receive(hex(`11 ${header} 01 00`))
    expect(warn).toHaveBeenCalledWith(
      'actisense: the gateway is in NGT Transfer Normal Mode, not NGT Transfer Rx All Mode'
    )
  })

  test('a refused Set Operating Mode is warned about, with the error', () => {
    const { receive } = stream()
    // error -1159 (0xfffffb79), "command data out of range"
    receive(hex('11 01 0e 00 ab b0 01 00 79 fb ff ff 05 00'))
    expect(warn).toHaveBeenCalledWith(
      'actisense: the gateway refused NGT Transfer Rx All Mode (error -1159); it stays in CAN Packet Mode'
    )
  })

  test('Product Info in five parts (NGT-1) is put together', () => {
    const { s, statuses, receive } = stream()
    capture.productInfo.slice(0, 4).forEach((p) => receive(hex(p)))
    expect(s.productInfo).toBeUndefined()
    receive(hex(capture.productInfo[4]))
    expect(s.productInfo).toEqual({
      model: 'NMEA 2000 PC Interface (NGT-1)',
      softwareVersion: '1.100, 2.690',
      hardwareVersion: 'NGT-1-USB  [5]',
      serialNumber: '110763',
      productCode: 0x6e27,
      nmea2000Version: 2100,
      firmware: 2690
    })
    expect(statuses).toEqual([
      'Connected to /dev/ttyUSB0: NGT-1-USB  [5], software 1.100, 2.690, serial 110763'
    ])
  })

  test('Product Info in one message (Format 2) is read', () => {
    // The SDK's Format 2 example: sequence 6, structure variant 0x11.
    const str = (text: string) =>
      Buffer.concat([Buffer.from(text), Buffer.alloc(32 - text.length, 0xff)])
    const payload = Buffer.concat([
      hex('41 06 01 00 39 30 00 00 00 00 00 00 11 00 00 00 34 08 65 00'),
      str('NGT-1'),
      str('v2.345'),
      str('Rev B'),
      str('001234'),
      hex('00 02')
    ])
    const { s, receive } = stream()
    receive(payload)
    expect(s.productInfo).toEqual({
      model: 'NGT-1',
      softwareVersion: 'v2.345',
      hardwareVersion: 'Rev B',
      serialNumber: '001234',
      productCode: 101,
      nmea2000Version: 2100,
      firmware: 2345
    })
  })
})

describe('firmwareVersion', () => {
  test.each([
    ['1.100, 2.690', 2690],
    ['v2.345', 2345],
    ['2.5', 2500],
    ['1.0.0', undefined],
    ['', undefined]
  ])('%j is %j', (software, expected) => {
    expect(firmwareVersion(software)).toBe(expected)
  })
})

interface SendTestHarness {
  instance: any
  app: EventEmitter
  writes: Buffer[]
  rawSends: string[]
}

// Build a bare ActisenseStream wired to in-memory sinks so the send-path
// prototype methods can be exercised without opening a serial port.
function makeSendInstance(): SendTestHarness {
  const app = new EventEmitter()
  const writes: Buffer[] = []
  const rawSends: string[] = []
  app.on('canboatjs:rawsend', (e: { data: string }) => rawSends.push(e.data))

  const instance: any = Object.create((ActisenseStream as any).prototype)
  instance.options = { app, providerId: 'test' }
  instance.outAvailable = true
  instance.serial = { write: (buf: Buffer) => writes.push(buf) }
  instance.debugOut = () => {}

  return { instance, app, writes, rawSends }
}

const samplePGN = {
  pgn: 127251,
  prio: 6,
  src: 17,
  dst: 200,
  fields: { rateOfTurn: 0 }
} as unknown as PGN

// Actisense CSV: <timestamp>,<prio>,<pgn>,<src>,<dst>,<len>,<bytes...>
function actisenseFields(s: string) {
  const parts = s.split(',')
  return {
    prio: Number(parts[1]),
    pgn: Number(parts[2]),
    src: Number(parts[3]),
    dst: Number(parts[4])
  }
}

describe('ActisenseStream.sendPGN', () => {
  test('preserves prio and reports the NGT-1 send-frame source', () => {
    const { instance, rawSends, writes } = makeSendInstance()
    instance.sendPGN(samplePGN)

    expect(writes).toHaveLength(1)
    expect(rawSends).toHaveLength(1)
    // src is reported as 0 because the NGT-1 transmits with its own
    // claimed N2K address; pgn.src is not forwarded on the wire.
    expect(actisenseFields(rawSends[0])).toEqual({
      prio: 6,
      pgn: 127251,
      src: 0,
      dst: 200
    })
  })

  test('falls back to defaults when prio is not provided', () => {
    const { instance, rawSends } = makeSendInstance()
    instance.sendPGN({
      pgn: 127251,
      dst: 255,
      fields: { rateOfTurn: 0 }
    } as unknown as PGN)

    expect(actisenseFields(rawSends[0])).toEqual({
      prio: 2,
      pgn: 127251,
      src: 0,
      dst: 255
    })
  })

  test('does not write when outAvailable is false', () => {
    const { instance, writes, rawSends } = makeSendInstance()
    instance.outAvailable = false
    instance.sendPGN(samplePGN)

    expect(writes).toHaveLength(0)
    expect(rawSends).toHaveLength(0)
  })

  test('emits connectionwrite when sending', () => {
    const { instance, app } = makeSendInstance()
    let connectionWrites = 0
    app.on('connectionwrite', () => connectionWrites++)
    instance.sendPGN(samplePGN)

    expect(connectionWrites).toBe(1)
  })
})

describe('ActisenseStream listener wiring', () => {
  // The listener registration lives inside start(), which opens a serial
  // port. Mirror just the listener-only portion so the event-to-method
  // routing can be verified without touching hardware.
  function wireListeners(instance: any) {
    const app: EventEmitter = instance.options.app
    app.on('nmea2000out', (msg: any) => {
      if (typeof msg === 'string') {
        instance.sendString(msg)
      } else {
        instance.sendPGN(msg)
      }
    })
    app.on('nmea2000JsonOut', (msg: PGN) => instance.sendPGN(msg))
  }

  test('routes nmea2000JsonOut events through sendPGN', () => {
    const { instance, app, rawSends } = makeSendInstance()
    wireListeners(instance)
    app.emit('nmea2000JsonOut', samplePGN)

    expect(rawSends).toHaveLength(1)
    expect(actisenseFields(rawSends[0]).prio).toBe(6)
  })

  test('routes nmea2000out string events through sendString', () => {
    const { instance, app, rawSends } = makeSendInstance()
    wireListeners(instance)
    const raw =
      '2026-05-07T20:35:05.606Z,6,61184,49,255,8,16,1c,4d,11,00,00,00,00'
    app.emit('nmea2000out', raw)

    expect(rawSends).toEqual([raw])
  })
})
