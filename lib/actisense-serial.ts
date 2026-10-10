/**
 * Copyright 2018 Scott Bender (scott@scottbender.net)
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
import { createDebug, subscribeApp, unsubscribeApp } from './utilities'
import { inherits } from 'util'
import { Transform } from 'stream'
import { BitStream, BitView } from 'bit-buffer'
import { toPgn } from './toPgn'
import { encodeActisense } from './stringMsg'
import { defaultTransmitPGNs } from './codes'
import _ from 'lodash'
import { Parser as FromPgn } from './fromPgn'

/* ASCII characters used to mark packet start/stop */

const STX = 0x02 /* Start packet */
const ETX = 0x03 /* End packet */
const DLE = 0x10 /* Start pto encode a STX or ETX send DLE+STX or DLE+ETX */
const ESC = 0x1b /* Escape */

/* Actisense message structure is:

   DLE STX <command> <len> [<data> ...] <checksum> DLE ETX

   Byte stuffing: any DLE (0x10) byte appearing in <len>, <data>, or
   <checksum> is duplicated on the wire (written as DLE DLE). The
   leading DLE STX and trailing DLE ETX are framing markers and are
   never stuffed.
   <command> is a byte from the list below and is written as-is.
   <len> is the payload length in bytes — the number of <data> bytes
         before byte stuffing.
   <checksum> is chosen so command + len + all unescaped <data> bytes +
              checksum is 0 modulo 256.
*/

const N2K_MSG_RECEIVED = 0x93 /* Receive standard N2K message */
const N2K_MSG_SEND = 0x94 /* Send N2K message */
const NGT_MSG_RECEIVED = 0xa0 /* Receive NGT specific message */
const NGT_MSG_SEND = 0xa1 /* Send NGT message */

const MSG_START = 1
const MSG_ESCAPE = 2
const MSG_MESSAGE = 3

/* BEM commands, as the Actisense SDK names them
   (https://github.com/Actisense/SDK/blob/main/docs/DataFormats/Binary/bem-detail/README.md).
   Each goes out as NGT_MSG_SEND and is answered by NGT_MSG_RECEIVED: the
   BEM id, a sequence byte, the model id (u16), the serial number (u32) and
   an error code (i32), then the command's data. */

const BEM_OPERATING_MODE = 0x11 /* Get / Set Operating Mode */
const BEM_PRODUCT_INFO = 0x41 /* Get Product Info */

const BEM_HEADER_LENGTH = 12

/* The operating modes of an NGT / NGX, numbered and named as in the SDK.
   canboatjs sets NGT Transfer Rx All Mode, which forwards every received
   PGN; it does not touch the transmit list. */
const OPERATING_MODE_RX_ALL = 2
const OPERATING_MODES: { [code: number]: string } = {
  1: 'NGT Transfer Normal Mode',
  2: 'NGT Transfer Rx All Mode',
  3: 'NGT Transfer Raw Mode',
  4: 'NGW Convert Normal Mode',
  5: 'CAN Packet Mode',
  6: 'CAN Packet ASCII Mode'
}

const SET_OPERATING_MODE_MSG = new Uint8Array([
  BEM_OPERATING_MODE,
  OPERATING_MODE_RX_ALL & 0xff,
  OPERATING_MODE_RX_ALL >> 8
])
const GET_PRODUCT_INFO_MSG = new Uint8Array([BEM_PRODUCT_INFO])

/* An NGT-1 (firmware 2.690) drops BEM commands written in the 50-200 ms
   after Set Operating Mode, and N2K messages in the 400-450 ms after it. So
   Product Info is asked for first, and output waits this long. */
const MODE_SETTLE_MS = 500

export function ActisenseStream(this: any, options: any) {
  if (this === undefined) {
    return new (ActisenseStream as any)(options)
  }

  this.debugOut = createDebug('canboatjs:n2k-out', options)
  this.debug = createDebug('canboatjs:actisense-serial', options)

  Transform.call(this, {
    objectMode: true
  })

  this.debug('options: %j', options)

  this.reconnect = options.reconnect || true
  this.serial = null
  this.options = options
  this.transmitPGNRetries = 2

  this.transmitPGNs = defaultTransmitPGNs
  if (this.options.transmitPGNs) {
    this.transmitPGNs = _.union(this.transmitPGNs, this.options.transmitPGNs)
  }

  this.options.disableSetTransmitPGNs = true

  if (process.env.DISABLESETTRANSMITPGNS) {
    this.options.disableSetTransmitPGNs = true
  }
  if (process.env.ENABLESETTRANSMITPGNS) {
    this.options.disableSetTransmitPGNs = false
  }

  this.start()
}

