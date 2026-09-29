import {
  parseQuickCanId,
  encodeQuickCanId,
  isExtendedCanId,
  CAN_EFF_FLAG
} from './canId'
import {
  getQuickMessageDef,
  isQuickCanId,
  getQuickCanIds,
  quickMessageRegistry
} from './quickPgns'
import { getQuickPgn } from './pgns'
import { toQuickPgn } from './toPgn'
import { Parser } from './fromPgn'
import type { QuickMessage } from './quickCan'
import { QuickCan } from './quickCan'

describe('Quick CAN ID parsing', () => {
  test('parseQuickCanId extracts 11-bit ID', () => {
    const result = parseQuickCanId(0x6c0)
    expect(result.canId).toBe(0x6c0)
    expect(result.isExtended).toBe(false)
  })

  test('parseQuickCanId masks extended IDs to 11-bit', () => {
    const result = parseQuickCanId(0x1000006c0)
    expect(result.canId).toBe(0x6c0)
    expect(result.isExtended).toBe(false)
  })

  test('encodeQuickCanId returns 11-bit value', () => {
    expect(encodeQuickCanId(0x6c0)).toBe(0x6c0)
    expect(encodeQuickCanId(0x7ff)).toBe(0x7ff)
    expect(encodeQuickCanId(0x16c0)).toBe(0x6c0) // masks to 11-bit
  })

  test('isExtendedCanId detects EFF flag', () => {
    expect(isExtendedCanId(CAN_EFF_FLAG | 0x6c0)).toBe(true)
    expect(isExtendedCanId(0x6c0)).toBe(false)
  })
})

describe('Quick PGN definitions', () => {
  test('quickMessageRegistry has all known messages', () => {
    const ids = getQuickCanIds()
    expect(ids).toContain(0x6c0)
    expect(ids).toContain(0x6c1)
    expect(ids).toContain(0x6c2)
    expect(ids).toContain(0x6c3)
    expect(ids.length).toBe(4)
  })

  test('getQuickMessageDef returns correct definition', () => {
    const def = getQuickMessageDef(0x6c0)
    expect(def).toBeDefined()
    expect(def!.id).toBe('miscFlagsPacket')
    expect(def!.canId).toBe(0x6c0)
    expect(def!.fields[0].id).toBe('sourceAddress')
    expect(def!.byteOrder).toBe('littleEndian')
  })

  test('getQuickMessageDef returns undefined for unknown CAN ID', () => {
    const def = getQuickMessageDef(0x100)
    expect(def).toBeUndefined()
  })

  test('isQuickCanId identifies Quick CAN IDs', () => {
    expect(isQuickCanId(0x6c0)).toBe(true)
    expect(isQuickCanId(0x6c3)).toBe(true)
    expect(isQuickCanId(0x100)).toBe(false)
  })

  test('every message decodes the talker identifier as its first field', () => {
    quickMessageRegistry.forEach((def) => {
      expect(def.fields[0].id).toBe('sourceAddress')
      expect(def.fields[0].bits).toBe(16)
    })
  })

  test('0x6c1 chain count packet has chainDeployed and units fields', () => {
    const def = getQuickMessageDef(0x6c1)
    expect(def).toBeDefined()
    expect(def!.fields.map((f) => f.id)).toEqual([
      'sourceAddress',
      'chainDeployed',
      'units'
    ])
    expect(def!.fields[1].bits).toBe(32)
    expect(def!.fields[2].bits).toBe(16)
  })

  test('chainDeployed carries no unit of its own', () => {
    // The sibling `units` field says meters or feet, so a unit on the value
    // itself would contradict it half the time.
    const def = getQuickMessageDef(0x6c1)
    const chainDeployed = def!.fields.find((f) => f.id === 'chainDeployed')
    expect(chainDeployed!.unit).toBeUndefined()
  })

  test('units labels match canboat (American spelling)', () => {
    const def = getQuickMessageDef(0x6c1)
    const units = def!.fields.find((f) => f.id === 'units')
    expect(units!.enumValues).toEqual({ 1: 'Meters', 2: 'Feet' })
  })
})

