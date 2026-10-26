// CanChannel's excludePgns: PGNs dropped by the kernel's CAN RX filter.

const native = {
  filterCalls: [] as { fd: number; filters: Buffer }[],
  filterThrows: undefined as string | undefined,
  oldAddon: false
}

jest.mock('node-gyp-build', () => () => ({
  openCanReadSocket: () => 100,
  openCanWriteSocket: () => 101,
  readCanFrames: () => [],
  writeCanFrame: () => 16,
  get setCanReadFilter() {
    return native.oldAddon ? undefined : setCanReadFilter
  },
  CanPoller: class {
    close() {}
  }
}))

function setCanReadFilter(fd: number, filters: Buffer) {
  if (native.filterThrows) {
    throw new Error(native.filterThrows)
  }
  native.filterCalls.push({ fd, filters })
}

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  closeSync: () => undefined
}))

import { CanChannel, excludePgnFilters } from './canSocket'
import { parseExcludePgns } from './excludePgns'

const CAN_EFF_FLAG = 0x80000000
const CAN_INV_FILTER = 0x20000000

// struct can_filter is native-endian; read it as the kernel on a
// little-endian host does.
const readFilters = (buf: Buffer) => {
  const out = []
  for (let o = 0; o < buf.length; o += 8) {
    out.push({ id: buf.readUInt32LE(o), mask: buf.readUInt32LE(o + 4) })
  }
  return out
}

/* The kernel's test for a frame against joined filters: every filter must
   match, an inverted one by not matching (net/can/af_can.c can_rcv_list_find
   and can_rcv_filter; net/can/raw.c raw_rcv with CAN_RAW_JOIN_FILTERS). */
const kernelPasses = (frameId: number, buf: Buffer) =>
  readFilters(buf).every(({ id, mask }) => {
    const inv = (id & CAN_INV_FILTER) !== 0
    const fid = id & ~CAN_INV_FILTER
    const match = (frameId & mask) >>> 0 === (fid & mask) >>> 0
    return inv ? !match : match
  })

/* A 29-bit N2K frame identifier, as the kernel sees it (with CAN_EFF_FLAG). */
const frameId = (pgn: number, src: number, dst = 255, prio = 3) => {
  const pf = (pgn >> 8) & 0xff
  const ps = pf < 240 ? dst : pgn & 0xff
  const id =
    (prio << 26) | ((pgn >> 16) << 24) | (pf << 16) | (ps << 8) | (src & 0xff)
  return (id | CAN_EFF_FLAG) >>> 0
}

const NETWORK_MANAGEMENT = [
  59392, 59904, 60160, 60416, 60928, 65240, 126208, 126464, 126993, 126996,
  126998
]

describe('excludePgnFilters', () => {
  test('a PDU2 PGN is matched on all 18 PGN bits, inverted', () => {
    const [f] = readFilters(excludePgnFilters([130824]))
    expect(f.id).toBe(((130824 << 8) | CAN_EFF_FLAG | CAN_INV_FILTER) >>> 0)
    expect(f.mask).toBe((0x3ffff00 | CAN_EFF_FLAG) >>> 0)
  })

  test('a PDU1 PGN is matched without its destination byte', () => {
    const [f] = readFilters(excludePgnFilters([126208]))
    expect(f.mask).toBe((0x3ff0000 | CAN_EFF_FLAG) >>> 0)
    expect((f.id & 0x3ffffff) >>> 0).toBe(0x1ed0000)
  })

  test('the kernel drops the excluded PGNs from every source and passes the rest', () => {
    const buf = excludePgnFilters([130824, 127251, 129540, 126720])
    for (const src of [0, 28, 127, 253]) {
      expect(kernelPasses(frameId(130824, src), buf)).toBe(false)
      expect(kernelPasses(frameId(127251, src), buf)).toBe(false)
      expect(kernelPasses(frameId(129540, src), buf)).toBe(false)
      for (const dst of [0, 35, 255]) {
        expect(kernelPasses(frameId(126720, src, dst), buf)).toBe(false)
      }
      for (const pgn of [129025, 129026, 127250, 130306, 128259, 129038]) {
        expect(kernelPasses(frameId(pgn, src), buf)).toBe(true)
      }
      for (const pgn of NETWORK_MANAGEMENT) {
        expect(kernelPasses(frameId(pgn, src, 35), buf)).toBe(true)
      }
    }
  })

  test('PF 239 is PDU1 and PF 240 PDU2', () => {
    const buf = excludePgnFilters([61184, 61440])
    expect(kernelPasses(frameId(61184, 1, 7), buf)).toBe(false)
    expect(kernelPasses(frameId(61440, 1), buf)).toBe(false)
    expect(kernelPasses(frameId(61441, 1), buf)).toBe(true)
  })

  test('a PDU2 PGN ending in 00 drops only itself', () => {
    const buf = excludePgnFilters([65280, 130816])
    expect(kernelPasses(frameId(65280, 1), buf)).toBe(false)
    expect(kernelPasses(frameId(130816, 1), buf)).toBe(false)
    expect(kernelPasses(frameId(65281, 1), buf)).toBe(true)
    expect(kernelPasses(frameId(130817, 1), buf)).toBe(true)
  })

  test('the lowest and highest PGN, and 11-bit frames still pass', () => {
    const buf = excludePgnFilters([0, 0x1ffff])
    expect(kernelPasses(frameId(0, 1, 9), buf)).toBe(false)
    expect(kernelPasses(frameId(0x1ffff, 1), buf)).toBe(false)
    expect(kernelPasses(0x123, buf)).toBe(true)
    // Below 0x100 an 11-bit id would look like PGN 0 without CAN_EFF_FLAG
    // in the mask.
    expect(kernelPasses(0x05, excludePgnFilters([0]))).toBe(true)
  })
})

