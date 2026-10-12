const { readN2KActisense, encodeN2KActisense } = require('./n2k-actisense')
const { actisenseToN2KActisenseFormat } = require('./toPgn')

const DLE = 0x10

/* A BDTP-framed BST-D0 message received from the bus, built from the SDK's
   description: control byte 0, time 0x12345678. */
const message = (canId, data, dst = 255) => {
  const m = [0xd0, (13 + data.length) & 0xff, (13 + data.length) >> 8, dst]
  m.push(canId & 0xff, (canId >> 8) & 0xff, (canId >> 16) & 0xff, canId >>> 24)
  m.push(0, 0x78, 0x56, 0x34, 0x12, ...data)
  m.push((256 - (m.reduce((s, b) => s + b, 0) & 0xff)) & 0xff)
  const out = [DLE, 0x02]
  for (const b of m) {
    out.push(b)
    if (b === DLE) out.push(DLE)
  }
  out.push(DLE, 0x03)
  return Buffer.from(out)
}

/* Undo the framing of an encoded message. */
const unframe = (bytes) => {
  const m = []
  for (let i = 2; i < bytes.length - 2; i += bytes[i] === DLE ? 2 : 1) {
    m.push(bytes[i])
  }
  return m
}

const read = (...chunks) => {
  const context = {}
  const got = []
  for (const chunk of chunks) {
    readN2KActisense(chunk, false, context, (m) => got.push(m))
  }
  return got.map((m) => ({
    pgn: m.pgn.pgn,
    src: m.pgn.src,
    dst: m.pgn.dst,
    data: m.data.toString('hex')
  }))
}

/* 129025 Position, Rapid Update from source 3, priority 2. */
const POSITION = 0x09f80103
const POSITION_DATA = [0x50, 0x9b, 0x3a, 0x1e, 0x2e, 0xd7, 0x0a, 0x03]
const position = {
  pgn: 129025,
  src: 3,
  dst: 255,
  data: Buffer.from(POSITION_DATA).toString('hex')
}

describe('readN2KActisense', () => {
  test('basic msg', () => {
    const buffer = Buffer.from(
      '1002d01500ff0502f809004c86fe00fffccba56800ffff7310031002d01500ff0501f809004c86fe000d474717e2da69d29c1003',
      'hex'
    )
    const res = readN2KActisense(buffer, false, {})
    delete res.pgn.timestamp
    expect(res).toEqual({
      coalesced: true,
      data: Buffer.from('0d474717e2da69d2', 'hex'),
      length: 8,
      pgn: {
        canId: 167248133,
        dst: 255,
        pgn: 129025,
        prio: 2,
        src: 5
      }
    })
    expect(read(buffer).map((m) => m.pgn)).toEqual([129026, 129025])
  })

  test('as an Actisense string', () => {
    const res = readN2KActisense(message(POSITION, POSITION_DATA), true, {})
    expect(res).toMatch(/,2,129025,3,255,8,50,9b,3a,1e,2e,d7,0a,03$/)
  })

  test('a DLE in the CAN id and the data is read back once', () => {
    // Source 0x10, PDU specific 0x10, and data of 0x10s.
    const bytes = message(0x09f81010, [DLE, DLE, DLE, DLE, DLE, DLE, DLE, 7])
    expect(read(bytes)).toEqual([
      { pgn: 129040, src: 16, dst: 255, data: '1010101010101007' }
    ])
  })

  test('the destination of a PDU1 PGN comes from the CAN id', () => {
    // The SDK's Example 2: an ISO Request at priority 6 to address 0x1f.
    expect(read(message(0x18ea1f03, [0x14, 0xf0, 0x01], 0x1f))).toEqual([
      { pgn: 59904, src: 3, dst: 0x1f, data: '14f001' }
    ])
  })

  test('a message split across reads, at any byte, is joined', () => {
    const stream = Buffer.concat([
      message(POSITION, POSITION_DATA),
      message(0x09f81010, [DLE, DLE, DLE, DLE, DLE, DLE, DLE, DLE])
    ])
    for (let cut = 0; cut <= stream.length; cut++) {
      const got = read(stream.subarray(0, cut), stream.subarray(cut))
      expect(got.map((m) => m.pgn)).toEqual([129025, 129040])
    }
  })

  test('a bad frame costs that frame only', () => {
    const good = message(0x18ea1f03, [0x14, 0xf0, 0x01], 0x1f)

    const badChecksum = message(POSITION, POSITION_DATA)
    badChecksum[badChecksum.length - 3] ^= 1
    const badLength = message(POSITION, POSITION_DATA)
    badLength[3] += 1
    const badEscape = Buffer.concat([
      message(POSITION, POSITION_DATA).subarray(0, 8),
      Buffer.from([DLE, 0x55]),
      message(POSITION, POSITION_DATA).subarray(8)
    ])
    const cutShort = message(POSITION, POSITION_DATA).subarray(0, 10)

    const stream = [Buffer.from([0xaa, DLE, 0x55])]
    for (const bad of [badChecksum, badLength, badEscape, cutShort]) {
      stream.push(bad, good)
    }
    expect(read(Buffer.concat(stream)).map((m) => m.pgn)).toEqual([
      59904, 59904, 59904, 59904
    ])
  })

  test('another BST message is skipped', () => {
    // A BEM response: A0, length 3, three bytes, checksum.
    const bem = Buffer.from([DLE, 0x02, 0xa0, 3, 0x11, 0x02, 0x00, 0x4a])
    const stream = Buffer.concat([
      bem,
      Buffer.from([DLE, 0x03]),
      message(POSITION, POSITION_DATA)
    ])
    expect(read(stream)).toEqual([position])
  })

  test('noise is not kept', () => {
    const context = {}
    for (let i = 0; i < 100; i++) {
      readN2KActisense(Buffer.alloc(1000, 0x55), false, context)
    }
    expect(context.bstD0.buf).toEqual([])
  })

  test('a run of DLEs in a frame is not kept past the longest message', () => {
    const context = {}
    readN2KActisense(Buffer.from([DLE, 0x02]), false, context)
    for (let i = 0; i < 10; i++) {
      readN2KActisense(Buffer.alloc(1000, DLE), false, context)
    }
    expect(context.bstD0.buf.length).toBeLessThanOrEqual(13 + 255 * 7 + 1)
    const got = []
    readN2KActisense(message(POSITION, POSITION_DATA), false, context, (m) =>
      got.push(m.pgn.pgn)
    )
    expect(got).toEqual([129025])
  })
})