describe('getQuickPgn from pgns.ts', () => {
  test('returns Quick message definition', () => {
    const def = getQuickPgn(0x6c0)
    expect(def).toBeDefined()
    expect(def!.id).toBe('miscFlagsPacket')
  })

  test('returns undefined for unknown CAN ID', () => {
    const def = getQuickPgn(0x100)
    expect(def).toBeUndefined()
  })
})

describe('toQuickPgn encoding', () => {
  test('encodes source address as first uint16 LE', () => {
    const buffer = toQuickPgn(0x6c0, { sourceAddress: 0x1234 })
    expect(buffer).toBeDefined()
    expect(buffer![0]).toBe(0x34) // low byte of 0x1234
    expect(buffer![1]).toBe(0x12) // high byte of 0x1234
  })

  test('returns undefined for unknown CAN ID', () => {
    const buffer = toQuickPgn(0x100, {})
    expect(buffer).toBeUndefined()
  })

  test('encodes fields from definition', () => {
    const buffer = toQuickPgn(0x6c0, {
      sourceAddress: 0x0001,
      flags: Buffer.from('ABCD')
    })
    expect(buffer).toBeDefined()
    expect(buffer!.length).toBe(8) // 2 bytes src + 6 bytes flags (48-bit field, padded)
    // Source address
    expect(buffer![0]).toBe(0x01)
    expect(buffer![1]).toBe(0x00)
    // Flags data
    expect(buffer![2]).toBe(0x41) // 'A'
    expect(buffer![3]).toBe(0x42) // 'B'
    expect(buffer![4]).toBe(0x43) // 'C'
    expect(buffer![5]).toBe(0x44) // 'D'
  })
})

