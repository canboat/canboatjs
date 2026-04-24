/**
 * Minimal CAN socket wrapper using fs streams instead of uv_poll_t.
 *
 * The native addon (native/canSocket.cpp) opens a PF_CAN socket, binds it
 * to the interface, and returns the raw fd in blocking mode.
 *
 * Node.js's net.Socket cannot wrap CAN fds (uv_guess_handle returns
 * UV_UNKNOWN_HANDLE). Instead we use fs.createReadStream which uses libuv's
 * threadpool-based uv_fs_read — works on any fd, never stalls, and does not
 * use uv_poll_t.
 *
 * Reads and writes use separate CAN sockets bound to the same interface.
 * The read socket is blocking (for threadpool reads), the write socket is
 * O_NONBLOCK (to avoid stalling when the CAN bus has no listeners).
 * Separate fds prevent writeCanFrame from toggling O_NONBLOCK on the read
 * fd, which caused spurious ReadStream errors and reconnect cycles.
 *
 * Copyright 2025 Signal K contributors
 * Licensed under the Apache License, Version 2.0
 */

import { EventEmitter } from 'events'
import { createReadStream, close as fsClose } from 'fs'
import { ReadStream } from 'fs'

const CAN_EFF_FLAG = 0x80000000
const CAN_EFF_MASK = 0x1fffffff
const CAN_FRAME_SIZE = 16 // sizeof(struct can_frame)
const CAN_DATA_OFFSET = 8

let native: {
  openCanSocket: (ifname: string) => number
  openCanSocketNonBlock: (ifname: string) => number
  writeCanFrame: (fd: number, buffer: Buffer) => number
}
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
  private readStream: ReadStream | null = null
  private readFd: number
  private writeFd: number
  private remainder: Buffer = Buffer.alloc(0)
  private stopped: boolean = false

  constructor(ifname: string) {
    super()
    if (native === undefined) {
      const detail = nativeLoadError ? `: ${nativeLoadError.message}` : ''
      throw new Error(`Failed to load native canSocket module${detail}`)
    }
    this.readFd = native.openCanSocket(ifname)
    try {
      this.writeFd = native.openCanSocketNonBlock(ifname)
    } catch (e) {
      fsClose(this.readFd, () => {})
      throw e
    }
  }

  start(): void {
    this.stopped = false
    this.readStream = createReadStream('', {
      fd: this.readFd,
      autoClose: false,
      highWaterMark: CAN_FRAME_SIZE * 64
    })

    this.readStream.on('data', (chunk: Buffer) => {
      this.remainder = Buffer.concat([this.remainder, chunk])

      while (this.remainder.length >= CAN_FRAME_SIZE) {
        const frame = this.remainder.subarray(0, CAN_FRAME_SIZE)
        this.remainder = this.remainder.subarray(CAN_FRAME_SIZE)

        const rawId = frame.readUInt32LE(0)
        const id = rawId & CAN_EFF_MASK
        const dlc = frame[4]
        const data = Buffer.from(
          frame.subarray(CAN_DATA_OFFSET, CAN_DATA_OFFSET + dlc)
        )

        this.emit('onMessage', { id, data } as CanMessage)
      }
    })

    this.readStream.on('error', (err: Error) => {
      if (!this.stopped) {
        this.emit('onStopped', err.message)
      }
    })

    this.readStream.on('close', () => {
      if (!this.stopped) {
        this.emit('onStopped', 'closed')
      }
    })
  }

  stop(): void {
    this.stopped = true
    if (this.readStream) {
      this.readStream.destroy()
      this.readStream = null
    }
    fsClose(this.readFd, () => {})
    fsClose(this.writeFd, () => {})
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
