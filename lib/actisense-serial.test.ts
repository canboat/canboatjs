import { EventEmitter } from 'events'
import { ActisenseStream, composeMessage } from './actisense-serial'

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