inherits(ActisenseStream, Transform)

ActisenseStream.prototype.start = function (this: any) {
  // A close of the previous port is under way: its callback starts again.
  if (this.closingPort) {
    return
  }
  if (this.serial !== null) {
    const old = this.serial
    old.unpipe(this)
    old.removeAllListeners()
    // A late error from the port being dropped is of no interest now.
    old.on('error', () => {})
    // A reconnect after an error finds the port still open, holding its
    // lock: opening the device again then fails with "Cannot lock port",
    // which reconnects again, while the old port goes on reading with
    // nobody listening (#454). Close it first, and open once it is closed;
    // if the close fails, keep the port and try closing it again later.
    if (old.closing) {
      // serialport is already closing it (isOpen turns false as soon as a
      // close starts): wait for that close to finish.
      // If that close fails, serialport emits 'error' instead: keep the
      // port, and close it again on the next reconnect.
      this.closingPort = old
      const onClose = () => {
        old.removeListener('error', onError)
        this.closingPort = undefined
        this.serial = null
        this.start()
      }
      const onError = (err: any) => {
        old.removeListener('close', onClose)
        this.closingPort = undefined
        this.debug(`closing ${this.options.device} failed: ${err?.message}`)
        this.scheduleReconnect()
      }
      old.once('close', onClose)
      old.once('error', onError)
      return
    }
    if (old.isOpen) {
      this.closingPort = old
      old.close((err: any) => {
        this.closingPort = undefined
        if (err && old.isOpen) {
          this.debug(`closing ${this.options.device} failed: ${err.message}`)
          this.scheduleReconnect()
          return
        }
        this.serial = null
        this.start()
      })
      return
    }
    this.serial = null
  }

  if (this.reconnect === false) {
    return
  }

  const setProviderStatus =
    this.options.app && this.options.app.setProviderStatus
      ? (msg: string) => {
          this.options.app.setProviderStatus(this.options.providerId, msg)
        }
      : () => {}
  const setProviderError =
    this.options.app && this.options.app.setProviderError
      ? (msg: string) => {
          this.options.app.setProviderError(this.options.providerId, msg)
        }
      : () => {}
  this.setProviderStatus = setProviderStatus

  this.buffer = Buffer.alloc(500)
  this.bufferOffset = 0
  this.isFile = false
  this.state = MSG_START
  this.productInfo = undefined
  this.productInfoParts = {}

  if (typeof this.reconnectDelay === 'undefined') {
    this.reconnectDelay = 1000
  }

  if (!this.options.fromFile) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { SerialPort } = require('serialport')
      this.serial = new SerialPort({
        path: this.options.device,
        baudRate: this.options.baudrate || 115200
      })
    } catch (err) {
      setProviderError('serialport module not available')
      console.error(err)
      return
    }

    this.serial.on('data', (data: Buffer) => {
      try {
        readData(this, data)
      } catch (err: any) {
        setProviderError(err.message)
        console.error(err)
      }
    })

    // start() runs again on every reconnect: replace the handlers of the
    // previous connection rather than adding to them.
    unsubscribeApp(this)
    if (this.options.app) {
      const outEvents = (this.options.outEvent || 'nmea2000out')
        .split(',')
        .map((event: string) => event.trim())
      outEvents.forEach((event: string) => {
        subscribeApp(this, this.options.app, event, (msg: any) => {
          if (typeof msg === 'string') {
            this.sendString(msg)
          } else {
            this.sendPGN(msg)
          }
        })
      })

      const jsonOutEvents = (this.options.jsonOutEvent || 'nmea2000JsonOut')
        .split(',')
        .map((event: string) => event.trim())
      jsonOutEvents.forEach((event: string) => {
        subscribeApp(this, this.options.app, event, (msg: PGN) => {
          this.sendPGN(msg)
        })
      })
    }

    this.outAvailable = false

    this.serial.on('error', (err: any) => {
      setProviderError(err.message)
      console.log(err)
      this.scheduleReconnect()
    })
    this.serial.on('close', () => {
      setProviderError('Closed, reconnecting...')
      //this.start.bind(this)
      this.scheduleReconnect()
    })
    this.serial.on('open', () => {
      try {
        this.reconnectDelay = 1000
        setProviderStatus(`Connected to ${this.options.device}`)
        setUpGateway(this)
        this.gotStartupResponse = false
        if (this.options.disableSetTransmitPGNs) {
          setTimeout(() => enableOutput(this), MODE_SETTLE_MS)
        } else {
          setTimeout(() => {
            if (this.gotStartupResponse === false) {
              this.debug('retry Product Info and Set Operating Mode...')
              setUpGateway(this)
            }
          }, 5000)
        }
      } catch (err: any) {
        setProviderError(err.message)
        console.error(err)
        console.error(err.stack)
      }
    })
  }
}

