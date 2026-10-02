/**
 * Copyright 2026 Scott Bender (scott@scottbender.net)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Fast-packet and ISO Transport Protocol reassembly, a port of canboat's
 * crates/canboat/src/engine/reassembly.rs so both put the same frames
 * together into the same messages.
 *
 * NMEA 2000 fast-packet PGNs are split across up to 32 CAN frames. The first
 * byte of each frame is a header: bits 7..5 a sequence counter (rotating per
 * PGN and source), bits 4..0 the frame index. Frame 0 carries the total
 * payload length and 6 bytes of payload; later frames carry 7 each. Frames
 * are slotted in by index, so a message whose frames arrive out of order (a
 * YDWG delivers them reordered) still assembles.
 *
 * ISO TP (PGN 60416 TP.CM and 60160 TP.DT) carries messages too long for
 * fast-packet, e.g. PGN 129540 from a GNSS with many satellites, and J1939
 * diagnostics. The transport frames are plumbing: they are swallowed, and
 * the carried PGN is emitted once every packet is in.
 */

import createDebug from 'debug'

const debug = createDebug('canboatjs:reassembly')

const REASSEMBLY_BUFFER_SIZE = 64
const BUCKET_0_SIZE = 6
const BUCKET_N_SIZE = 7
const BUCKET_0_OFFSET = 2
const BUCKET_N_OFFSET = 1
const FASTPACKET_MAX_INDEX = 0x1f
/** canboat's FASTPACKET_MAX_SIZE: 6 + 31 * 7. */
const FASTPACKET_MAX_SIZE = BUCKET_0_SIZE + FASTPACKET_MAX_INDEX * BUCKET_N_SIZE

export const PGN_ISO_TP_CM = 60416
export const PGN_ISO_TP_DT = 60160
const TP_CM_BAM = 32
const TP_CM_RTS = 16
const TP_CM_ABORT = 255
/** Slots for in-flight ISO TP sessions, one per source. */
const ISO_TP_SLOTS = 16
/** Absolute upper bound on a TP payload: 255 packets of 7 bytes. */
const ISO_TP_MAX_SIZE = 255 * BUCKET_N_SIZE

/** One CAN frame, or a reassembled message. */
export interface Frame {
  pgn: number
  src: number
  dst: number
  prio: number
  timestamp?: any
  data: Buffer
  /** The input lines this frame or message came from. */
  input?: string[]
}

export type PacketType = 'Single' | 'Fast' | 'Other'

export type Reassembled =
  /** Not fast-packet, or already coalesced: the frame unchanged. */
  | { kind: 'pass'; frame: Frame }
  /** A message is complete. */
  | { kind: 'complete'; frame: Frame }
  /** More frames needed. */
  | { kind: 'partial' }
  /** Empty frame, or no slot available. */
  | { kind: 'error'; message: string }

interface Slot {
  used: boolean
  pgn: number
  src: number
  seq: number
  /** Bitmask of frame indices received so far. */
  frames: number
  /** Bitmask of frame indices required to complete. */
  allFrames: number
  /** Total payload size from frame 0's length byte. */
  size: number
  /** Claim order, to evict the oldest slot when all are in use. */
  age: number
  data: Buffer
  input: string[]
}

interface TpSlot {
  used: boolean
  src: number
  dst: number
  prio: number
  targetPgn: number
  totalSize: number
  packets: number
  /** Received sequence numbers: bit n = sequence n + 1. */
  received: bigint
  timestamp?: any
  data: Buffer
  age: number
  input: string[]
}

const freeSlot = (): Slot => ({
  used: false,
  pgn: 0,
  src: 0,
  seq: 0,
  frames: 0,
  allFrames: 0,
  size: 0,
  age: 0,
  data: Buffer.alloc(FASTPACKET_MAX_SIZE),
  input: []
})

const freeTpSlot = (): TpSlot => ({
  used: false,
  src: 0,
  dst: 0,
  prio: 0,
  targetPgn: 0,
  totalSize: 0,
  packets: 0,
  received: 0n,
  data: Buffer.alloc(0),
  age: 0,
  input: []
})

