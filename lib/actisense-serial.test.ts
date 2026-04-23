import { composeMessage } from './actisense-serial'

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
