/**
 * Copyright 2025 Scott Bender <scott@scottbender.net>
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

import { PGN } from '@canboat/ts-pgns'
import { Transform } from 'stream'
import net from 'net'
import _ from 'lodash'
import util from 'util'

import { CanDevice } from './candevice'
import { CanID, encodeCanId } from './canId'
import {
  pgnToActisenseN2KAsciiFormat,
  pgnToN2KActisenseFormat,
  toPgn
} from './toPgn'
import {
  encodeCandump1,
  encodeCandump2,
  encodeCandump3,
  encodeYDRAW,
  encodePCDIN,
  parseActisense,
  parseActisenseN2KASCII,
  parseCandump1,
  parseCandump2,
  parseCandump3,
  parsePCDIN,
  parseYDRAW
} from './stringMsg'
import { byteStringArray, createDebug, getPlainPGNs } from './utilities'

type SupportedFormat =
  | 'candump3'
  | 'candump2'
  | 'candump1'
  | 'ydraw'
  | 'actisense'
  | 'actisense-n2k-ascii'
  | 'pcdin'

const DEFAULT_PORT = 2599
const DEFAULT_RECONNECT_MS = 5000
const DEFAULT_FORMAT: SupportedFormat = 'candump3'

// Convert a candump3-style "(sec.usec)" or "(sec.usec) " timestamp into an
// ISO-8601 string. Returns undefined if the input doesn't look like a
// candump epoch timestamp — the caller should drop the field in that case.
function candumpTimestampToIso(ts: string): string | undefined {
  const m = /^\(?(\d+)(?:\.(\d+))?\)?$/.exec(ts)
  if (!m) return undefined
  const sec = Number(m[1])
  if (!Number.isFinite(sec)) return undefined
  // Pad the fractional part to microseconds so we always interpret it as such.
  const usec = m[2] ? Number(m[2].slice(0, 6).padEnd(6, '0')) : 0
  if (!Number.isFinite(usec)) return undefined
  const ms = sec * 1000 + Math.floor(usec / 1000)
  const d = new Date(ms)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString()
}

// Each format pairs an inbound line parser with an outbound encoder. The
// encoders return either a single line or an array of lines (for fast-packet
// splits) so the transport layer can stay format-agnostic.
type LineParser = (line: string) => any
type LineEncoder = (
  pgn: any,
  canid: number,
  buffer: Buffer
) => string | string[]

function encodeCandump3Line(pgn: any, _canid: number, buffer: Buffer) {
  return encodeCandump3({
    data: buffer,
    pgn: pgn.pgn,
    src: pgn.src,
    dst: pgn.dst,
    prio: pgn.prio
  })
}

function encodeCandump2Line(pgn: any, _canid: number, buffer: Buffer) {
  return encodeCandump2({
    data: buffer,
    pgn: pgn.pgn,
    src: pgn.src,
    dst: pgn.dst,
    prio: pgn.prio
  })
}

function encodeCandump1Line(pgn: any, _canid: number, buffer: Buffer) {
  return encodeCandump1({
    data: buffer,
    pgn: pgn.pgn,
    src: pgn.src,
    dst: pgn.dst,
    prio: pgn.prio
  })
}

function encodeYDRAWLine(pgn: any, _canid: number, buffer: Buffer) {
  return encodeYDRAW({
    data: buffer,
    pgn: pgn.pgn,
    src: pgn.src,
    dst: pgn.dst,
    prio: pgn.prio
  })
}

function encodeActisenseLine(pgn: any, _canid: number, _buffer: Buffer) {
  // Actisense format carries the entire (possibly long) PGN payload — no
  // fast-packet split needed. The caller passes the full unsplit buffer.
  return pgnToN2KActisenseFormat(pgn) as unknown as string
}

function encodeActisenseN2KAsciiLine(
  pgn: any,
  _canid: number,
  _buffer: Buffer
) {
  return pgnToActisenseN2KAsciiFormat(pgn)
}

function encodePCDINLine(pgn: any, _canid: number, buffer: Buffer) {
  return encodePCDIN({
    pgn: pgn.pgn,
    data: buffer,
    src: pgn.src,
    dst: pgn.dst,
    prio: pgn.prio
  })
}

const FORMATS: Record<
  SupportedFormat,
  {
    parse: LineParser
    encode: LineEncoder
    // Whether the encoder consumes the *whole* PGN payload (Actisense) or
    // expects pre-split 8-byte plain-PGN buffers (CAN-level formats).
    splitFastPacket: boolean
    // Terminator appended after each encoded line before writing.
    terminator: string
  }
> = {
  candump3: {
    parse: parseCandump3,
    encode: encodeCandump3Line,
    splitFastPacket: true,
    terminator: '\n'
  },
  candump2: {
    parse: parseCandump2,
    encode: encodeCandump2Line,
    splitFastPacket: true,
    terminator: '\n'
  },
  candump1: {
    parse: parseCandump1,
    encode: encodeCandump1Line,
    splitFastPacket: true,
    terminator: '\n'
  },
  ydraw: {
    parse: parseYDRAW,
    encode: encodeYDRAWLine,
    splitFastPacket: true,
    terminator: '\r\n'
  },
  actisense: {
    parse: parseActisense,
    encode: encodeActisenseLine,
    splitFastPacket: false,
    terminator: '\r\n'
  },
  'actisense-n2k-ascii': {
    parse: parseActisenseN2KASCII,
    encode: encodeActisenseN2KAsciiLine,
    splitFastPacket: false,
    terminator: '\r\n'
  },
  pcdin: {
    parse: parsePCDIN,
    encode: encodePCDINLine,
    splitFastPacket: false,
    terminator: '\r\n'
  }
}

export interface N2kIpGatewayOptions {
  app: any
  providerId?: string
  host: string
  port?: number
  reconnectIntervalMs?: number
  format?: SupportedFormat
  actAsCanDevice?: boolean
  useCanName?: boolean
  outEvent?: string
  jsonOutEvent?: string
  analyzerOutEvent?: string
  // pass-throughs forwarded to CanDevice / N2kDevice
  manufacturerCode?: number
  deviceFunction?: number
  preferredAddress?: number
  productInfo?: any
  configurationInfo?: any
  transmitPGNs?: number[]
  disableDefaultTransmitPGNs?: boolean
  [k: string]: any
}

export function N2kIpGateway(this: any, options: N2kIpGatewayOptions) {
  if (this === undefined) {
    return new (N2kIpGateway as any)(options)
  }

  Transform.call(this, { objectMode: true })

  if (!options || !options.host) {
    throw new Error('N2kIpGateway: options.host is required')
  }

  this.options = options
  this.host = options.host
  this.port = options.port ?? DEFAULT_PORT
  this.reconnectIntervalMs = options.reconnectIntervalMs ?? DEFAULT_RECONNECT_MS

  const fmt = (options.format ?? DEFAULT_FORMAT) as SupportedFormat
  if (!FORMATS[fmt]) {
    throw new Error(`N2kIpGateway: unsupported format "${fmt}"`)
  }
  this.format = fmt
  this.formatSpec = FORMATS[fmt]

  // Default is "be a CAN device" — matches the user's KISS expectation.
  this.actAsCanDevice = options.actAsCanDevice ?? true

  this.debug = createDebug('canboatjs:n2k-ip-gateway', options)
  this.debugData = createDebug('canboatjs:n2k-ip-gateway-data', options)
  this.debugOut = createDebug('canboatjs:n2k-out', options)

  this.plainText = false
  this.rxBuffer = ''
  this.reconnecting = false
  this.stopping = false
  this.sentAvailable = false

  this.setProviderStatus =
    options.app && options.app.setProviderStatus
      ? (msg: string) => options.app.setProviderStatus(options.providerId, msg)
      : () => {}
  this.setProviderError =
    options.app && options.app.setProviderError
      ? (msg: string) => options.app.setProviderError(options.providerId, msg)
      : () => {}

  if (options.app) {
    const outEvents = (options.outEvent || 'nmea2000out')
      .split(',')
      .map((event: string) => event.trim())
    outEvents.forEach((event: string) => {
      options.app.on(event, (msg: any) => {
        this.sendPGN(msg, false)
      })
    })

    const jsonOutEvents = (options.jsonOutEvent || 'nmea2000JsonOut')
      .split(',')
      .map((event: string) => event.trim())
    jsonOutEvents.forEach((event: string) => {
      options.app.on(event, (msg: PGN) => {
        this.sendPGN(msg, false)
      })
    })
  }

  this.connect()
}

util.inherits(N2kIpGateway, Transform)

N2kIpGateway.prototype.connect = function () {
  if (this.reconnecting || this.stopping) {
    return
  }
  this.reconnecting = true

  this.debug(`connecting to ${this.host}:${this.port}`)

  const socket = new net.Socket()
  this.socket = socket

  const onError = (err: Error) => {
    this.debug(`socket error: ${err.message}`)
    this.setProviderError(err.message)
  }

  const onClose = () => {
    this.debug('socket closed')
    if (this.candevice) {
      try {
        this.candevice.stop()
      } catch (_e) {
        // best-effort cleanup
      }
      this.candevice = undefined
    }
    this.socket = undefined
    this.reconnecting = false
    if (!this.stopping) {
      this.setProviderError('disconnected, reconnecting...')
      this.reconnectTimer = setTimeout(
        () => this.connect(),
        this.reconnectIntervalMs
      )
    }
  }

  socket.on('error', onError)
  socket.on('close', onClose)
  socket.on('data', (chunk: Buffer) => this._onData(chunk))

  socket.connect(this.port, this.host, () => {
    if (this.stopping || this.socket !== socket) {
      // We were torn down (or replaced) before the connect callback fired —
      // don't spin up a CanDevice whose timers would then leak.
      return
    }
    this.debug(`connected to ${this.host}:${this.port}`)
    this.setProviderStatus(`Connected to ${this.host}:${this.port}`)
    this.reconnecting = false

    if (this.actAsCanDevice && this.options.app && !this.candevice) {
      this.candevice = new CanDevice(this, this.options)
      this.candevice.start()
    }

    if (!this.sentAvailable && this.options.app) {
      this.options.app.emit('nmea2000OutAvailable')
      this.sentAvailable = true
    }
  })
}

N2kIpGateway.prototype._onData = function (chunk: Buffer) {
  this.rxBuffer += chunk.toString('utf8')
  let nl: number
  while ((nl = this.rxBuffer.indexOf('\n')) >= 0) {
    let line = this.rxBuffer.slice(0, nl)
    this.rxBuffer = this.rxBuffer.slice(nl + 1)
    if (line.endsWith('\r')) {
      line = line.slice(0, -1)
    }
    if (line.length === 0) continue
    this._handleLine(line)
  }
}

N2kIpGateway.prototype._handleLine = function (line: string) {
  if (this.debugData.enabled) {
    this.debugData(line)
  }

  let parsed: any
  try {
    parsed = this.formatSpec.parse(line)
  } catch (e: any) {
    this.debug(`parse error (${this.format}): ${e.message}`)
    return
  }
  if (!parsed || parsed.error || !parsed.data) {
    return
  }

  // parseXxx() returns a flat CanID-like object: { pgn, src, dst, prio, data }.
  // Downstream consumers expect { pgn: <that object>, length, data }.
  const data: Buffer = parsed.data

  // Normalize the per-frame timestamp. parseCandump3() puts the raw
  // "(<sec>.<usec>)" string in parsed.timestamp; downstream code that does
  // `new Date(parsed.timestamp)` would get an Invalid Date and produce NaN
  // when consumers (e.g. ILP writers) try to extract a numeric timestamp.
  // Convert to an ISO string if we can, otherwise drop the field so the
  // analyzer falls back to its own `new Date()`.
  if (typeof parsed.timestamp === 'string') {
    const iso = candumpTimestampToIso(parsed.timestamp)
    if (iso) {
      parsed.timestamp = iso
    } else {
      delete parsed.timestamp
    }
  }

  // Drop frames we sent ourselves so we don't re-process loopback / echoed
  // outbound traffic as if it were bus input.
  if (
    this.candevice &&
    this.candevice.cansend &&
    parsed.src === this.candevice.address
  ) {
    return
  }

  const out = { pgn: parsed, length: data.length, data }
  if (
    this.options.app &&
    this.options.app.listenerCount &&
    this.options.app.listenerCount('canboatjs:rawoutput') > 0
  ) {
    this.options.app.emit('canboatjs:rawoutput', out)
  }
  this.push(out)
}

N2kIpGateway.prototype.send = function (line: string) {
  if (!this.socket) {
    this.debug('drop send: socket not connected')
    return
  }
  this.debugOut('sending %s', line)
  this.socket.write(line + this.formatSpec.terminator)
}

N2kIpGateway.prototype.sendPGN = function (msg: any, force?: boolean) {
  if (this.actAsCanDevice) {
    if (!this.candevice) {
      // Not connected yet — drop. The server will retry as needed.
      return
    }
    if (!this.candevice.cansend && force !== true) {
      // Address claim not yet completed; only CanDevice's own probes are
      // allowed through with force=true.
      return
    }
  }

  if (this.options.app) {
    this.options.app.emit('connectionwrite', {
      providerId: this.options.providerId
    })
  }

  let pgn: any
  if (_.isString(msg)) {
    // Inbound message is in some text format. We accept it as-is when it
    // already matches our wire format; otherwise reparse via Actisense (the
    // canonical comma-delimited form used by signalk-server).
    pgn = parseActisense(msg)
  } else {
    pgn = msg
    if (_.isUndefined(pgn.prio)) pgn.prio = 3
    if (_.isUndefined(pgn.dst)) pgn.dst = 255
    if (this.actAsCanDevice && this.candevice && !pgn.forceSrc) {
      pgn.src = this.candevice.address
    } else if (_.isUndefined(pgn.src)) {
      pgn.src = 0
    }
  }

  // Prefer an already-encoded buffer when the caller supplied one — this lets
  // upstream code forward frames that have already been serialized (e.g.
  // verbatim relays from another analyzer) without re-encoding fields.
  let buffer: Buffer | undefined
  if (_.isString(msg)) {
    buffer = pgn.data
  } else if (Buffer.isBuffer(pgn.data)) {
    buffer = pgn.data
  } else {
    buffer = toPgn(pgn)
  }
  if (!buffer) {
    this.debug("can't convert %j", msg)
    return
  }
  const canid = encodeCanId(pgn as CanID)

  let payloads: Buffer[]
  if (
    this.formatSpec.splitFastPacket &&
    (buffer.length > 8 || pgn.pgn === 126720)
  ) {
    payloads = getPlainPGNs(buffer)
  } else {
    payloads = [buffer]
  }

  payloads.forEach((payload) => {
    const encoded = this.formatSpec.encode(pgn, canid, payload)
    const lines = Array.isArray(encoded) ? encoded : [encoded]
    lines.forEach((line: string) => this.send(line))

    if (
      this.options.app &&
      this.options.app.listenerCount &&
      this.options.app.listenerCount('canboatjs:rawsend') > 0
    ) {
      this.options.app.emit('canboatjs:rawsend', {
        knownSrc: true,
        data: { pgn, length: payload.length, data: byteStringArray(payload) }
      })
    }
  })

  // Forward self-emitted device info back into the analyzer pipe so the
  // server sees its own address claim / product info / config info, matching
  // CanbusStream behavior.
  if (pgn.pgn === 60928 || pgn.pgn === 126996 || pgn.pgn === 126998) {
    this.push({ pgn, length: buffer.length, data: buffer })
  }
}

N2kIpGateway.prototype._transform = function (
  _chunk: any,
  _encoding: any,
  done: any
) {
  done()
}

N2kIpGateway.prototype.pipe = function (pipeTo: any) {
  if (!pipeTo.fromPgn) {
    this.plainText = true
  }
  return (N2kIpGateway as any).super_.prototype.pipe.call(this, pipeTo)
}

N2kIpGateway.prototype.end = function () {
  this.stopping = true
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }
  if (this.candevice) {
    try {
      this.candevice.stop()
    } catch (_e) {
      // best-effort
    }
    this.candevice = undefined
  }
  if (this.socket) {
    try {
      this.socket.end()
      this.socket.destroy()
    } catch (_e) {
      // best-effort
    }
    this.socket = undefined
  }
}