const popcount = (n: number): number => {
  let c = 0
  for (let v = n >>> 0; v; v &= v - 1) {
    c++
  }
  return c
}

/** `0b101101` -> "0,2,3,5", for the incomplete-message warning. */
const describeFrames = (bits: number): string => {
  const set: number[] = []
  for (let i = 0; i <= FASTPACKET_MAX_INDEX; i++) {
    if ((bits >>> i) & 1) {
      set.push(i)
    }
  }
  return set.length ? set.join(',') : 'none'
}

const describeExpectation = (
  allFrames: number,
  size: number,
  frames: number
): string => {
  if (allFrames === 0) {
    return ', declared total size unknown (frame 0 not yet received)'
  }
  const missing = (allFrames & ~frames) >>> 0
  const total = popcount(allFrames)
  const s = total === 1 ? '' : 's'
  return missing === 0
    ? `, expected ${total} frame${s} (declared size ${size} bytes), all of them present`
    : `, expected ${total} frame${s} (declared size ${size} bytes), still missing {${describeFrames(missing)}}`
}

/** Fast-packet + ISO Transport Protocol reassembler. */
export class Reassembler {
  private slots: Slot[] = Array.from(
    { length: REASSEMBLY_BUFFER_SIZE },
    freeSlot
  )
  private tpSlots: TpSlot[] = Array.from({ length: ISO_TP_SLOTS }, freeTpSlot)
  private nextAge = 0
  private tpNextAge = 0

  /**
   * Push one CAN frame. `packetType` comes from the PGN definition; pass
   * 'Other' for an unknown PGN and the frame passes through untouched.
   */
  push(frame: Frame, packetType: PacketType): Reassembled {
    // ISO TP frames are single-frame PGNs on the wire, but plumbing for a
    // larger message: swallow them and emit the carried PGN when complete.
    if (frame.pgn === PGN_ISO_TP_CM) {
      return this.handleTpCm(frame)
    }
    if (frame.pgn === PGN_ISO_TP_DT) {
      return this.handleTpDt(frame)
    }

    // Coalesced payloads (len > 8) and non-fast-packet PGNs pass through.
    if (frame.data.length > 8 || packetType !== 'Fast') {
      return { kind: 'pass', frame }
    }
    if (frame.data.length === 0) {
      return {
        kind: 'error',
        message: 'fast-packet frame received with empty data'
      }
    }

    const header = frame.data[0]
    const frameIndex = header & 0x1f
    const seq = header & 0xe0

    let slotIdx = this.findSlot(frame.pgn, frame.src, seq)
    if (slotIdx === undefined) {
      slotIdx = this.claimSlot(frame.pgn, frame.src, seq)
    }
    const slot = this.slots[slotIdx]

    // A duplicate frame index, or a frame 0 that would complete instantly
    // off bits held from an earlier burst, means the slot holds an earlier
    // message: restart it with this frame. A genuinely reordered burst still
    // has frames in flight when its frame 0 lands, so it completes on a later
    // index; stale leftovers satisfy the mask the moment frame 0 arrives. A
    // payload of 6 bytes or less legitimately completes on frame 0 alone.
    // (See reassembly.rs for the full reasoning.)
    const stale = slot.frames
    const duplicate = ((stale >>> frameIndex) & 1) !== 0

    let declared: { size: number; allFrames: number } | undefined
    if (frameIndex === 0) {
      const size = Math.min(frame.data[1] ?? 0, FASTPACKET_MAX_SIZE)
      // Frames needed = 1 + size / 7 (integer division), as canboat.
      const needed = Math.min(
        1 + Math.floor(size / BUCKET_N_SIZE),
        FASTPACKET_MAX_INDEX + 1
      )
      const allFrames =
        needed === 0 ? 0 : needed >= 32 ? 0xffffffff : (1 << needed) - 1
      declared = { size, allFrames: allFrames >>> 0 }
    }
    const completesInstantly =
      declared !== undefined &&
      !duplicate &&
      stale !== 0 &&
      declared.allFrames !== 1 &&
      ((stale | 1) & declared.allFrames) >>> 0 === declared.allFrames

    if (duplicate || completesInstantly) {
      debug(
        `Incomplete fast packet pgn=${frame.pgn} src=${frame.src} ` +
          `seq=0x${seq.toString(16).padStart(2, '0')}: frame index ${frameIndex} ` +
          `${duplicate ? 'arrived again' : 'started a new message'} before the ` +
          `sequence completed. Already received frame` +
          `${popcount(slot.frames) === 1 ? '' : 's'} {${describeFrames(slot.frames)}}` +
          `${describeExpectation(slot.allFrames, slot.size, slot.frames)}. ` +
          'Restarting assembly with this frame.'
      )
      slot.frames = 0
      slot.input = []
    }

    if (declared !== undefined) {
      slot.size = declared.size
      slot.allFrames = declared.allFrames
    }

    // Copy this frame's payload in at its offset. Missing trailing bytes
    // are padded with 0xff, as canboat does for a truncated frame.
    const [dstOff, srcOff, bucketLen] =
      frameIndex === 0
        ? [0, BUCKET_0_OFFSET, BUCKET_0_SIZE]
        : [
            BUCKET_0_SIZE + (frameIndex - 1) * BUCKET_N_SIZE,
            BUCKET_N_OFFSET,
            BUCKET_N_SIZE
          ]
    const end = Math.min(dstOff + bucketLen, FASTPACKET_MAX_SIZE)
    const capacity = Math.max(end - dstOff, 0)
    const copyLen = Math.min(Math.max(frame.data.length - srcOff, 0), capacity)
    if (copyLen > 0) {
      frame.data.copy(slot.data, dstOff, srcOff, srcOff + copyLen)
    }
    if (copyLen < capacity) {
      slot.data.fill(0xff, dstOff + copyLen, end)
    }
    slot.frames = (slot.frames | (1 << frameIndex)) >>> 0
    if (frame.input) {
      slot.input.push(...frame.input)
    }

    if (slot.allFrames !== 0 && slot.frames === slot.allFrames) {
      const message: Frame = {
        timestamp: frame.timestamp,
        prio: frame.prio,
        pgn: frame.pgn,
        src: frame.src,
        dst: frame.dst,
        data: Buffer.from(slot.data.subarray(0, slot.size)),
        input: slot.input
      }
      slot.used = false
      slot.frames = 0
      slot.size = 0
      slot.input = []
      return { kind: 'complete', frame: message }
    }
    return { kind: 'partial' }
  }