ActisenseStream.prototype.sendString = function (this: any, msg: string) {
  if (!this.outAvailable) return
  this.debugOut(`sending ${msg}`)
  let buf = parseInput(msg)
  buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
  this.debugOut(buf)
  this.serial.write(buf)
  if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
    this.options.app.emit('canboatjs:rawsend', { data: msg })
  }
  this.options.app.emit('connectionwrite', {
    providerId: this.options.providerId
  })
}

ActisenseStream.prototype.sendPGN = function (this: any, pgn: PGN) {
  if (!this.outAvailable) return
  const data = toPgn(pgn)
  const actisense = encodeActisense({
    pgn: pgn.pgn,
    data,
    dst: pgn.dst,
    // NGT-1 send frames do not carry a caller-provided source address;
    // the gateway transmits using its own claimed NMEA 2000 address.
    src: 0,
    prio: pgn.prio
  })
  this.debugOut(`sending ${actisense}`)
  let buf = parseInput(actisense)
  buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
  this.debugOut(buf)
  this.serial.write(buf)
  if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
    this.options.app.emit('canboatjs:rawsend', { data: actisense })
  }
  this.options.app.emit('connectionwrite', {
    providerId: this.options.providerId
  })
}

ActisenseStream.prototype.scheduleReconnect = function () {
  // One reconnect at a time: an error is followed by a close, and both ask
  // for one. Keep the reconnect already planned, and its backoff.
  if (this.reconnectTimer) {
    return
  }
  if (this.options.reconnect === undefined || this.options.reconnect === true) {
    this.reconnectDelay *= this.reconnectDelay < 60 * 1000 ? 1.5 : 1
    const msg = `Not connected (retry delay ${(
      this.reconnectDelay / 1000
    ).toFixed(0)} s)`
    this.debug(msg)
    this.setProviderStatus(msg)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.start()
    }, this.reconnectDelay)
  }
}

function readData(that: any, data: Buffer) {
  for (let i = 0; i < data.length; i++) {
    //console.log(data[i])
    read1Byte(that, data[i])
  }
}

function read1Byte(that: any, c: any) {
  let noEscape = false

  //debug("received byte %02x state=%d offset=%d\n", c, state, head - buf);

  if (that.state == MSG_START) {
    if (c == ESC && that.isFile) {
      noEscape = true
    }
  }

  if (that.state == MSG_ESCAPE) {
    if (c == ETX) {
      if (!that.options.outputOnly) {
        if (that.buffer[0] == N2K_MSG_RECEIVED) {
          processN2KMessage(that, that.buffer, that.bufferOffset)
        } else if (that.buffer[0] == NGT_MSG_RECEIVED) {
          processNGTMessage(that, that.buffer, that.bufferOffset)
        }
      }
      that.bufferOffset = 0
      that.state = MSG_START
    } else if (c == STX) {
      that.bufferOffset = 0
      that.state = MSG_MESSAGE
    } else if (c == DLE || (c == ESC && that.isFile) || that.noEscape) {
      storeByte(that, c)
      that.state = MSG_MESSAGE
    } else {
      console.error(
        `DLE followed by unexpected char 0x${c.toString(16).padStart(2, '0')}, ignore message`
      )
      that.bufferOffset = 0
      that.state = MSG_START
    }
  } else if (that.state == MSG_MESSAGE) {
    if (c == DLE) {
      that.state = MSG_ESCAPE
    } else if (that.isFile && c == ESC && !noEscape) {
      that.state = MSG_ESCAPE
    } else {
      storeByte(that, c)
    }
  } else {
    if (c == DLE) {
      that.state = MSG_ESCAPE
    }
  }
}

