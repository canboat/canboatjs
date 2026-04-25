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
 * the read socket has the default (full) RX filter, the write socket has an
 * empty RX filter so the kernel doesn't queue frames into a buffer nobody
 * reads.
 *
 * Copyright 2025 Signal K contributors
 * Licensed under the Apache License, Version 2.0
 */

import { EventEmitter } from 'events'
import { closeSync } from 'fs'

const CAN_EFF_FLAG = 0x80000000
const CAN_EFF_MASK = 0x1fffffff
const CAN_FRAME_SIZE = 16 // sizeof(struct can_frame)
const CAN_DATA_OFFSET = 8

interface CanPollerHandle {
  close(): void
}

interface NativeBindings {
  openCanReadSocket: (ifname: string) => number
  openCanWriteSocket: (ifname: string) => number
  writeCanFrame: (fd: number, buffer: Buffer) => number
  readCanFrames: (fd: number) => Buffer[]
  CanPoller: new (fd: number, callback: () => void) => CanPollerHandle
}

let native: NativeBindings
let nativeLoadError: Error | undefined
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  native = require('../build/Release/canSocket.node')
} catch (releaseErr) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    native = require('../build/Debug/canSocket.node')
  } catch (_debugErr) {
    nativeLoadError = releaseErr as Error
  }
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
  private writeFd: number
  private poller: CanPollerHandle | null = null
  private stopped: boolean = false
  private exitHandler: (() => void) | null = null

  constructor(ifname: string) {
    super()
    if (native === undefined) {
      const detail = nativeLoadError ? `: ${nativeLoadError.message}` : ''
      throw new Error(`Failed to load native canSocket module${detail}`)
    }
    this.readFd = native.openCanReadSocket(ifname)
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

    native.writeCanFrame(this.writeFd, frame)
  }
}