  /**
   * A PGN 60416 TP.CM frame. BAM and RTS open a session for this source;
   * Abort closes one; CTS / EOM are peer responses a monitor ignores.
   */
  private handleTpCm(frame: Frame): Reassembled {
    if (frame.data.length === 0) {
      return {
        kind: 'error',
        message: 'fast-packet frame received with empty data'
      }
    }
    const control = frame.data[0]
    if (control === TP_CM_ABORT) {
      const i = this.findTpSlot(frame.src)
      if (i !== undefined) {
        this.tpSlots[i].used = false
      }
      return { kind: 'partial' }
    }
    if (control !== TP_CM_BAM && control !== TP_CM_RTS) {
      return { kind: 'partial' }
    }
    if (frame.data.length < 8) {
      debug(
        `ISO TP CM frame from src=${frame.src} has ${frame.data.length} bytes (need 8); dropping`
      )
      return { kind: 'partial' }
    }
    const totalSize = frame.data.readUInt16LE(1)
    const packets = frame.data[3]
    const targetPgn =
      frame.data[5] | (frame.data[6] << 8) | (frame.data[7] << 16)
    if (packets === 0 || totalSize === 0 || totalSize > ISO_TP_MAX_SIZE) {
      debug(
        `ISO TP CM from src=${frame.src} declares implausible size=${totalSize} packets=${packets}; dropping`
      )
      return { kind: 'partial' }
    }
    const slot = this.tpSlots[this.claimTpSlot(frame.src)]
    slot.dst = frame.dst
    slot.prio = frame.prio
    slot.targetPgn = targetPgn
    slot.totalSize = totalSize
    slot.packets = packets
    slot.received = 0n
    slot.timestamp = frame.timestamp
    slot.data = Buffer.alloc(totalSize, 0xff)
    slot.input = frame.input ? [...frame.input] : []
    return { kind: 'partial' }
  }