/**
 * One byte of a message: dropped once the buffer is full, as canboat's
 * readNGT1Byte does, so a frame with no terminator for 500 bytes cannot
 * overrun the buffer; the frame still ends at its DLE ETX.
 */
function storeByte(that: any, c: number) {
  if (that.bufferOffset < that.buffer.length) {
    that.buffer.writeUInt8(c, that.bufferOffset)
    that.bufferOffset++
  }
}

/**
 * Ask for the gateway's Product Info, then set NGT Transfer Rx All Mode.
 * Product Info goes first: the gateway ignores commands for a while after
 * Set Operating Mode. There is no keepalive: the SDK has none, and the
 * gateway keeps the mode in non-volatile memory.
 */
function setUpGateway(that: any) {
  for (const msg of [GET_PRODUCT_INFO_MSG, SET_OPERATING_MODE_MSG]) {
    const buf = composeMessage(NGT_MSG_SEND, Buffer.from(msg), msg.length)
    that.debugOut(buf)
    that.serial.write(buf)
  }
  that.debug('sent Get Product Info and Set Operating Mode')
}

function operatingModeName(mode: number) {
  return OPERATING_MODES[mode] || `operating mode ${mode}`
}

/**
 * Check the gateway's answer to Set Operating Mode: it carries the mode in
 * force, which is warned about when it is not the one set.
 */
function onOperatingMode(that: any, bem: any) {
  if (bem.data.length < 2) {
    return
  }
  const mode = bem.data.readUInt16LE(0)
  if (bem.error !== 0) {
    console.warn(
      `actisense: the gateway refused ${operatingModeName(OPERATING_MODE_RX_ALL)} (error ${bem.error}); it stays in ${operatingModeName(mode)}`
    )
  } else if (mode !== OPERATING_MODE_RX_ALL) {
    console.warn(
      `actisense: the gateway is in ${operatingModeName(mode)}, not ${operatingModeName(OPERATING_MODE_RX_ALL)}`
    )
  }
  that.debug(
    'gateway model 0x%s, serial %d, in %s',
    bem.modelId.toString(16).padStart(4, '0'),
    bem.serial,
    operatingModeName(mode)
  )
}

/**
 * A Product Info string: ASCII, ended by a NUL or 0xFF padding.
 */
function productString(data: Buffer) {
  let end = data.findIndex((b) => b === 0 || b === 0xff)
  if (end === -1) {
    end = data.length
  }
  return data.toString('latin1', 0, end).trim()
}

/**
 * The firmware version × 1000: the last `major.minor` number in the
 * software version, which an NGT-1 gives as "1.100, 2.690".
 */
export function firmwareVersion(softwareVersion: string): number | undefined {
  const versions = softwareVersion.match(/(?<![\d.])\d+\.\d{1,3}(?![\d.])/g)
  if (!versions) {
    return undefined
  }
  const [major, minor] = versions[versions.length - 1].split('.')
  return Number(major) * 1000 + Number(minor.padEnd(3, '0'))
}

/**
 * Take in one answer to Get Product Info. Newer firmware answers in one
 * message (sequence 6, Format 2); the NGT-1 and NGW-1 answer in five,
 * numbered 1 to 5 by the sequence byte (Format 1).
 */
function onProductInfo(that: any, bem: any) {
  const d: Buffer = bem.data
  const parts = that.productInfoParts
  if (bem.sequence === 6 && d.length >= 138) {
    parts[1] = {
      nmea2000Version: d.readUInt16LE(4),
      productCode: d.readUInt16LE(6)
    }
    parts[2] = productString(d.subarray(8, 40))
    parts[3] = productString(d.subarray(40, 72))
    parts[4] = productString(d.subarray(72, 104))
    parts[5] = productString(d.subarray(104, 136))
  } else if (bem.sequence === 1 && d.length >= 6) {
    parts[1] = {
      nmea2000Version: d.readUInt16LE(0),
      productCode: d.readUInt16LE(2)
    }
  } else if (bem.sequence >= 2 && bem.sequence <= 5 && d.length >= 32) {
    parts[bem.sequence] = productString(d.subarray(0, 32))
  } else {
    return
  }
  if (![1, 2, 3, 4, 5].every((part) => parts[part] !== undefined)) {
    return
  }

  const info = {
    model: parts[2],
    softwareVersion: parts[3],
    hardwareVersion: parts[4],
    serialNumber: parts[5],
    productCode: parts[1].productCode,
    nmea2000Version: parts[1].nmea2000Version,
    firmware: firmwareVersion(parts[3])
  }
  that.productInfo = info
  that.productInfoParts = {}
  that.debug('product info: %j', info)
  that.setProviderStatus(
    `Connected to ${that.options.device}: ${info.hardwareVersion || info.model}, software ${info.softwareVersion}, serial ${info.serialNumber}`
  )
}

