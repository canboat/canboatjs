/**
 * Copyright 2026 Signal K contributors
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
 *
 * Transport driver for the Maretron IPG100 over its 0xA5-framed TCP
 * protocol.
 *
 * Notes:
 *
 *   * The IPG100 caps the total number of simultaneous client TCP
 *     connections at 20. A 21st client is refused.
 *   * The 4th token in CONNECT is a client-type. Sending `MOBILE`
 *     does NOT consume one of the limited licensed-client slots, so
 *     this driver is safe to run alongside Maretron N2KView etc.
 *   * The IPG100 performs NO device-side PGN filtering in either
 *     direction. Every frame on the bus reaches every connected client,
 *     and every frame any client writes is forwarded both to the bus
 *     and to all *other* connected clients.
 *   * Binary mode is mandatory for anything beyond a small set of
 *     well-known PGNs: the IPG's default ASCII output depends on its
 *     internal PGN dictionary, which can't represent newer / vendor
 *     PGNs. We send SET_MODE BINARY immediately after CONNECTED.
 *   * The IPG handles fast-packet reassembly itself, so each frame
 *     carries a full logical N2K payload.
 *   * On TX, source address on the wire is always 0xFF — the IPG
 *     substitutes its own claimed SA.
 */

import { PGN } from '@canboat/ts-pgns'
import { Transform } from 'stream'
import net from 'net'
import util from 'util'
import { createDebug } from './utilities'
import { toPgn } from './toPgn'
import { encodeActisense, parseActisense } from './stringMsg'

// ---------------------------------------------------------------------------
// Wire-protocol constants
// ---------------------------------------------------------------------------

const FRAME_BINARY = 0xa5 // dispatch byte for 0xA5 binary frames
const FRAME_VIDEO = 0x33 // '3' — IP-camera proxy; skipped
const F1_SYNC_BIT = 0x80 // high bit of F1 must be set
const NUL = 0x00 // text-frame terminator

export const IPG_PORT = 6543

// Reconnect uses exponential backoff (1, 2, 4, 8, 16, 32 s — doubling each
// failure, capped at 32 s, reset on CONNECTED) so a freshly-rebooting IPG
// is picked up promptly and a missing host doesn't hammer DNS. Idle
// teardown closes the socket after 30 s of no inbound data.
const DEFAULT_RECONNECT_INITIAL_MS = 1_000
const DEFAULT_RECONNECT_MAX_MS = 32_000
const DEFAULT_IDLE_TEARDOWN_MS = 30_000
const IDLE_CHECK_INTERVAL_MS = 10_000

type State = 'closed' | 'connecting' | 'awaiting' | 'streaming'

// ---------------------------------------------------------------------------
// Pure encode / decode helpers (stateless — exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Decoded shape of a single 0xA5 frame.
 */
export interface MaretronDecodedFrame {
  pgn: number
  pdu_format: 'PDU1' | 'PDU2'
  src: number
  dst: number
  priority: number
  dp: number
  edp: number
  msg_type: number
  msg_type_name: string
  payload_length: number
  payload: Buffer
}

export interface MaretronParseResult {
  /** Bytes consumed from `buf` starting at `offset`. 0 = need more bytes. */
  consumed: number
  /** Decoded frame, or undefined when more bytes are required. */
  frame?: MaretronDecodedFrame
  /** True when bytes at `offset` are clearly not a valid frame start. */
  invalid?: boolean
}

const MSG_TYPE_NAMES: Record<number, string> = {
  0: 'Reserved',
  1: 'Single Frame',
  2: 'Fast Packet',
  3: 'Transport Protocol'
}

function pduFormat(pf: number): 'PDU1' | 'PDU2' {
  return pf < 0xf0 ? 'PDU1' : 'PDU2'
}