describe('FromPgn Quick protocol parsing', () => {
  let parser: Parser

  beforeEach(() => {
    parser = new Parser({
      returnNulls: true,
      useCamel: true,
      createPGNObjects: true
    })
  })

  test('parse detects Quick protocol messages', (done) => {
    const testBuffer = Buffer.alloc(8)
    testBuffer.writeUInt16LE(0x5678, 0) // source address
    testBuffer.writeUInt8(0xff, 2)
    testBuffer.writeUInt8(0xff, 3)

    parser.on('pgn', (result: any) => {
      expect(result.protocol).toBe('quick')
      expect(result.pgn).toBe(0x6c0)
      // The talker identifier is decoded from the payload, as a field.
      expect(result.fields.sourceAddress).toBe(0x5678)
      // Nothing is synthesised from the 11-bit identifier.
      expect(result.src).toBeUndefined()
      expect(result.dst).toBeUndefined()
      expect(result.prio).toBeUndefined()
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    const quickMsg: QuickMessage = {
      protocol: 'quick',
      canId: 0x6c0,
      timestamp: new Date().toISOString(),
      length: 8,
      data: testBuffer
    }

    parser.parse(quickMsg)
  })

  test('accepts a hex string payload rather than utf8-encoding it', (done) => {
    // Buffer.from(string) is utf8, so a hex string used to decode to garbage:
    // 'C1186B0000000200' became chainDeployed 1110849585.
    parser.on('pgn', (result: any) => {
      expect(result.pgn).toBe(0x6c1)
      expect(result.fields.sourceAddress).toBe(0x18c1)
      expect(result.fields.chainDeployed).toBe(107)
      expect(result.fields.units).toBe('Feet')
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    parser.parse({
      protocol: 'quick',
      canId: 0x6c1,
      timestamp: new Date().toISOString(),
      length: 8,
      data: 'C1 18 6B 00 00 00 02 00'
    } as unknown as QuickMessage)
  })

  test('parse emits error for unknown Quick CAN ID', (done) => {
    const testBuffer = Buffer.alloc(4)
    testBuffer.writeUInt16LE(0x0001, 0)

    parser.on('warning', (_pgn: any, warning: string) => {
      expect(warning).toContain('no Quick PGN definition')
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    const quickMsg: QuickMessage = {
      protocol: 'quick',
      canId: 0x100, // not a defined Quick CAN ID
      timestamp: new Date().toISOString(),
      length: 4,
      data: testBuffer
    }

    parser.parse(quickMsg)
  })

  test('parse ignores non-Quick messages', (done) => {
    let gotQuickResult = false

    parser.on('pgn', (result: any) => {
      if (result && result.protocol === 'quick') {
        gotQuickResult = true
      }
    })

    // Send an object that is NOT a Quick message - should be routed to
    // normal NMEA2000 parsing, not Quick parsing
    const nonQuickMsg = {
      pgn: 129029,
      length: 8,
      data: Buffer.alloc(8),
      coalesced: true
    }

    parser.on('error', () => {
      // Normal NMEA parsing may error with incomplete data - that's fine,
      // we just need to confirm it didn't go through Quick path
    })

    parser.parse(nonQuickMsg)

    setTimeout(() => {
      expect(gotQuickResult).toBe(false)
      done()
    }, 50)
  })

  test('decodes chain count packet 0x6c1 (talker id, 107 feet)', (done) => {
    // Payload: talker id 0x18c1 (uint16 LE), chain length 107 (uint32 LE),
    // units 2 = feet (uint16 LE).
    const testBuffer = Buffer.alloc(8)
    testBuffer.writeUInt16LE(0x18c1, 0)
    testBuffer.writeUInt32LE(107, 2)
    testBuffer.writeUInt16LE(2, 6)

    parser.on('pgn', (result: any) => {
      expect(result.protocol).toBe('quick')
      expect(result.pgn).toBe(0x6c1)
      expect(result.fields.sourceAddress).toBe(0x18c1)
      expect(result.fields.chainDeployed).toBe(107)
      expect(result.fields.units).toBe('Feet')
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    const quickMsg: QuickMessage = {
      protocol: 'quick',
      canId: 0x6c1,
      timestamp: new Date().toISOString(),
      length: 8,
      data: testBuffer
    }

    parser.parse(quickMsg)
  })

  test('decodes chain count packet with Meters units', (done) => {
    const testBuffer = Buffer.alloc(8)
    testBuffer.writeUInt16LE(0x18c1, 0)
    testBuffer.writeUInt32LE(107, 2)
    testBuffer.writeUInt16LE(1, 6) // Meters

    parser.on('pgn', (result: any) => {
      expect(result.fields.chainDeployed).toBe(107)
      expect(result.fields.units).toBe('Meters')
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    parser.parse({
      protocol: 'quick',
      canId: 0x6c1,
      timestamp: new Date().toISOString(),
      length: 8,
      data: testBuffer
    } as QuickMessage)
  })
})

describe('Quick message field encoding/decoding roundtrip', () => {
  test('encode then decode returns same source address', (done) => {
    // Encode
    const srcAddress = 0x1234
    const buffer = toQuickPgn(0x6c0, { sourceAddress: srcAddress })
    expect(buffer).toBeDefined()

    // Decode
    const parser = new Parser({ returnNulls: true, useCamel: true })

    parser.on('pgn', (result: any) => {
      expect(result.protocol).toBe('quick')
      expect(result.fields.sourceAddress).toBe(srcAddress)
      expect(result.src).toBeUndefined()
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    const quickMsg: QuickMessage = {
      protocol: 'quick',
      canId: 0x6c0,
      timestamp: new Date().toISOString(),
      length: buffer!.length,
      data: buffer!
    }

    parser.parse(quickMsg)
  })

  test('encode chain count packet with units label', () => {
    const buffer = toQuickPgn(0x6c1, {
      sourceAddress: 0x18c1,
      chainDeployed: 107,
      units: 'Feet'
    })
    expect(buffer).toBeDefined()
    // 2 bytes source + 4 bytes chain length + 2 bytes units = 8 bytes
    expect(buffer!.length).toBe(8)
    expect(buffer!.readUInt16LE(0)).toBe(0x18c1)
    expect(buffer!.readUInt32LE(2)).toBe(107)
    expect(buffer!.readUInt16LE(6)).toBe(2)
  })

  test('encodes unsigned values above the signed range', () => {
    // chainDeployed is an unsigned 32-bit field and the decoder reads it
    // unsigned, so the encoder must not clamp it to the signed range.
    const buffer = toQuickPgn(0x6c1, {
      sourceAddress: 0x18c1,
      chainDeployed: 0xffffffff,
      units: 'Meters'
    })
    expect(buffer).toBeDefined()
    expect(buffer!.readUInt32LE(2)).toBe(0xffffffff)

    const units = toQuickPgn(0x6c1, {
      sourceAddress: 0x18c1,
      chainDeployed: 0,
      units: 0x8000
    })
    expect(units).toBeDefined()
    expect(units!.readUInt16LE(6)).toBe(0x8000)
  })

  test('encodes BINARY fields as hex, matching the decoder output', () => {
    // The decoder emits BINARY values as space-separated hex, so encoding
    // has to parse them back as hex rather than writing them as ASCII.
    const buffer = toQuickPgn(0x6c0, {
      sourceAddress: 0x18c0,
      flags: '01 02 03 04 05 06'
    })
    expect(buffer).toBeDefined()
    expect(buffer!.readUInt16LE(0)).toBe(0x18c0)
    expect(buffer!.slice(2, 8).toString('hex')).toBe('010203040506')
  })

  test('encode then decode chain count packet roundtrip', (done) => {
    const buffer = toQuickPgn(0x6c1, {
      sourceAddress: 0x18c1,
      chainDeployed: 107,
      units: 'Feet'
    })
    expect(buffer).toBeDefined()

    const parser = new Parser({ returnNulls: true, useCamel: true })

    parser.on('pgn', (result: any) => {
      expect(result.fields.chainDeployed).toBe(107)
      expect(result.fields.units).toBe('Feet')
      done()
    })

    parser.on('error', (_pgn: any, error: any) => {
      done(error)
    })

    parser.parse({
      protocol: 'quick',
      canId: 0x6c1,
      timestamp: new Date().toISOString(),
      length: buffer!.length,
      data: buffer!
    } as QuickMessage)
  })
})

describe('QuickCan.sendPGN', () => {
  // sendPGN used to run its own copy of the encoder, which drifted from
  // toQuickPgn: LOOKUP labels became NaN (written as 0) and BINARY values
  // were written as ASCII instead of hex. Pin the send path to the shared
  // encoder so the two cannot diverge again.
  const makeSender = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quickCan: any = new (QuickCan as any)(
      { createDebug: () => () => undefined },
      () => undefined
    )
    quickCan.channel = { send: jest.fn() }
    return quickCan
  }

  test('resolves LOOKUP labels when sending', () => {
    const quickCan = makeSender()

    quickCan.sendPGN({
      canId: 0x6c1,
      fields: { sourceAddress: 0x18c1, chainDeployed: 107, units: 'Feet' }
    })

    expect(quickCan.channel.send).toHaveBeenCalledTimes(1)
    const sent = quickCan.channel.send.mock.calls[0][0]
    expect(sent.ext).toBe(false)
    expect(sent.data.readUInt16LE(0)).toBe(0x18c1)
    expect(sent.data.readUInt32LE(2)).toBe(107)
    expect(sent.data.readUInt16LE(6)).toBe(2)
  })

  test('writes BINARY fields as hex when sending', () => {
    const quickCan = makeSender()

    quickCan.sendPGN({
      canId: 0x6c0,
      fields: { sourceAddress: 0x18c0, flags: '01 02 03 04 05 06' }
    })

    const sent = quickCan.channel.send.mock.calls[0][0]
    expect(sent.data.slice(2, 8).toString('hex')).toBe('010203040506')
  })

  test('fills an omitted source address with 0xFF like any other field', () => {
    const quickCan = makeSender()

    quickCan.sendPGN({
      canId: 0x6c0,
      fields: { flags: '01 02 03 04 05 06' }
    })

    const sent = quickCan.channel.send.mock.calls[0][0]
    expect(sent.data.readUInt16LE(0)).toBe(0xffff)
  })

  test('sends a raw buffer unchanged when data is supplied', () => {
    const quickCan = makeSender()
    const raw = Buffer.from([1, 2, 3, 4])

    quickCan.sendPGN({ canId: 0x6c0, data: raw })

    const sent = quickCan.channel.send.mock.calls[0][0]
    expect(sent.data).toBe(raw)
  })
})