/**
 * Split a BEM answer (an NGT_MSG_RECEIVED frame: command, length, payload,
 * checksum) into its header and data; undefined when it is shorter than
 * the header.
 */
function parseBemResponse(buffer: Buffer, len: number) {
  if (len - 3 < BEM_HEADER_LENGTH) {
    return undefined
  }
  return {
    bem: buffer[2],
    sequence: buffer[3],
    modelId: buffer.readUInt16LE(4),
    serial: buffer.readUInt32LE(6),
    error: buffer.readInt32LE(10),
    data: buffer.subarray(2 + BEM_HEADER_LENGTH, len - 1)
  }
}

function enableTXPGN(that: any, pgn: number) {
  that.debug('enabling pgn %d', pgn)
  const msg = composeEnablePGN(pgn)
  that.debugOut(msg)
  that.serial.write(msg)
}

function enableOutput(that: any) {
  that.debug('outputEnabled')
  that.outAvailable = true
  if (that.options.app) {
    that.options.app.emit('nmea2000OutAvailable')
  }
}

function requestTransmitPGNList(that: any) {
  that.debug('request tx pgns...')
  const requestMsg = composeRequestTXPGNList()
  that.debugOut(requestMsg)
  that.serial.write(requestMsg)
  setTimeout(() => {
    if (!that.gotTXPGNList) {
      if (that.transmitPGNRetries-- > 0) {
        that.debug('did not get tx pgn list, retrying...')
        requestTransmitPGNList(that)
      } else {
        const msg = 'could not set transmit pgn list'
        that.options.app.setProviderStatus(msg)
        console.warn(msg)
        enableOutput(that)
      }
    }
  }, 10000)
}