  /**
   * A PGN 60160 TP.DT frame: copy its 7 bytes in at (sequence - 1) * 7, and
   * emit the carried PGN once every declared sequence has arrived. A DT with
   * no open session is swallowed (the CM was missed).
   */
  private handleTpDt(frame: Frame): Reassembled {
    if (frame.data.length === 0) {
      return {
        kind: 'error',
        message: 'fast-packet frame received with empty data'
      }
    }
    const i = this.findTpSlot(frame.src)
    if (i === undefined) {
      debug(`ISO TP DT from src=${frame.src} with no open session; dropping`)
      return { kind: 'partial' }
    }
    const slot = this.tpSlots[i]
    const sequence = frame.data[0]
    if (sequence === 0 || sequence > slot.packets) {
      debug(
        `ISO TP DT src=${frame.src} seq=${sequence} out of range 1..=${slot.packets}; dropping`
      )
      return { kind: 'partial' }
    }
    const zeroBased = sequence - 1
    slot.received |= 1n << BigInt(zeroBased)
    const offset = zeroBased * BUCKET_N_SIZE
    const end = Math.min(offset + BUCKET_N_SIZE, slot.totalSize)
    const n = Math.min(Math.max(end - offset, 0), frame.data.length - 1)
    if (n > 0) {
      frame.data.copy(slot.data, offset, 1, 1 + n)
    }
    if (frame.input) {
      slot.input.push(...frame.input)
    }

    const all = (1n << BigInt(slot.packets)) - 1n
    if ((slot.received & all) !== all) {
      return { kind: 'partial' }
    }
    const message: Frame = {
      timestamp: slot.timestamp,
      prio: slot.prio,
      pgn: slot.targetPgn,
      src: frame.src,
      dst: slot.dst,
      data: Buffer.from(slot.data.subarray(0, slot.totalSize)),
      input: slot.input
    }
    slot.used = false
    slot.timestamp = undefined
    slot.input = []
    return { kind: 'complete', frame: message }
  }

  private findTpSlot(src: number): number | undefined {
    const i = this.tpSlots.findIndex((s) => s.used && s.src === src)
    return i === -1 ? undefined : i
  }

  /**
   * Reuse this source's session (one per source), else a free slot, else
   * evict the oldest.
   */
  private claimTpSlot(src: number): number {
    const existing = this.findTpSlot(src)
    this.tpNextAge++
    if (existing !== undefined) {
      const slot = this.tpSlots[existing]
      slot.src = src
      slot.age = this.tpNextAge
      slot.used = true
      return existing
    }
    let idx = this.tpSlots.findIndex((s) => !s.used)
    if (idx === -1) {
      idx = this.oldest(this.tpSlots)
    }
    this.tpSlots[idx] = {
      ...freeTpSlot(),
      used: true,
      src,
      age: this.tpNextAge
    }
    return idx
  }

  private findSlot(pgn: number, src: number, seq: number): number | undefined {
    const i = this.slots.findIndex(
      (s) => s.used && s.pgn === pgn && s.src === src && s.seq === seq
    )
    return i === -1 ? undefined : i
  }

  /** Prefer an unused slot; otherwise evict the one claimed longest ago. */
  private claimSlot(pgn: number, src: number, seq: number): number {
    let idx = this.slots.findIndex((s) => !s.used)
    if (idx === -1) {
      idx = this.oldest(this.slots)
    }
    const slot = this.slots[idx]
    slot.used = true
    slot.pgn = pgn
    slot.src = src
    slot.seq = seq
    slot.frames = 0
    slot.allFrames = 0
    slot.size = 0
    slot.age = this.nextAge++
    slot.data.fill(0)
    slot.input = []
    return idx
  }

  private oldest(slots: { age: number }[]): number {
    let idx = 0
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].age < slots[idx].age) {
        idx = i
      }
    }
    return idx
  }
}