describe('excludePgnFilters with parseExcludePgns', () => {
  test('never drops network management, also not through a PDU1 destination byte', () => {
    for (const pgn of NETWORK_MANAGEMENT) {
      expect(parseExcludePgns([pgn]).pgns).toEqual([])
      // For a PDU1 PGN, 59905 would make the same filter as 59904 (ISO
      // Request). For a PDU2 PGN, +1 is just another PGN.
      if (((pgn >> 8) & 0xff) < 240) {
        expect(parseExcludePgns([pgn + 1]).pgns).toEqual([])
      }
    }
    for (const pgn of NETWORK_MANAGEMENT) {
      const buf = excludePgnFilters(
        parseExcludePgns(NETWORK_MANAGEMENT.map((p) => p + 1)).pgns
      )
      expect(kernelPasses(frameId(pgn, 5, 35), buf)).toBe(true)
    }
  })
})

describe('CanChannel excludePgns', () => {
  beforeEach(() => {
    native.filterCalls = []
    native.filterThrows = undefined
    native.oldAddon = false
  })

  test('without excludePgns the read socket keeps the full filter', () => {
    new CanChannel('can0').stop()
    new CanChannel('can0', { excludePgns: [] }).stop()
    expect(native.filterCalls).toHaveLength(0)
  })

  test('sets the filters on the read socket', () => {
    const channel = new CanChannel('can0', { excludePgns: [130824, 127251] })
    expect(channel.excludedPgns).toEqual([130824, 127251])
    channel.stop()
    expect(native.filterCalls).toHaveLength(1)
    expect(native.filterCalls[0].fd).toBe(100)
    expect(native.filterCalls[0].filters).toEqual(
      excludePgnFilters([130824, 127251])
    )
  })

  test('nothing to set when every entry is skipped', () => {
    const channel = new CanChannel('can0', { excludePgns: [59904, 'abc'] })
    expect(channel.excludedPgns).toEqual([])
    expect(channel.filterError).toBeUndefined()
    expect(native.filterCalls).toHaveLength(0)
    channel.stop()
  })

  test('gives the kernel the first 512 PGNs', () => {
    // 129024-129536: all PDU2, none of them network management.
    const many = Array.from({ length: 513 }, (_, i) => 129024 + i)
    const channel = new CanChannel('can0', { excludePgns: many })
    expect(channel.excludedPgns).toEqual(many.slice(0, 512))
    expect(native.filterCalls[0].filters).toHaveLength(512 * 8)
    channel.stop()
  })

  test('takes excludePgns as a string too', () => {
    const channel = new CanChannel('can0', { excludePgns: '130824 127251' })
    expect(channel.excludedPgns).toEqual([130824, 127251])
    channel.stop()
  })

  test('a filter the kernel refuses leaves the socket reading everything', () => {
    native.filterThrows =
      'setsockopt(CAN_RAW_JOIN_FILTERS): Protocol not available'
    const channel = new CanChannel('can0', { excludePgns: [130824] })
    expect(channel.excludedPgns).toEqual([])
    expect(channel.filterError).toMatch(/Protocol not available/)
    channel.stop()
  })

  test('an addon without setCanReadFilter leaves the socket reading everything', () => {
    native.oldAddon = true
    const channel = new CanChannel('can0', { excludePgns: [130824] })
    expect(channel.excludedPgns).toEqual([])
    expect(channel.filterError).toMatch(/too old, rebuild/)
    channel.stop()
  })
})