/**
 * Parse a single Maretron 0xA5 binary frame starting at `buf[offset]`.
 *
 * Header layout:
 *   byte 0   SYNC = 0xA5
 *   byte 1   F1   = [sync:1][prio:3][edp:1][msgType:2][dp:1]
 *   byte 2   PF
 *   byte 3   PS         PDU1 → destination SA; PDU2 → PGN low byte
 *   byte 4   SA         0xFF = IPG substitutes its claimed SA
 *   byte 5   LL         msgType != 3 → 8-bit length, payload starts at 6
 *   byte 6   LH         msgType == 3 only → length high byte, payload at 7
 */
export function parseMaretronFrame(
  buf: Buffer,
  offset: number = 0
): MaretronParseResult {
  if (buf.length - offset < 6) return { consumed: 0 }
  if (buf[offset] !== FRAME_BINARY) return { consumed: 0, invalid: true }

  const f1 = buf[offset + 1]
  if ((f1 & F1_SYNC_BIT) === 0) return { consumed: 0, invalid: true }

  const priority = (f1 >> 4) & 0x07 // 0=Highest
  const edp = (f1 >> 3) & 0x01 // Extended Data Page
  const msg_type = (f1 >> 1) & 0x03 // 1=Single, 2=Fast Packet, 3=Transport
  const dp = f1 & 0x01 // Data Page

  const pf = buf[offset + 2] // PDU Format
  const ps = buf[offset + 3] // PDU Specific
  const sa = buf[offset + 4] // Source Address

  let payloadStart: number
  let payloadLength: number
  if (msg_type === 3) {
    if (buf.length - offset < 7) return { consumed: 0 }
    payloadLength = buf[offset + 5] | (buf[offset + 6] << 8)
    payloadStart = offset + 7
  } else {
    payloadLength = buf[offset + 5]
    payloadStart = offset + 6
  }

  const total = payloadStart - offset + payloadLength
  if (buf.length - offset < total) return { consumed: 0 }

  const payload = buf.subarray(payloadStart, payloadStart + payloadLength)

  let pgn: number
  let dst: number
  if (pf < 240) {
    /* PDU1 format, the PS contains the destination address */
    pgn = (dp << 16) | (pf << 8)
    dst = ps
  } else {
    /* PDU2 format, the destination is implied global and the PGN is extended */
    pgn = (dp << 16) | (pf << 8) | ps
    dst = 0xff
  }

  return {
    consumed: total,
    frame: {
      pgn,
      pdu_format: pduFormat(pf),
      src: sa,
      dst,
      priority,
      dp,
      edp,
      msg_type,
      msg_type_name: MSG_TYPE_NAMES[msg_type] ?? 'Unknown',
      payload_length: payloadLength,
      payload: Buffer.from(payload)
    }
  }
}

/** Fields a caller must supply to construct an outbound 0xA5 frame. */
export interface MaretronBuildInput {
  pgn: number
  src?: number // default 0xFF (IPG substitutes its claimed SA)
  dst?: number // honored when PDU1; ignored when PDU2 (encoded into PGN low byte)
  priority?: number // default 6
  msg_type?: number // 1 = Single Frame, 2 = Fast Packet, 3 = ISO Transport
  edp?: number // default 0
  payload: Buffer | Uint8Array | number[]
}

/**
 * Serialize a single 0xA5 frame from a structured description.
 *
 * PDU1 puts `dst` in the PS byte; PDU2 puts the PGN low byte in PS and
 * ignores the caller-supplied `dst`.
 */