function processNGTMessage(that: any, buffer: Buffer, len: number) {
  // As for N2K frames: the buffered frame must match its declared length
  // (type + length + payload + checksum), and the payload must at least
  // hold the command. A frame cut short by the buffer limit is dropped.
  const payloadLen = buffer[1]
  if (payloadLen < 1 || len !== payloadLen + 3) {
    that.debug(
      'discarding malformed NGT frame (len=%d, payloadLen=%d)',
      len,
      payloadLen
    )
    return
  }

  let checksum = 0

  for (let i = 0; i < len; i++) {
    checksum = addUInt8(checksum, buffer[i])
  }

  const command = buffer[2]

  if (checksum != 0) {
    that.debug('received message with invalid checksum (%d,%d)', command, len)
    return
  }

  if (that.options.sendNetworkStats || that.debug.enabled) {
    const newbuf = Buffer.alloc(len + 7)
    const bs = new BitStream(newbuf)
    const pgn = 0x40000 + buffer[2]
    bs.writeUint8(0) //prio
    bs.writeUint8(pgn)
    bs.writeUint8(pgn >> 8)
    bs.writeUint8(pgn >> 16)
    bs.writeUint8(0) //dst
    bs.writeUint8(0) //src
    bs.writeUint32(0) //timestamp
    bs.writeUint8(len - 4)
    buffer.copy(bs.view.buffer, bs.byteIndex, 3)

    if (that.options.plainText) {
      that.push(binToActisense(bs.view.buffer)) //, len + 7))
    } else {
      that.push(bs.view.buffer, len + 7)
    }
    if (that.debug.enabled && command != 0xf2) {
      //don't log system status
      if (!that.parser) {
        that.parser = new FromPgn({})
      }
      const js = that.parser.parseBuffer(bs.view.buffer)
      if (js) {
        that.debug('got ntg message: %j', js)
      }
    }
  }

  const bem = parseBemResponse(buffer, len)
  if (command === BEM_OPERATING_MODE) {
    that.gotStartupResponse = true
    that.debug('got Set Operating Mode answer')
    if (bem) {
      onOperatingMode(that, bem)
    }
  } else if (command === BEM_PRODUCT_INFO && bem) {
    onProductInfo(that, bem)
  }

  // Output is held for a while after Set Operating Mode either way; only
  // the transmit-list sync sets the gateway up meanwhile.
  if (!that.outAvailable && !that.options.disableSetTransmitPGNs) {
    if (command === BEM_OPERATING_MODE) {
      that.gotTXPGNList = false
      setTimeout(() => {
        requestTransmitPGNList(that)
      }, 2000)
    } else if (command === 0x49 && buffer[3] === 1) {
      that.gotTXPGNList = true
      const pgnCount = buffer[14]
      const bv = new BitView(buffer.slice(15, that.bufferOffset))
      const bs = new BitStream(bv)
      const pgns: number[] = []
      for (let i = 0; i < pgnCount; i++) {
        pgns.push(bs.readUint32())
      }
      that.debug('tx pgns: %j', pgns)

      that.neededTransmitPGNs = that.transmitPGNs.filter((pgn: number) => {
        return pgns.indexOf(pgn) == -1
      })
      that.debug('needed pgns: %j', that.neededTransmitPGNs)
    } else if (command === 0x49 && buffer[3] === 4) {
      //I think this means done receiving the pgns list
      if (that.neededTransmitPGNs) {
        if (that.neededTransmitPGNs.length) {
          enableTXPGN(that, that.neededTransmitPGNs[0])
        } else {
          enableOutput(that)
        }
      }
    } else if (command === 0x47) {
      //response from enable a pgn
      if (buffer[3] === 1) {
        that.debug('enabled %d', that.neededTransmitPGNs[0])
        that.neededTransmitPGNs = that.neededTransmitPGNs.slice(1)
        if (that.neededTransmitPGNs.length === 0) {
          const commitMsg = composeCommitTXPGN()
          that.debugOut(commitMsg)
          that.serial.write(commitMsg)
        } else {
          enableTXPGN(that, that.neededTransmitPGNs[0])
        }
      } else {
        that.debug('bad response from Enable TX: %d', buffer[3])
      }
    } else if (command === 0x01) {
      that.debug('commited tx list')
      const activateMsg = composeActivateTXPGN()
      that.debugOut(activateMsg)
      that.serial.write(activateMsg)
    } else if (command === 0x4b) {
      that.debug('activated tx list')
      enableOutput(that)
    }
  }
}

function addUInt8(num: number, add: number) {
  if (num + add > 255) {
    num = add - (256 - num)
  } else {
    num += add
  }
  return num
}

function processN2KMessage(that: any, buffer: Buffer, len: number) {
  // N2K received payloads must include the fixed 11-byte prefix that
  // binToActisense reads, and the buffered frame must match the Actisense
  // declared payload length exactly: command + length + payload + checksum.
  const payloadLen = buffer[1]
  if (payloadLen < 11 || len !== payloadLen + 3) {
    that.debug(
      'discarding malformed N2K frame (len=%d, payloadLen=%d)',
      len,
      payloadLen
    )
    return
  }

  let checksum = 0

  for (let i = 0; i < len; i++) {
    checksum = addUInt8(checksum, buffer[i])
  }

  if (checksum != 0) {
    that.debug('received message with invalid checksum')
    return
  }

  if (that.options.plainText) {
    const data = binToActisense(buffer.slice(2, len))
    that.push(data)
    if (that.options.app.listenerCount('canboatjs:rawoutput') > 0) {
      that.options.app.emit('canboatjs:rawoutput', data)
    }
  } else {
    that.push(buffer.slice(2, len))
    if (that.options.app.listenerCount('canboatjs:rawoutput') > 0) {
      const data = binToActisense(buffer.slice(2, len))
      that.options.app.emit('canboatjs:rawoutput', data)
    }
  }
}

function binToActisense(buffer: Buffer) {
  const bv = new BitView(buffer)
  const bs = new BitStream(bv)

  const pgn = {
    prio: bs.readUint8(),
    pgn: bs.readUint8() + 256 * (bs.readUint8() + 256 * bs.readUint8()),
    dst: bs.readUint8(),
    src: bs.readUint8(),
    timestamp: bs.readUint32()
  }
  const len = bs.readUint8()
  const arr: string[] = []
  return (
    new Date().toISOString() +
    `,${pgn.prio},${pgn.pgn},${pgn.src},${pgn.dst},${len},` +
    new Uint32Array(buffer.slice(11, 11 + len))
      .reduce(function (acc, i) {
        acc.push(i.toString(16))
        return acc
      }, arr)
      .map((x) => (x.length === 1 ? '0' + x : x))
      .join(',')
  )
}

