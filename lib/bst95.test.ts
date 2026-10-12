import fs from 'fs'
import path from 'path'
import { readBst95, encodeBst95, Bst95Frame } from './bst95'
import { Parser as FromPgn } from './fromPgn'
import { parseActisense } from './stringMsg'

const DLE = 0x10

/* canboat's analyzer/tests: pgn-test.in's 31 messages, written as 115
   BST-95 frames by canboat (canboat/canboat#1027). */
const DATA = path.join(__dirname, '../test/data/bst-95')
const capture = fs.readFileSync(path.join(DATA, 'pgn-test-bst-95.bin'))
const lines = fs
  .readFileSync(path.join(DATA, 'pgn-test.in'), 'utf8')
  .split('\n')
  .filter((l) => l.length > 0 && !l.startsWith('#'))

const frames = (...chunks: Buffer[]) => {
  const context = {}
  const got: Bst95Frame[] = []
  for (const chunk of chunks) {
    readBst95(chunk, context, (f) => got.push(f))
  }
  return got
}

/* What a gateway sends for a frame from the bus: as encodeBst95 writes it,
   with the direction bit (in DPPC) cleared. */
const fromBus = (encoded: Buffer) => {
  const m: number[] = []
  for (let i = 2; i < encoded.length - 2; i += encoded[i] === DLE ? 2 : 1) {
    m.push(encoded[i])
  }
  m[7] &= 0x7f
  m[m.length - 1] = (m[m.length - 1] + 0x80) & 0xff
  const out = [DLE, 0x02]
  for (const b of m) {
    out.push(b)
    if (b === DLE) out.push(DLE)
  }
  out.push(DLE, 0x03)
  return Buffer.from(out)
}

/* What the analyzer decoded, without what it copies from its input. */
const decoded = (msg: any) =>
  msg && {
    pgn: msg.pgn,
    src: msg.src,
    dst: msg.dst,
    prio: msg.prio,
    description: msg.description,
    fields: msg.fields
  }

describe('readBst95', () => {
  test("canboat's capture decodes exactly as pgn-test.in", () => {
    const got = frames(capture)
    expect(got).toHaveLength(115)

    const fromFrames: any[] = []
    const parser = new FromPgn({})
    for (const f of got) {
      const msg = parser.parse({ pgn: f, length: f.data.length, data: f.data })
      if (msg) {
        fromFrames.push(decoded(msg))
      }
    }
    // pgn-test.in holds whole messages, an 8-byte fast-packet one too.
    const fromLines = lines.map((l) => {
      const m = parseActisense(l)
      return decoded(
        new FromPgn({}).parse({
          pgn: m,
          length: m.data.length,
          data: m.data,
          coalesced: true
        })
      )
    })
    expect(fromLines).toHaveLength(31)
    expect(fromFrames).toEqual(fromLines)
  })

  test('a capture split across reads, at any byte, gives the same frames', () => {
    const whole = frames(capture).map((f) => f.data.toString('hex'))
    for (let cut = 0; cut <= capture.length; cut += 7) {
      const got = frames(capture.subarray(0, cut), capture.subarray(cut))
      expect(got.map((f) => f.data.toString('hex'))).toEqual(whole)
    }
  })

  test('the destination of a PDU1 PGN comes from the CAN id', () => {
    // ISO Request (59904) from 3 to 0x23, priority 6.
    const sent = encodeBst95(
      { pgn: 59904, src: 3, dst: 0x23, prio: 6 },
      Buffer.from([0x14, 0xf0, 0x01])
    )
    const [f] = frames(fromBus(sent))
    expect([f.pgn, f.src, f.dst, f.prio]).toEqual([59904, 3, 0x23, 6])
    expect(f.data).toEqual(Buffer.from([0x14, 0xf0, 0x01]))
  })

  test("the gateway's echo of a frame we sent is skipped", () => {
    const sent = encodeBst95(
      { pgn: 129025, src: 16, dst: 255, prio: 2 },
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])
    )
    expect(frames(sent)).toEqual([])
    expect(frames(fromBus(sent)).map((f) => [f.pgn, f.src])).toEqual([
      [129025, 16]
    ])
  })

  test('a bad frame costs that frame only; other BST messages are skipped', () => {
    const good = capture.subarray(0, capture.indexOf(Buffer.from([DLE, 3])) + 2)
    const badChecksum = Buffer.from(good)
    badChecksum[badChecksum.length - 3] ^= 1
    const badLength = Buffer.from(good)
    badLength[3] += 1
    // A BEM answer: A0, length 3, three bytes, checksum.
    const bem = Buffer.from([
      DLE,
      0x02,
      0xa0,
      3,
      0x11,
      0x02,
      0x00,
      0x4a,
      DLE,
      3
    ])
    const got = frames(
      Buffer.concat([badChecksum, good, badLength, good, bem, good])
    )
    expect(got).toHaveLength(3)
  })
})

describe('encodeBst95', () => {
  test('writes the SDK layout, going to the bus, with DLEs doubled', () => {
    // 129025 from source 0x10, priority 2: S PDUS PDUF DPPC = 10 01 f8 89.
    const encoded = encodeBst95(
      { pgn: 129025, src: 0x10, dst: 255, prio: 2 },
      Buffer.from([0x10, 1, 2, 3, 4, 5, 6, 7])
    )
    expect(encoded.toString('hex')).toBe(
      '1002950e0000' +
        '1010' +
        '01f889' +
        '1010' +
        '01020304050607' +
        '9f' +
        '1003'
    )
  })

  test('refuses more than one CAN frame of data', () => {
    expect(() =>
      encodeBst95({ pgn: 129029, src: 1, dst: 255, prio: 3 }, Buffer.alloc(9))
    ).toThrow(/one CAN frame/)
  })
})