export function buildMaretronFrame(input: MaretronBuildInput): Buffer {
  const {
    pgn,
    src = 0xff,
    dst = 0xff,
    priority = 6,
    msg_type = 1,
    edp = 0 // Extended Data Page
  } = input
  const payload = Buffer.isBuffer(input.payload)
    ? input.payload
    : Buffer.from(input.payload as Uint8Array | number[])

  const dp = (pgn >> 16) & 0x01 // Data Page
  const pf = (pgn >> 8) & 0xff // PDU Format

  let ps: number // PDU Specific
  if (pf < 240) {
    /* PDU1 format, the PS contains the destination address */
    ps = dst & 0xff
  } else {
    /* PDU2 format, the destination is implied global and the PGN is extended */
    ps = pgn & 0xff
  }

  const f1 =
    F1_SYNC_BIT |
    ((priority & 0x07) << 4) |
    ((edp & 0x01) << 3) |
    ((msg_type & 0x03) << 1) |
    (dp & 0x01)

  const len = payload.length

  let header: Buffer
  if (msg_type === 3) {
    header = Buffer.from([
      FRAME_BINARY,
      f1,
      pf,
      ps,
      src & 0xff,
      len & 0xff,
      (len >> 8) & 0xff
    ])
  } else {
    if (len > 0xff) {
      throw new Error(
        `Maretron payload of ${len} bytes requires msg_type=3 (Transport Protocol); got msg_type=${msg_type}`
      )
    }
    header = Buffer.from([FRAME_BINARY, f1, pf, ps, src & 0xff, len & 0xff])
  }

  return Buffer.concat([header, payload])
}

/**
 * Build the 4-token CONNECT handshake message.
 *
 * The IPG strips a leading and trailing character from the password
 * token before matching, so the password is always wrapped in double
 * quotes on the wire. A stock IPG with no configured password is matched
 * by the literal two-character string `""`.
 *
 * The 4th token is a client-type label that the IPG parses but does not
 * act on. Hard-coded to "MOBILE" to match the convention used elsewhere.
 */
