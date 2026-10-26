/**
 * Minimal CAN socket wrapper using uv_poll_t-based reads.
 *
 * The native addon (native/canSocket.cpp) opens PF_CAN sockets in non-blocking
 * mode and exposes a CanPoller class that registers a uv_poll_t watcher on the
 * read fd. When frames are readable, the watcher invokes a JS callback that
 * drains all available frames via a non-blocking native read. Writes also use
 * a non-blocking native write so neither direction ever occupies a libuv
 * threadpool worker — this keeps the threadpool free for fs operations and
 * lets process.exit() terminate cleanly without hanging on a blocked syscall.
 *
 * Reads and writes use separate CAN sockets bound to the same interface:
 * by default the read socket has the full RX filter, the write socket has an
 * empty RX filter so the kernel doesn't queue frames into a buffer nobody
 * reads. The read socket can be told to drop PGNs in the kernel
 * (excludePgns), so frames nobody wants cost no JavaScript at all.
 *
 * Copyright 2025 Signal K contributors
 * Licensed under the Apache License, Version 2.0
 */

import { EventEmitter } from 'events'
import { closeSync } from 'fs'
import { constants } from 'os'
import { join } from 'path'
import { parseExcludePgns } from './excludePgns'

const CAN_EFF_FLAG = 0x80000000
const CAN_EFF_MASK = 0x1fffffff
const CAN_INV_FILTER = 0x20000000
const CAN_FILTER_SIZE = 8 // sizeof(struct can_filter)
// Each excluded PGN is one CAN filter, and the kernel takes at most 512 per
// socket (linux/can/raw.h, since Linux 4.12); canboatjs keeps to that on any
// kernel. FromPgn still drops the PGNs past it.
export const CAN_RAW_FILTER_MAX = 512
// The PGN is in bits 8-25 of the 29-bit identifier: extended data page,
// data page, PF and PS. NMEA 2000, like J1939, has two kinds of PGN:
// - PDU2 (PF 240 and up) is broadcast, and PS is part of the PGN: 127250 is
//   0x1F112.
// - PDU1 (PF below 240) is sent to one device, and PS is that device's
//   address, not part of the PGN. These PGNs end in 00 in hex: an ISO
//   Request (59904, 0xEA00) to device 0x23 has 0xEA23 in its identifier.
// So for PDU1 only bits 16-25 name the PGN.
const PGN_MASK_PDU2 = 0x3ffff00
const PGN_MASK_PDU1 = 0x3ff0000
const CAN_FRAME_SIZE = 16 // sizeof(struct can_frame)
const CAN_DATA_OFFSET = 8

// A write the kernel turns away for now: the interface's transmit queue is
// full (ENOBUFS: a CAN interface's queue holds 10 frames by default) or the
// socket's send buffer is (EAGAIN). A fast-packet message is up to 32
// frames, so this happens whenever one is sent: the frame is kept and
// written again once the bus has taken some of the queue.
const WRITE_FULL = [constants.errno.ENOBUFS, constants.errno.EAGAIN]
// How long to wait before trying again: at 250 kbit/s a frame takes about
// half a millisecond on the bus.
const RETRY_MS = 2
// The most frames kept waiting. Past this the bus is not taking frames at
// all (no other device acknowledging them, say), and newer frames are
// dropped.
const MAX_QUEUED = 512
// While the kernel keeps turning frames away, dropped frames are reported at
// most this often.
const REPORT_MS = 5000

interface CanPollerHandle {
  close(): void
}

interface NativeBindings {
  openCanReadSocket: (ifname: string) => number
  openCanWriteSocket: (ifname: string) => number
  writeCanFrame: (fd: number, buffer: Buffer) => number
  readCanFrames: (fd: number) => Buffer[]
  // Missing in an addon built before excludePgns.
  setCanReadFilter?: (fd: number, filters: Buffer) => void
  CanPoller: new (fd: number, callback: () => void) => CanPollerHandle
}

// The package root, which holds build/ (an addon compiled at install) and
// prebuilds/ (the binaries shipped for common Linux platforms).
const packageRoot = join(__dirname, '..')

let native: NativeBindings
let nativeLoadError: Error | undefined
try {
  // A compiled addon in build/ if there is one, else the matching prebuilt
  // one.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require('node-gyp-build')(packageRoot)
} catch (err) {
  nativeLoadError = err as Error
}

// Why there is no native addon, and what to do about it.
function nativeLoadFailure(): Error {
  if (process.platform !== 'linux') {
    return new Error(
      `canbus connections need SocketCAN, which is Linux only (this is ${process.platform})`
    )
  }
  const detail = nativeLoadError
    ? `: ${nativeLoadError.message.split('\n')[0]}`
    : ''
  return new Error(
    `Failed to load native canSocket module${detail}. ` +
      `To build it, run "npx node-gyp rebuild" in ${packageRoot} ` +
      '(needs python3, make and a C++ compiler), then restart'
  )
}

export interface CanChannelOptions {
  /**
   * PGNs the kernel drops before they reach this process. Parsed with
   * parseExcludePgns; entries it ignores, and those past the 512th, are
   * left out without a warning.
   */
  excludePgns?: unknown
}

/**
 * struct can_filter entries that, joined (CAN_RAW_JOIN_FILTERS), pass every
 * frame except those of the given PGNs: one inverted filter per PGN. Like the
 * rest of this file, assumes a little-endian host.
 */