describe('encodeN2KActisense', () => {
  test('basic msg', () => {
    // Control byte 0x08: a single frame, going to the bus.
    const expected = '1002d01500ff0501f80908000000000d474717e2da69d2641003'
    const pgn = {
      dst: 255,
      pgn: 129025,
      prio: 2,
      src: 5
    }

    const encoded = encodeN2KActisense(
      pgn,
      Buffer.from('0d474717e2da69d2', 'hex')
    )
    expect(encoded).toEqual(Buffer.from(expected, 'hex'))

    const read = readN2KActisense(encoded, false, {})
    delete read.pgn.timestamp

    expect(read).toEqual({
      coalesced: true,
      data: Buffer.from('0d474717e2da69d2', 'hex'),
      length: 8,
      pgn: {
        canId: 167248133,
        dst: 255,
        pgn: 129025,
        prio: 2,
        src: 5
      }
    })
  })

  test('a DLE is sent doubled, and the checksum is real', () => {
    const data = Buffer.from([DLE, DLE, 1, 2])
    const encoded = encodeN2KActisense(
      { pgn: 129040, src: 16, dst: 255, prio: 2 },
      data
    )
    const m = unframe(encoded)
    expect(m.reduce((s, b) => (s + b) & 0xff, 0)).toBe(0)
    expect(m.slice(1, 3)).toEqual([13 + 4, 0])
    expect(read(encoded)).toEqual([
      { pgn: 129040, src: 16, dst: 255, data: '10100102' }
    ])
  })

  test('the control byte tells the gateway how to send it', () => {
    const control = (pgn, length) =>
      unframe(
        encodeN2KActisense(
          { pgn, src: 0, dst: 255, prio: 3 },
          Buffer.alloc(length, 0x55)
        )
      )[8]
    expect(control(129025, 8)).toBe(0x08) // single frame
    expect(control(129029, 43)).toBe(0x09) // fast-packet
    expect(control(129029, 6)).toBe(0x09) // a fast-packet PGN, however short
    expect(control(129029, 224)).toBe(0x0a) // too long: ISO multi-packet
    expect(control(65535, 20)).toBe(0x0a) // not fast-packet, longer than 8
  })

  test('an Actisense string', () => {
    const encoded = actisenseToN2KActisenseFormat(
      '2017-03-13T01:00:00.146Z,2,129025,3,255,8,50,9b,3a,1e,2e,d7,0a,03'
    )
    expect(read(encoded)).toEqual([position])
  })
})