export function buildConnectMessage(password: string): Buffer {
  // The password is wrapped in quotes and tab-delimited; embedded
  // quotes, tabs, NULs, or newlines would retokenize or truncate the
  // CONNECT frame on the wire and the IPG would silently reject auth.
  if (/["\t\0\r\n]/.test(password)) {
    throw new Error(
      'Maretron IPG password cannot contain quotes, tabs, or NUL/newline characters'
    )
  }
  return Buffer.from(`CONNECT\t"${password}"\t\tMOBILE\0`, 'utf8')
}

export const SET_MODE_BINARY = Buffer.from('SET_MODE\tBINARY\0', 'utf8')

// ---------------------------------------------------------------------------
// Stream driver
// ---------------------------------------------------------------------------

export interface MaretronIPGOptions {
  host?: string
  port?: number
  password?: string
  reconnect?: boolean
  /** Initial reconnect delay (ms). Default 1000. */
  reconnectInitialMs?: number
  /** Max reconnect delay (ms). Default 32000. Doubles 1→2→4→8→16→32 s. */
  reconnectMaxMs?: number
  idleTeardownMs?: number
  /**
   * When the *initial* connection attempt fails (bad host, refused port,
   * DNS error), emit a stream `'error'` and stop retrying instead of
   * looping forever. Defaults to `true` in standalone use (no `app`) so
   * the CLI fails fast on a typo, and `false` when an `app` is provided
   * so SignalK keeps retrying until the IPG comes online. Successful
   * sessions always reconnect on close regardless of this flag.
   */
  failFastOnInitialConnect?: boolean
  /** SignalK provider app — used for nmea2000out / event wiring. */
  app?: any
  providerId?: string
  outEvent?: string
  jsonOutEvent?: string
  // Internal — allow tests to inject a socket factory.
  _socketFactory?: (host: string, port: number) => net.Socket
}

export function MaretronIPGStream(this: any, options: MaretronIPGOptions = {}) {
  // Support plain-function calls via CommonJS re-export — `this === undefined`
  // doesn't hold there (it's the exports object), so we key off `new.target`.
  if (new.target === undefined) {
    return new (MaretronIPGStream as any)(options)
  }

  Transform.call(this, { objectMode: true })

  this.debug = createDebug('canboatjs:maretron-ipg', options)
  this.debugOut = createDebug('canboatjs:n2k-out', options)
  this.debugData = createDebug('canboatjs:maretron-ipg-data', options)

  this.options = options
  this.host = options.host ?? 'ipg100'
  this.port = options.port ?? IPG_PORT
  this.password = options.password ?? ''
  this.reconnect = options.reconnect !== false
  this.reconnectInitialMs =
    options.reconnectInitialMs ?? DEFAULT_RECONNECT_INITIAL_MS
  this.reconnectMaxMs = options.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS
  // Current delay for the next attempt — doubled after each failure,
  // reset on CONNECTED. See scheduleReconnect.
  this.reconnectDelayMs = this.reconnectInitialMs
  this.idleTeardownMs = options.idleTeardownMs ?? DEFAULT_IDLE_TEARDOWN_MS
  // Fail fast on initial connect for standalone use (CLI / scripts): a
  // typo'd hostname or wrong port surfaces immediately. SignalK-hosted
  // use (options.app present) flips this off — the IPG may come
  // online minutes after signalk-server boots, so the provider keeps
  // retrying. Callers can override either way.
  this.failFastOnInitialConnect =
    options.failFastOnInitialConnect ?? !options.app

  this.state = 'closed' as State
  this.rx = Buffer.alloc(0)
  this.lastDataAt = 0
  this.socket = null
  this.idleTimer = null
  this.reconnectTimer = null
  this.hasEverConnected = false
  this.authFailed = false

  this.setProviderStatus =
    options.app && options.app.setProviderStatus
      ? (msg: string) => {
          options.app.setProviderStatus(options.providerId, msg)
        }
      : () => {}
  // Standalone use (no SignalK app) routes errors to stderr so socket-level
  // failures during reconnect waits are visible. SignalK use stays on the
  // app's setProviderError channel.
  this.setProviderError =
    options.app && options.app.setProviderError
      ? (msg: string) => {
          options.app.setProviderError(options.providerId, msg)
        }
      : (msg: string) => {
          console.error(`maretron-ipg: ${msg}`)
        }

  if (options.app) {
    const outEvents = (options.outEvent ?? 'nmea2000out')
      .split(',')
      .map((e: string) => e.trim())
    outEvents.forEach((event: string) => {
      options.app.on(event, (msg: any) => {
        if (typeof msg === 'string') {
          this.sendString(msg)
        } else {
          this.sendPGN(msg)
        }
        options.app.emit('connectionwrite', {
          providerId: options.providerId
        })
      })
    })

    const jsonOutEvents = (options.jsonOutEvent ?? 'nmea2000JsonOut')
      .split(',')
      .map((e: string) => e.trim())
    jsonOutEvents.forEach((event: string) => {
      options.app.on(event, (msg: PGN) => {
        this.sendPGN(msg)
        options.app.emit('connectionwrite', {
          providerId: options.providerId
        })
      })
    })
  }

  this.debug(
    `MaretronIPGStream constructed host=${this.host} port=${this.port}`
  )

  this.start()
}

util.inherits(MaretronIPGStream, Transform)

MaretronIPGStream.prototype.start = function () {
  if (this.socket) {
    // Detach our handlers before destroying so the impending 'close'
    // doesn't re-enter scheduleReconnect on top of the fresh start.
    this.socket.removeAllListeners()
    try {
      this.socket.destroy()
    } catch {
      // ignore
    }
    this.socket = null
  }

  this.state = 'connecting' as State
  this.rx = Buffer.alloc(0)

  // Per-socket scratch — `error` and `close` fire as a pair, with the
  // error always first. Closing over it here means the field doesn't
  // outlive the socket and can't be confused for state about a later one.
  let lastErr: Error | null = null

  const factory =
    this.options._socketFactory ??
    ((host: string, port: number) => net.createConnection({ host, port }))

  let socket: net.Socket
  try {
    socket = factory(this.host, this.port)
  } catch (err: any) {
    this.debug(`socket factory failed: ${err.message}`)
    this.setProviderError(err.message)
    this.scheduleReconnect(err)
    return
  }
  this.socket = socket

  socket.on('connect', () => {
    this.debug(`TCP connected to ${this.host}:${this.port}`)
    this.setProviderStatus(`Connected to ${this.host}:${this.port}`)
    this.state = 'awaiting' as State
    this.lastDataAt = Date.now()
    const handshake = buildConnectMessage(this.password)
    this.debugOut(`-> ${handshake.toString('utf8').replace(/\0/g, '\\0')}`)
    socket.write(handshake)
    this.startIdleTimer()
  })

  socket.on('data', (chunk: Buffer) => {
    this.lastDataAt = Date.now()
    this.handleIncoming(chunk)
  })

  socket.on('error', (err: any) => {
    this.debug(`socket error: ${err.message}`)
    lastErr = err
    this.setProviderError(err.message)
  })

  socket.on('close', () => {
    this.debug('socket closed')
    this.stopIdleTimer()
    this.state = 'closed' as State
    // Suppress reconnect after auth failure — bad credentials won't get
    // better by retrying, and in app mode this would otherwise loop forever.
    if (!this.authFailed) {
      this.scheduleReconnect(lastErr)
    }
  })
}

MaretronIPGStream.prototype.handleIncoming = function (chunk: Buffer) {
  this.rx = this.rx.length === 0 ? chunk : Buffer.concat([this.rx, chunk])

  // Drain framed messages until we run out of bytes or hit a partial frame.
  while (this.rx.length > 0) {
    const first = this.rx[0]

    if (first === FRAME_BINARY) {
      const result = parseMaretronFrame(this.rx, 0)
      if (result.invalid) {
        this.debug(
          `0xA5 with invalid F1 (0x${this.rx[1]?.toString(16)}); resyncing`
        )
        this.rx = this.rx.subarray(1)
        continue
      }
      if (result.consumed === 0) return // need more bytes
      this.rx = this.rx.subarray(result.consumed)
      this.emitFrame(result.frame!)
      continue
    }

    if (first === FRAME_VIDEO) {
      const nul = this.rx.indexOf(NUL)
      if (nul < 0) return
      this.debug(`skipping video frame (${nul} bytes)`)
      this.rx = this.rx.subarray(nul + 1)
      continue
    }

    if ((first & F1_SYNC_BIT) === 0) {
      // ASCII / text control frame, NUL-terminated.
      const nul = this.rx.indexOf(NUL)
      if (nul < 0) return
      const line = this.rx.subarray(0, nul).toString('utf8')
      this.rx = this.rx.subarray(nul + 1)
      if (line.length > 0) this.handleText(line)
      continue
    }

    // High-bit set but not 0xA5 — out of sync. Drop one byte and retry.
    this.debug(`out-of-sync byte 0x${first.toString(16)}; resyncing`)
    this.rx = this.rx.subarray(1)
  }
}

MaretronIPGStream.prototype.emitFrame = function (frame: MaretronDecodedFrame) {
  if (this.debugData.enabled) {
    this.debugData(
      `rx pgn=${frame.pgn} src=${frame.src} dst=${frame.dst} prio=${frame.priority} type=${frame.msg_type} len=${frame.payload_length}`
    )
  }

  this.emit('n2kFrame', frame)

  // Pipeline payload: actisense-style canboat plain CSV. Downstream
  // signalk-server pipelines consume this directly, and the Log
  // provider records it as readable text.
  const csv = encodeActisense({
    pgn: frame.pgn,
    prio: frame.priority,
    src: frame.src,
    dst: frame.dst,
    data: frame.payload
  })

  if (this.options.app?.listenerCount?.('canboatjs:rawoutput') > 0) {
    this.options.app.emit('canboatjs:rawoutput', csv)
  }

  this.push(csv)
}

MaretronIPGStream.prototype.handleText = function (line: string) {
  const parts = line.split('\t')
  const head = parts[0]
  this.debug(
    `text: ${head}${parts.length > 1 ? '\t' + parts.slice(1).join('\t') : ''}`
  )

  switch (head) {
    case 'SERVER_VERSION':
      this.serverVersion = parts[1]
      this.serverProduct = parts[2] // always "IPG100"
      this.emit('version', this.serverVersion, this.serverProduct)
      break
    case 'INSTANCE_DATA':
      this.ipgBusAddress = parseInt(parts[1], 10)
      this.clientInstance = parseInt(parts[2], 10)
      this.emit('instance', this.ipgBusAddress, this.clientInstance)
      break
    case 'CONNECTED':
      // 4th and final handshake reply — switch to binary now.
      this.deviceSerial = parts[1]
      this.debugOut(`-> SET_MODE\\tBINARY\\0`)
      this.socket?.write(SET_MODE_BINARY)
      this.state = 'streaming' as State
      this.hasEverConnected = true
      this.reconnectDelayMs = this.reconnectInitialMs
      this.setProviderStatus(
        `Streaming from ${this.host}:${this.port} (serial ${this.deviceSerial ?? '?'})`
      )
      if (this.options.app?.emit) {
        this.options.app.emit('nmea2000OutAvailable')
      }
      this.emit('connected', { serial: this.deviceSerial })
      break
    case 'NO':
      this.debug('authentication failed')
      this.setProviderError('Maretron IPG authentication failed (NO)')
      this.authFailed = true
      this.emit('authfail')
      this.socket?.end()
      break
    case 'LICENSES_USED':
    case 'DETAILED_LICENSES_USED':
    case 'BASELICENSE':
    case 'NOLICENSE':
    case 'WAITING_TO_RECONNECT':
    case 'DISCONNECTED':
    case 'CONNECTING':
    case 'CONNECTED_FILE':
    case 'CATALOG':
    case 'FILE_LENGTH':
    case 'FILE_COMPLETE':
    case 'MODES':
      // informational — log only
      break
    case '2':
    case '3':
      // ASCII-mode N2K data frame, arriving in the brief window between
      // us sending SET_MODE BINARY and the IPG honoring it. Not useful
      // because we don't know the field mappings, so we drop.
      break
    default:
      this.debug(`unrecognized text: ${head}`)
  }
}

MaretronIPGStream.prototype.startIdleTimer = function () {
  this.stopIdleTimer()
  this.idleTimer = setInterval(() => {
    if (
      this.state !== 'closed' &&
      Date.now() - this.lastDataAt > this.idleTeardownMs
    ) {
      this.debug(
        `idle for ${this.idleTeardownMs}ms with no inbound data; tearing down`
      )
      this.setProviderError('Idle teardown — no data received')
      try {
        this.socket?.end()
        this.socket?.destroy()
      } catch {
        // ignore
      }
    }
  }, IDLE_CHECK_INTERVAL_MS)
  if (this.idleTimer.unref) this.idleTimer.unref()
}

MaretronIPGStream.prototype.stopIdleTimer = function () {
  if (this.idleTimer) {
    clearInterval(this.idleTimer)
    this.idleTimer = null
  }
}

MaretronIPGStream.prototype.scheduleReconnect = function (
  lastErr?: Error | null
) {
  if (!this.reconnect) return
  if (this.reconnectTimer) return

  if (!this.hasEverConnected && this.failFastOnInitialConnect) {
    // Standalone use (CLI, no SignalK app): initial connect failed
    // (bad host, refused port, DNS error). Surface the underlying
    // socket error and don't loop — the operator needs to fix the
    // address. SignalK-hosted use keeps retrying instead (the IPG
    // may not be online at server boot).
    const err =
      lastErr ??
      new Error(
        `Failed to connect to Maretron IPG at ${this.host}:${this.port}`
      )
    if (this.listenerCount('error') > 0) {
      this.emit('error', err)
    } else {
      // No listener — log instead of crashing the process with an
      // unhandled 'error' event.
      console.error(`maretron-ipg: ${err.message}`)
    }
    return
  }

  const delay = this.reconnectDelayMs
  this.debug(`scheduling reconnect in ${delay}ms`)
  this.setProviderStatus(`Reconnecting in ${(delay / 1000).toFixed(0)}s`)
  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null
    this.start()
  }, delay)
  // Exponential backoff: 1→2→4→8→16→32 s by default. Reset to
  // reconnectInitialMs in the CONNECTED handler so the next disconnect
  // starts fresh.
  this.reconnectDelayMs = Math.min(
    this.reconnectDelayMs * 2,
    this.reconnectMaxMs
  )
  // Intentionally not unref'd — after a successful first session this
  // timer is the only thing keeping a standalone process alive across
  // the reconnect gap. Unref'ing would let Node exit before the retry
  // fires, defeating reconnect: true in CLI mode.
}