export function composeMessage(command: number, buffer: Buffer, len: number) {
  const outBuf = Buffer.alloc(500)
  const out = new BitStream(outBuf)

  out.writeUint8(DLE)
  out.writeUint8(STX)
  out.writeUint8(command)
  out.writeUint8(len)
  if (len == DLE) {
    out.writeUint8(DLE)
  }
  let crc = addUInt8(command, len)

  for (let i = 0; i < len; i++) {
    const c = buffer.readUInt8(i)
    if (c == DLE) {
      out.writeUint8(DLE)
    }
    out.writeUint8(c)
    crc = addUInt8(crc, c)
  }

  const checksum = (256 - crc) & 0xff
  if (checksum == DLE) {
    out.writeUint8(DLE)
  }
  out.writeUint8(checksum)
  out.writeUint8(DLE)
  out.writeUint8(ETX)

  return out.view.buffer.slice(0, out.byteIndex)
}

function parseInput(msg: string) {
  const split = msg.split(',')
  const buffer = Buffer.alloc(500)
  const bs = new BitStream(buffer)

  const prio = Number(split[1])
  const pgn = Number(split[2])
  const dst = Number(split[4])
  const bytes = Number(split[5])

  bs.writeUint8(prio)
  bs.writeUint8(pgn)
  bs.writeUint8(pgn >> 8)
  bs.writeUint8(pgn >> 16)
  bs.writeUint8(dst)

  /*
  bs.writeUint8(split[3])
  bs.writeUint32(0)
  */

  bs.writeUint8(bytes)

  for (let i = 6; i < bytes + 6; i++) {
    bs.writeUint8(parseInt('0x' + split[i], 16))
  }

  return bs.view.buffer.slice(0, bs.byteIndex)
}

function composeCommitTXPGN() {
  const msg = new Uint32Array([0x01])
  return composeMessage(NGT_MSG_SEND, Buffer.from(msg), msg.length)
}

function composeActivateTXPGN() {
  const msg = new Uint32Array([0x4b])
  return composeMessage(NGT_MSG_SEND, Buffer.from(msg), msg.length)
}

function composeRequestTXPGNList() {
  const msg = new Uint32Array([0x49])
  return composeMessage(NGT_MSG_SEND, Buffer.from(msg), msg.length)
}

function composeEnablePGN(pgn: number) {
  const outBuf = Buffer.alloc(14)
  const out = new BitStream(outBuf)
  out.writeUint8(0x47)
  out.writeUint32(pgn)
  out.writeUint8(1) //enabled

  out.writeUint32(0xfffffffe)
  out.writeUint32(0xfffffffe)

  const res = composeMessage(
    NGT_MSG_SEND,
    out.view.buffer.slice(0, out.byteIndex),
    out.byteIndex
  )

  //that.debug('composeEnablePGN: %o', res)

  return res
}

/*
function composeDisablePGN(pgn) {
  var outBuf = Buffer.alloc(14);
  let out = new BitStream(outBuf)
  out.writeUint8(0x47)
  out.writeUint32(pgn)
  out.writeUint8(0) //disabled

  //disbale system time
  //10 02 a1 0e 47 10 10 f0 01 00 00 e8 03 00 00 00 00 00 00 1e 10 03

  out.writeUint32(0x000003e8) //???
  out.writeUint32(0x00)

  let res = composeMessage(NGT_MSG_SEND, out.view.buffer.slice(0, out.byteIndex), out.byteIndex)
  
  that.debug('composeDisablePGN: %o', res)
  
  return res;
  }
  */

ActisenseStream.prototype.end = function () {
  // Closing the port fires 'close', which would reconnect: an intentional
  // end must not start again, nor leave its handlers on the app.
  this.reconnect = false
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }
  unsubscribeApp(this)
  if (this.serial) {
    this.serial.close()
  }
}

ActisenseStream.prototype._transform = function (
  chunk: any,
  encoding: string,
  done: any
) {
  this.debug(`got data ${typeof chunk}`)
  readData(this, chunk)
  done()
}