export function excludePgnFilters(pgns: number[]): Buffer {
  const buf = Buffer.alloc(pgns.length * CAN_FILTER_SIZE)
  pgns.forEach((pgn, i) => {
    const pdu1 = ((pgn >> 8) & 0xff) < 240
    const mask = pdu1 ? PGN_MASK_PDU1 : PGN_MASK_PDU2
    const id = ((pgn << 8) & mask) | CAN_EFF_FLAG | CAN_INV_FILTER
    buf.writeUInt32LE(id >>> 0, i * CAN_FILTER_SIZE)
    buf.writeUInt32LE((mask | CAN_EFF_FLAG) >>> 0, i * CAN_FILTER_SIZE + 4)
  })
  return buf
}

export interface CanMessage {
  id: number
  data: Buffer
}

/**
 * Drop-in replacement for socketcan's channel object.
 * Same API: addListener('onMessage'), addListener('onStopped'),
 * start(), stop(), send(), removeAllListeners().
 */
export class CanChannel extends EventEmitter {
  private readFd: number
  /** PGNs the kernel drops on the read socket. */
  readonly excludedPgns: number[] = []
  /** Why excludePgns could not be applied, if it couldn't. */
  readonly filterError: string | undefined
  private writeFd: number
  private poller: CanPollerHandle | null = null
  private stopped: boolean = false
  private exitHandler: (() => void) | null = null
  // Frames waiting to be written, in order.
  private queue: Buffer[] = []
  private retryTimer: NodeJS.Timeout | null = null
  // Frames dropped because the queue was full, since the last report.
  private dropped = 0
  private lastReport = 0

  constructor(ifname: string, options: CanChannelOptions = {}) {
    super()
    if (native === undefined) {
      throw nativeLoadFailure()
    }
    this.readFd = native.openCanReadSocket(ifname)
    const pgns = parseExcludePgns(options.excludePgns).pgns.slice(
      0,
      CAN_RAW_FILTER_MAX
    )
    if (pgns.length > 0) {
      // Without the filter everything still works, only slower: an old
      // kernel (before 4.1, no CAN_RAW_JOIN_FILTERS) or an addon built
      // before setCanReadFilter existed must not take the bus down.
      if (typeof native.setCanReadFilter !== 'function') {
        this.filterError =
          'the native canSocket module is too old, rebuild canboatjs'
      } else {
        try {
          native.setCanReadFilter(this.readFd, excludePgnFilters(pgns))
          this.excludedPgns = pgns
        } catch (e) {
          this.filterError = (e as Error).message
        }
      }
    }
    try {
      this.writeFd = native.openCanWriteSocket(ifname)
    } catch (e) {
      closeSync(this.readFd)
      throw e
    }

    // Defensive: if the process exits without an explicit stop(), the
    // CanPoller's uv_poll_t handle will keep the libuv loop alive and
    // process.exit() may hesitate. Clean up on 'exit' as a safety net.
    this.exitHandler = () => this.stop()
    process.on('exit', this.exitHandler)
  }

  start(): void {
    this.stopped = false
    this.poller = new native.CanPoller(this.readFd, () => this.onReadable())
  }

  private onReadable(): void {
    if (this.stopped) {
      return
    }

    let frames: Buffer[]
    try {
      frames = native.readCanFrames(this.readFd)
    } catch (err) {
      if (!this.stopped) {
        this.emit('onStopped', (err as Error).message)
      }
      return
    }

    for (const frame of frames) {
      if (frame.length < CAN_FRAME_SIZE) {
        continue
      }
      const rawId = frame.readUInt32LE(0)
      const id = rawId & CAN_EFF_MASK
      const dlc = frame[4]
      const data = Buffer.from(
        frame.subarray(CAN_DATA_OFFSET, CAN_DATA_OFFSET + dlc)
      )
      this.emit('onMessage', { id, data } as CanMessage)
    }
  }

  stop(): void {
    if (this.stopped) {
      return
    }
    this.stopped = true
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler)
      this.exitHandler = null
    }
    if (this.poller) {
      this.poller.close()
      this.poller = null
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    this.reportDropped()
    this.queue = []
    try {
      closeSync(this.readFd)
    } catch (_e) {}
    try {
      closeSync(this.writeFd)
    } catch (_e) {}
  }

  send(msg: { id: number; ext?: boolean; data: Buffer }): void {
    if (this.stopped) {
      return
    }

    const frame = Buffer.alloc(CAN_FRAME_SIZE)
    let canId = msg.id
    if (msg.ext) {
      canId |= CAN_EFF_FLAG
    }
    frame.writeUInt32LE(canId >>> 0, 0)
    frame[4] = msg.data.length
    msg.data.copy(frame, CAN_DATA_OFFSET, 0, Math.min(msg.data.length, 8))

    if (this.queue.length >= MAX_QUEUED) {
      this.dropped++
      return
    }
    this.queue.push(frame)
    if (!this.retryTimer) {
      this.flush()
    }
  }

  // Write the queued frames in order until the kernel turns one away; then
  // try again shortly.
  private flush(): void {
    this.retryTimer = null
    while (this.queue.length > 0 && !this.stopped) {
      const result = native.writeCanFrame(this.writeFd, this.queue[0])
      if (result < 0 && WRITE_FULL.includes(-result)) {
        this.retryTimer = setTimeout(() => this.flush(), RETRY_MS)
        if (Date.now() - this.lastReport >= REPORT_MS) {
          this.reportDropped()
        }
        return
      }
      // Written, or refused for good (the interface is down, say): the
      // read side reports a broken interface.
      this.queue.shift()
    }
    this.reportDropped()
  }

  private reportDropped(): void {
    if (this.dropped > 0) {
      this.emit(
        'onError',
        `CAN transmit queue full: dropped ${this.dropped} frame(s)`
      )
      this.dropped = 0
      this.lastReport = Date.now()
    }
  }
}