MaretronIPGStream.prototype.sendPGN = function (pgn: PGN) {
  if (this.state !== 'streaming') {
    this.debug(`sendPGN ${pgn.pgn} dropped — not streaming yet`)
    return
  }
  const data = toPgn(pgn)
  if (!data) {
    this.debug(`toPgn returned no data for pgn ${pgn.pgn}`)
    return
  }
  // Single-frame CAN payloads fit in 8 bytes; anything larger goes
  // out as Fast Packet (msg_type=2). We never emit msg_type=3 (ISO
  // Transport Protocol) from the client side — the IPG handles
  // fast-packet bucket splitting itself, and tagging an outbound
  // message as Transport Protocol would push it into a different
  // bus-side TX path that's not appropriate for ordinary client
  // traffic. The 16-bit length encoding in build/parse exists only
  // for inbound frames the IPG generates.
  const msg_type = data.length > 8 ? 2 : 1
  const dst = pgn.dst ?? 0xff
  const prio = pgn.prio ?? 6
  const frame = buildMaretronFrame({
    pgn: pgn.pgn,
    // Always 0xFF — the IPG substitutes its own claimed SA.
    src: 0xff,
    dst,
    priority: prio,
    msg_type,
    payload: data
  })
  this.writeFrame(frame, { pgn: pgn.pgn, dst, prio })
}

/**
 * Send via a canboat plain-CSV string:
 *   `YYYY-MM-DD-HH:MM:SS.mmm,prio,pgn,src,dst,len,b0,b1,…`
 *
 * Source-address from the caller is ignored — the IPG decides.
 */
MaretronIPGStream.prototype.sendString = function (msg: string) {
  if (this.state !== 'streaming') {
    this.debug(`sendString dropped — not streaming yet`)
    return
  }
  const parsed = parseActisense(msg)
  if (!parsed || parsed.error) {
    this.debug(
      `sendString ignored — ${parsed?.error ?? 'parse failed'}: ${msg}`
    )
    return
  }
  const { prio, pgn, dst, data } = parsed
  // See sendPGN: never emit msg_type=3 from the client side.
  const msg_type = data.length > 8 ? 2 : 1
  const frame = buildMaretronFrame({
    pgn,
    src: 0xff,
    dst,
    priority: prio,
    msg_type,
    payload: data
  })
  this.writeFrame(frame, { pgn, prio, dst })
}

MaretronIPGStream.prototype.writeFrame = function (frame: Buffer, ctx: any) {
  if (!this.socket || this.state !== 'streaming') {
    this.debug(`writeFrame dropped — state=${this.state}`)
    return
  }
  if (this.debugOut.enabled) {
    this.debugOut(
      `tx pgn=${ctx?.pgn} dst=${ctx?.dst} prio=${ctx?.prio} bytes=${frame.length}`
    )
  }
  if (this.options.app?.listenerCount?.('canboatjs:rawsend') > 0) {
    this.options.app.emit('canboatjs:rawsend', { data: frame })
  }
  this.socket.write(frame)
}

MaretronIPGStream.prototype._transform = function (
  chunk: any,
  _encoding: any,
  done: any
) {
  // Allow callers to also pipe raw bytes in (used by the unit tests that
  // don't open a real TCP socket).
  if (Buffer.isBuffer(chunk)) {
    this.handleIncoming(chunk)
  }
  done()
}

MaretronIPGStream.prototype.end = function () {
  // Must come before socket.destroy(): the async 'close' event will call
  // scheduleReconnect, which short-circuits when this.reconnect is false.
  this.reconnect = false
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
  this.stopIdleTimer()
  if (this.socket) {
    try {
      this.socket.end()
      this.socket.destroy()
    } catch {
      // ignore
    }
    this.socket = null
  }
  this.state = 'closed' as State
}
