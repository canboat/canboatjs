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
const BEM_STARTUP_STATUS = 0xf0 /* sent when the gateway has (re)started */
const BEM_ERROR_REPORT = 0xf1 /* sent when the gateway hits an error */
const BEM_NEGATIVE_ACK = 0xf4 /* the gateway could not carry out a command */

const BEM_COMMIT_TO_EEPROM = 0x01 /* Commit To EEPROM */
const BEM_SUPPORTED_PGN_LIST = 0x40 /* Get Supported PGN List */
const BEM_TX_PGN_ENABLE = 0x47 /* Get / Set Tx PGN Enable */
const BEM_TX_PGN_ENABLE_LIST_F1 = 0x49 /* Get Tx PGN Enable List F1 */
const BEM_ACTIVATE_PGN_ENABLE_LISTS = 0x4b /* Activate PGN Enable Lists */
const BEM_TX_PGN_ENABLE_LIST_F2 = 0x4f /* Get Tx PGN Enable List F2 */

const BEM_HEADER_LENGTH = 12

/* The SDK's names for the (negative) error codes in a BEM answer. It
   publishes only part of the list, so other codes have no name. */
const BEM_ERRORS: { [code: number]: string } = {
  [-1137]: 'BST-BEM message not valid',
  [-1138]: 'model ID unknown',
  [-1139]: 'no definition for the datatype',
  [-1140]: 'bad comms data',
  [-1152]: 'command does not fit the model',
  [-1153]: 'invalid stream',
  [-1154]: 'invalid address',
  [-1156]: 'unexpected datatype',
  [-1158]: 'command timeout',
  [-1159]: 'command data out of range',
  [-1160]: 'command buffer overrun',
  [-1168]: 'invalid checksum',
  [-1169]: 'buffer underflow',
  [-1170]: 'buffer overflow',
  [-1173]: 'invalid baud rate',
  [-1176]: 'port does not exist',
  [-1177]: 'port number out of range',
  [-1497]: 'EEPROM sector error',
  [-1498]: 'malloc/free error',
  [-1499]: 'model ID invalid',
  [-1995]: 'null value',
  [-1997]: 'bad pointer',
  [-1998]: 'null pointer'
}

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
/* Operating Mode with no data asks for the mode in force. */
const GET_OPERATING_MODE_MSG = new Uint8Array([BEM_OPERATING_MODE])
const GET_PRODUCT_INFO_MSG = new Uint8Array([BEM_PRODUCT_INFO])

/* Setting the mode is not free. An NGT-1 (software 1.100 / 2.690) restarts
   about 150 ms after it answers Set Operating Mode, even to the mode it is
   already in: its own clock starts again from zero, and with P-Codes on it
   says so with a Startup Status (canboat#1122). Meanwhile it drops what is
   written to it, BEM commands for 50-200 ms and N2K messages for
   400-450 ms. So the mode is asked for, and set only when it differs, at
   most once per connection; frames for the bus are held, not dropped,
   until the gateway has settled, as canboat does (canboat#1034, #1134). */
const MODE_SETTLE_MS = 500
/* How long after opening frames wait for the gateway to report its mode:
   an NGT-1 answers in about 15 ms. */
const MODE_ANSWER_MS = 2000
/* Get Operating Mode is asked again after this long without an answer, up
   to MODE_TRIES times: a gateway still starting may drop the request, and
   the transmit list is read only once the mode is known. */
const MODE_RETRY_MS = 1000
const MODE_TRIES = 3
/* A gateway that has answered no BEM command yet may still be starting:
   it is asked for the mode every 5 s, for a minute. */
const NOT_READY_RETRY_MS = 5000
const NOT_READY_TRIES = 12
/* A Startup Status this soon after our Set Operating Mode is the restart it
   causes, not a surprise. */
const RESTART_AFTER_SET_MS = 2000
/* Frames held at most, while the gateway is not ready; more are dropped. */
const MAX_HELD = 500

/* BEM 0x13, Get / Set Port P-Code
   (https://github.com/Actisense/SDK/blob/main/docs/DataFormats/Binary/bem-detail/port-pcode-config.md).
   With P-Codes on, the gateway sends Actisense: System status (BEM 0xF2),
   with the bus load and error counts, about once a second. Get takes no
   data; Set takes the number of ports and one byte per port (0 off, 1 on,
   0xFF no change), and both are answered with the number of ports and one
   byte per port, any non-zero being on. The SDK's Set has no count, but an
   NGT-1 with software 2.690 refuses that with -1096 (invalid parameter
   length) and takes it with the count. The gateway saves the setting in
   EEPROM, so it is written only when it differs from what is asked. */
const BEM_PORT_PCODE = 0x13
const PCODE_ANSWER_TIMEOUT_MS = 3000
const PCODE_ATTEMPTS = 2

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

  // What to do with the gateway's P-Codes: every port on unless asked
  // otherwise, so that it sends its System status.
  try {
    this.pcodeRequest = parsePCodeRequest(this.options.pcode)
  } catch (err: any) {
    console.warn(`actisense: pcode: ${err.message}; leaving the P-Codes alone`)
    this.pcodeRequest = { keep: true }
  }
  // The PGNs warned about as missing from the gateway's transmit list, and
  // those sent before it was read.
  this.warnedNotOnTxList = new Set()
  this.sentBeforeTxList = new Set()

  this.start()
}

/**
 * What to do with the NGT-1's P-Codes, from the `pcode` option: `on` (the
 * default) or `off` for every port, `keep` to leave them alone, `get` to
 * only read them, or `<port>=on|off[,...]` for the ports named.
 */
export function parsePCodeRequest(text: unknown): any {
  if (text === undefined || text === null || text === '') {
    return { all: true }
  }
  if (typeof text === 'boolean') {
    return { all: text }
  }
  const value = String(text).trim()
  switch (value.toLowerCase()) {
    case 'on':
      return { all: true }
    case 'off':
      return { all: false }
    case 'keep':
      return { keep: true }
    case 'get':
      return { get: true }
  }
  const ports: [number, boolean][] = []
  for (const part of value.split(',')) {
    const [port, setting, ...rest] = part.split('=').map((s) => s.trim())
    if (setting === undefined || rest.length) {
      throw new Error(`'${part}': give on, off, keep, get or <port>=on|off`)
    }
    if (!/^\d+$/.test(port)) {
      throw new Error(`'${port}': not a port number`)
    }
    const on = { on: true, '1': true, off: false, '0': false }[
      setting.toLowerCase()
    ]
    if (on === undefined) {
      throw new Error(`'${setting}': give on or off`)
    }
    if (ports.some(([p]) => p === Number(port))) {
      throw new Error(`port ${port} is named twice`)
    }
    ports.push([Number(port), on])
  }
  return { ports }
}

/* What port `port` should be, or undefined to leave it as it is. */
function pcodeWanted(request: any, port: number): boolean | undefined {
  if (request.all !== undefined) {
    return request.all
  }
  return request.ports?.find(([p]: [number, boolean]) => p === port)?.[1]
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
  // A timer of the previous port must not act on this one.
  clearTimers(this)
  this.txList = undefined
  // A new connection: the mode may be set once again, frames held for the
  // old one are dropped, and the gateway is not known to answer yet.
  this.modeSetAt = undefined
  this.modeAsked = undefined
  this.hold = { state: 'settled' }
  this.held = []
  this.bemSeen = false
  this.txKnown = undefined
  this.pcode = { state: 'idle' }

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
      } catch (err: any) {
        setProviderError(err.message)
        console.error(err)
        console.error(err.stack)
      }
    })
  }
}

ActisenseStream.prototype.sendString = function (this: any, msg: string) {
  this.debugOut(`sending ${msg}`)
  let buf = parseInput(msg)
  buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
  sendFrame(this, buf, msg, Number(msg.split(',')[2]))
}

ActisenseStream.prototype.sendPGN = function (this: any, pgn: PGN) {
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
  sendFrame(this, buf, actisense, pgn.pgn)
}

/**
 * Write a frame for the bus, or hold it while the gateway is not ready:
 * opening, restarting, or settling after Set Operating Mode. Held frames
 * go out in order once it is.
 */
function sendFrame(that: any, buf: Buffer, actisense: string, pgn: number) {
  warnIfNotOnTxList(that, pgn)
  if (!that.outAvailable) {
    if (that.held.length < MAX_HELD) {
      that.held.push({ buf, actisense })
    } else {
      that.debug('holding %d frames already, dropping one', MAX_HELD)
    }
    return
  }
  writeFrame(that, buf, actisense)
}

function writeFrame(that: any, buf: Buffer, actisense: string) {
  if (!that.serial) {
    return
  }
  that.debugOut(buf)
  that.serial.write(buf)
  if (that.options.app.listenerCount('canboatjs:rawsend') > 0) {
    that.options.app.emit('canboatjs:rawsend', { data: actisense })
  }
  that.options.app.emit('connectionwrite', {
    providerId: that.options.providerId
  })
}

/**
 * Say so, once per PGN, when the gateway's transmit list lacks a PGN sent:
 * an NGT-1 drops it without a word (canboat#1072). Only once the list has
 * been read; a Format 1 read can miss PGNs, so then it may be dropped.
 */
function warnIfNotOnTxList(that: any, pgn: number) {
  const known = that.txKnown
  if (!Number.isFinite(pgn) || that.warnedNotOnTxList.has(pgn)) {
    return
  }
  if (!known) {
    // Checked once the list has been read: a frame held while the gateway
    // set up is usually sent before then.
    that.sentBeforeTxList.add(pgn)
    return
  }
  if (known.pgns.includes(storedPgn(pgn))) {
    return
  }
  that.warnedNotOnTxList.add(pgn)
  const fix =
    'add it to the transmitPGNs option and set ENABLESETTRANSMITPGNS to put it on the list'
  console.warn(
    known.complete
      ? `actisense: PGN ${pgn} is not on the NGT-1's transmit list, which drops it; ${fix}`
      : `actisense: PGN ${pgn} is not on the NGT-1's transmit list as read (Format 1, which can miss some), so it may be dropped; ${fix}`
  )
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

function clearTimers(that: any) {
  clearTimeout(that.setUpTimer)
  clearTimeout(that.modeTimer)
  clearTimeout(that.txListTimer)
  clearTimeout(that.pcodeTimer)
}

function sendNgt(that: any, msg: Uint8Array) {
  const buf = composeMessage(NGT_MSG_SEND, Buffer.from(msg), msg.length)
  that.debugOut(buf)
  that.serial.write(buf)
}

/**
 * Set the gateway up when the port opens: ask for its Product Info and its
 * operating mode. The mode is set only when the answer shows another one
 * (onOperatingMode). Frames for the bus are held until the gateway reports
 * its mode, at most MODE_ANSWER_MS, and for MODE_SETTLE_MS after a Set.
 * There is no keepalive: the SDK has none, and the gateway keeps the mode
 * in non-volatile memory.
 */
function setUpGateway(that: any) {
  readGatewaySettings(that)
  const now = Date.now()
  holdUntilMode(that, now, now + MODE_ANSWER_MS)
}

/**
 * Ask for the gateway's Product Info and operating mode, and start reading
 * its transmit list and P-Codes again: on open, and after it restarted.
 * Product Info goes first, as the gateway ignores commands for a while
 * after Set Operating Mode.
 */
function readGatewaySettings(that: any) {
  that.productInfo = undefined
  that.productInfoParts = {}
  that.gotStartupResponse = false
  // The list is read again, so it is not known until then.
  that.txKnown = undefined
  clearTimeout(that.txListTimer)
  that.txList = { step: 'awaitStartup' }
  clearTimeout(that.pcodeTimer)
  that.pcode = { state: 'idle' }
  sendNgt(that, GET_PRODUCT_INFO_MSG)
  sendNgt(that, GET_OPERATING_MODE_MSG)
  that.debug('sent Get Product Info and Get Operating Mode')
  askModeAgainLater(that, 1)
}

/* Ask for the mode again when no answer came. A gateway that answers BEM
   commands is asked MODE_TRIES times in all, MODE_RETRY_MS apart, then
   warned about. One that has answered nothing yet may still be starting:
   it is asked every NOT_READY_RETRY_MS, for NOT_READY_TRIES times. */
function askModeAgainLater(that: any, tries: number) {
  that.modeAsked = tries
  clearTimeout(that.modeTimer)
  const ready = that.bemSeen
  that.modeTimer = setTimeout(
    () => {
      if (that.modeAsked === undefined) {
        return
      }
      if (!that.bemSeen) {
        if (tries < NOT_READY_TRIES) {
          that.debug(
            'no answer from the gateway yet, asking for the mode again'
          )
          sendNgt(that, GET_OPERATING_MODE_MSG)
          askModeAgainLater(that, tries + 1)
        } else {
          that.debug('the gateway answers no BEM command')
          that.modeAsked = undefined
        }
        return
      }
      // The first answer came meanwhile: count the tries from here.
      const sent = ready ? tries : 1
      if (sent < MODE_TRIES) {
        that.debug('no answer to Get Operating Mode, asking again')
        sendNgt(that, GET_OPERATING_MODE_MSG)
        askModeAgainLater(that, sent + 1)
      } else {
        console.warn(
          'actisense: the gateway does not report its operating mode; not reading its transmit list'
        )
        that.modeAsked = undefined
      }
    },
    ready ? MODE_RETRY_MS : NOT_READY_RETRY_MS
  )
}

/* When the current hold ends at the earliest: 0 when nothing is held. */
function heldUntil(that: any) {
  const hold = that.hold
  return hold.state === 'until'
    ? hold.until
    : hold.state === 'awaitMode'
      ? hold.notBefore
      : 0
}

/* Hold frames for the bus until the gateway reports its mode, but not
   before `notBefore`, and at the latest until `until`. */
function holdUntilMode(that: any, notBefore: number, until: number) {
  that.hold = { state: 'awaitMode', notBefore, until }
  holdOutput(that, until)
}

/* Hold frames for the bus until `until`. */
function holdFor(that: any, until: number) {
  that.hold = { state: 'until', until }
  holdOutput(that, until)
}

function holdOutput(that: any, until: number) {
  that.outAvailable = false
  clearTimeout(that.setUpTimer)
  that.setUpTimer = setTimeout(
    () => releaseHold(that),
    Math.max(0, until - Date.now())
  )
}

/* The gateway has settled: frames for the bus may go out. */
function releaseHold(that: any) {
  clearTimeout(that.setUpTimer)
  that.hold = { state: 'settled' }
  updateOutput(that)
}

/**
 * Let frames for the bus out once the gateway has settled, and, when the
 * transmit list is being set (ENABLESETTRANSMITPGNS), once that is done:
 * send what was held, in order, and say that output is available.
 */
function updateOutput(that: any) {
  const settingTxList =
    !that.options.disableSetTransmitPGNs &&
    that.txList &&
    that.txList.step !== 'done'
  if (that.outAvailable || that.hold.state !== 'settled' || settingTxList) {
    startPCode(that)
    return
  }
  that.debug('outputEnabled')
  that.outAvailable = true
  const held = that.held
  that.held = []
  if (held.length) {
    that.debug(
      'sending %d frames held since opening or Set Operating Mode',
      held.length
    )
  }
  held.forEach(({ buf, actisense }: any) => writeFrame(that, buf, actisense))
  if (that.options.app) {
    that.options.app.emit('nmea2000OutAvailable')
  }
  startPCode(that)
}

/**
 * Read the gateway's P-Codes once it is set up: settled after Set
 * Operating Mode, and its transmit list read, so the command is not lost
 * (canboat#1109). Then set the ports that differ from what is asked.
 */
function startPCode(that: any) {
  const ready =
    that.bemSeen &&
    that.hold.state === 'settled' &&
    that.txList?.step === 'done'
  if (!ready || that.pcode.state !== 'idle') {
    return
  }
  if (that.pcodeRequest.keep) {
    that.pcode = { state: 'done' }
    return
  }
  getPCodes(that, 1)
}

function getPCodes(that: any, attempt: number) {
  that.pcode = { state: 'getting' }
  sendNgt(that, new Uint8Array([BEM_PORT_PCODE]))
  awaitPCodeAnswer(that, attempt, () => getPCodes(that, attempt + 1), 'Get')
}

function setPCodes(that: any, perPort: number[], attempt: number) {
  that.pcode = { state: 'setting', written: perPort }
  sendNgt(that, new Uint8Array([BEM_PORT_PCODE, perPort.length, ...perPort]))
  awaitPCodeAnswer(
    that,
    attempt,
    () => setPCodes(that, perPort, attempt + 1),
    'Set'
  )
}

/* Wait for the answer; ask once more, then give up. Without an explicit
   request older firmware may just not have the command, so that is not
   warned about. */
function awaitPCodeAnswer(
  that: any,
  attempt: number,
  retry: () => void,
  what: string
) {
  clearTimeout(that.pcodeTimer)
  that.pcodeTimer = setTimeout(() => {
    if (attempt < PCODE_ATTEMPTS) {
      retry()
      return
    }
    that.pcode = { state: 'done' }
    const msg = `no answer to ${what} Port P-Code (BEM 0x13); this firmware may not have it`
    if (that.pcodeRequest.all === true) {
      that.debug(msg)
    } else {
      console.warn(`actisense: ${msg}`)
    }
  }, PCODE_ANSWER_TIMEOUT_MS)
}

/* `port 0 off, port 1 on`; 0xFF in a Set is no change. */
function describePCodes(codes: number[]) {
  return codes
    .map((c, i) => {
      const v =
        c === 0
          ? 'off'
          : c === 1
            ? 'on'
            : c === 0xff
              ? 'no change / 0xff'
              : `on (0x${c.toString(16)})`
      return `port ${i} ${v}`
    })
    .join(', ')
}

/* The gateway's answer to Get or Set Port P-Code. */
function onPCodeAnswer(that: any, bem: any) {
  const setting = that.pcode.state === 'setting'
  if (!setting && that.pcode.state !== 'getting') {
    return
  }
  clearTimeout(that.pcodeTimer)
  const what = setting ? 'Set' : 'Get'
  const done = () => (that.pcode = { state: 'done' })
  if (bem.error !== 0) {
    console.warn(
      `actisense: the gateway refused ${what} Port P-Code: error ${describeError(bem.error)}`
    )
    return done()
  }
  // The number of ports, then exactly that many bytes.
  const d: Buffer = bem.data
  if (d.length < 1 || d.length !== d[0] + 1) {
    console.warn(
      `actisense: the answer to ${what} Port P-Code is malformed: ${d.toString('hex')}`
    )
    return done()
  }
  const codes = [...d.subarray(1)]
  that.debug('P-Codes per port: %s', describePCodes(codes))
  const request = that.pcodeRequest
  if (setting) {
    const missed = codes
      .map((c, i) => [i, pcodeWanted(request, i), c !== 0])
      .filter(([, wanted, on]) => wanted !== undefined && wanted !== on)
      .map(([i]) => i)
    if (missed.length) {
      console.warn(
        `actisense: the gateway did not take the P-Code of port(s) ${missed.join(', ')}`
      )
    }
    return done()
  }
  if (request.get) {
    return done()
  }
  const missing = (request.ports ?? []).find(
    ([port]: [number, boolean]) => port >= codes.length
  )
  if (missing) {
    console.warn(
      `actisense: no P-Code set: port ${missing[0]} does not exist, the gateway has ${codes.length} port(s)`
    )
    return done()
  }
  const perPort = codes.map((c, i) => {
    const wanted = pcodeWanted(request, i)
    return wanted !== undefined && wanted !== (c !== 0)
      ? wanted
        ? 1
        : 0
      : 0xff
  })
  if (perPort.every((b) => b === 0xff)) {
    return done()
  }
  that.debug('setting P-Codes per port: %s', describePCodes(perPort))
  setPCodes(that, perPort, 1)
}

function operatingModeName(mode: number) {
  return OPERATING_MODES[mode] || `operating mode ${mode}`
}

/**
 * The gateway's answer to Get or Set Operating Mode, which carries the mode
 * in force. A gateway in another mode is set to NGT Transfer Rx All Mode,
 * once per connection, as that restarts it; the mode is logged, and warned
 * about when it is not the one set.
 */
function onOperatingMode(that: any, bem: any) {
  if (bem.data.length < 2) {
    return
  }
  const mode = bem.data.readUInt16LE(0)
  const now = Date.now()
  that.modeAsked = undefined
  clearTimeout(that.modeTimer)
  // A file being read is only reported on.
  if (
    mode !== OPERATING_MODE_RX_ALL &&
    that.modeSetAt === undefined &&
    that.serial
  ) {
    that.debug(
      'the gateway is in %s; setting %s',
      operatingModeName(mode),
      operatingModeName(OPERATING_MODE_RX_ALL)
    )
    that.modeSetAt = now
    sendNgt(that, SET_OPERATING_MODE_MSG)
    // Frames already held keep their place, ahead of new ones.
    holdFor(that, Math.max(now + MODE_SETTLE_MS, heldUntil(that)))
    return
  }
  // Nothing is set now, so the frames held for the mode wait only for the
  // hold after a restart, if any.
  if (that.hold.state === 'awaitMode') {
    if (now >= that.hold.notBefore) {
      releaseHold(that)
    } else {
      holdFor(that, that.hold.notBefore)
    }
  }
  if (bem.error !== 0) {
    console.warn(
      `actisense: the gateway refused ${operatingModeName(OPERATING_MODE_RX_ALL)} (error ${describeError(bem.error)}); it stays in ${operatingModeName(mode)}`
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
 * message (138 bytes, sequence 6, Format 2); the NGT-1 and NGW-1 answer in
 * five (Format 1): 6 bytes, then four strings of 32, numbered 1 to 5 by the
 * sequence byte. The size gives the format; a device that leaves the
 * sequence at 0 sends the parts in order.
 */
function onProductInfo(that: any, bem: any) {
  const d: Buffer = bem.data
  let parts = that.productInfoParts
  const sequence = bem.sequence
  if (d.length >= 138 && (sequence === 6 || sequence === 0)) {
    parts[1] = {
      nmea2000Version: d.readUInt16LE(4),
      productCode: d.readUInt16LE(6)
    }
    parts[2] = productString(d.subarray(8, 40))
    parts[3] = productString(d.subarray(40, 72))
    parts[4] = productString(d.subarray(72, 104))
    parts[5] = productString(d.subarray(104, 136))
  } else if (d.length >= 32 && d.length < 138) {
    const part =
      sequence === 0
        ? [2, 3, 4, 5].find((p) => parts[p] === undefined)
        : sequence
    if (part === undefined || part < 2 || part > 5) {
      return
    }
    parts[part] = productString(d.subarray(0, 32))
  } else if (
    d.length >= 6 &&
    d.length < 32 &&
    (sequence === 1 || sequence === 0)
  ) {
    // Part 1 starts an answer: drop what is left of one that came in short.
    parts = that.productInfoParts = {}
    parts[1] = {
      nmea2000Version: d.readUInt16LE(0),
      productCode: d.readUInt16LE(2)
    }
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
 * A BEM error code with its SDK name, if it has one: "-1158 (command
 * timeout)".
 */
export function describeError(code: number) {
  const name = BEM_ERRORS[code]
  return name ? `${code} (${name})` : `${code}`
}

/**
 * Act on a message the gateway sends of its own accord: a restart, an
 * error, or a command it could not carry out.
 */
function onGatewayStatus(that: any, bem: any) {
  const d: Buffer = bem.data
  if (bem.bem === BEM_STARTUP_STATUS) {
    // Firmware version × 1000, then the reset status: 32 bits, but one
    // byte on old firmware.
    let detail = ''
    if (d.length >= 3) {
      const firmware = d.readUInt16LE(0)
      const reset = d.length >= 6 ? d.readUInt32LE(2) : d[2]
      detail = ` (firmware ${Math.floor(firmware / 1000)}.${String(firmware % 1000).padStart(3, '0')}, reset status 0x${reset.toString(16)})`
    }
    if (bem.error) {
      detail += `, error ${describeError(bem.error)}`
    }
    if (!that.serial) {
      console.warn(`actisense: the gateway restarted${detail}`)
      return
    }
    const now = Date.now()
    if (
      that.modeSetAt !== undefined &&
      now < that.modeSetAt + RESTART_AFTER_SET_MS
    ) {
      that.debug(
        'the gateway restarted after Set Operating Mode, as it does%s',
        detail
      )
    } else {
      console.warn(
        `actisense: the gateway restarted${detail}; reading its settings again`
      )
    }
    // Read, never set: setting the mode would restart it again.
    readGatewaySettings(that)
    // The gateway says so before it is done starting: after a Set its first
    // N2K message came some 300 ms later. Hold the frames for the bus as
    // after a Set, or longer if already so, and until the mode is known
    // again, as after opening.
    const notBefore = Math.max(now + MODE_SETTLE_MS, heldUntil(that))
    const until =
      that.hold.state === 'awaitMode'
        ? Math.max(that.hold.until, notBefore)
        : Math.max(notBefore, now + MODE_ANSWER_MS)
    holdUntilMode(that, notBefore, until)
  } else if (bem.bem === BEM_ERROR_REPORT) {
    console.warn(
      `actisense: the gateway reports error ${describeError(bem.error)}`
    )
  } else if (bem.bem === BEM_NEGATIVE_ACK) {
    const id = d.length >= 4 ? ` 0x${d.readUInt32LE(0).toString(16)}` : ''
    console.warn(
      `actisense: the gateway refused command${id}: error ${describeError(bem.error)}`
    )
  }
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

/* The Transmit PGN Enable list. A PGN missing from the gateway's list is
   silently not transmitted, so the list is always read once the gateway
   has reported its mode, and a PGN sent that it lacks is warned about
   (canboat#1072). With ENABLESETTRANSMITPGNS set, the missing PGNs of
   transmitPGNs are also enabled, saved to EEPROM and activated, and output
   waits until that is done.

   Firmware 2.500 and later is read with Get Supported PGN List and Get Tx
   PGN Enable List F2, which lists indexes into the supported list. Older or
   unknown firmware, and a gateway that refuses or ignores F2, is read with
   the deprecated F1, which an NGT-1 truncates on a long list: a PGN it
   misses is answered "already enabled" (-996). Only an enable that added a
   PGN (error 0) leads to an EEPROM write, so a gateway already set up is
   never written to again.

   Seen on an NGT-1-USB, firmware 2.690 (canboat
   samples/actisense-ngt1-fw2690.txt): the Supported PGN List's structure
   variant is 0x1100, its parts come highest index first, all sequence 1;
   F2's proprietary part (0x1103) comes before its standard part (0x1102).
   So parts are told apart by structure variant and put in place by their
   first index. That NGT-1 needs Commit To EEPROM to keep a change, and
   saves it 3-6 s later: a Set Operating Mode before then (a quick
   reconnect) brings back the saved list, and the next sync enables the
   PGN again. */

const F2_FIRMWARE = 2500 /* the first firmware with F2, × 1000 */
const SV_SUPPORTED_PGN_LIST = 0x1100
const SV_TX_ENABLE_LIST = 0x1102
const SV_PROP_TX_ENABLE_LIST = 0x1103
const F1_PGNS = 1 /* F1's four messages: PGNs, rates, timeouts, priorities */
const F1_LAST = 4
const ALREADY_ENABLED = -996
const TX_RATE_DEFAULT = 0xfffffffe /* the PGN's default rate */
const TX_TIMEOUT_IGNORED = 0xfffffffe
const TX_LIST_READ_DELAY_MS = 2000
const TX_LIST_ANSWER_TIMEOUT_MS = 10000
const TX_LIST_READ_ATTEMPTS = 3

function sendBem(that: any, payload: number[]) {
  const buf = composeMessage(NGT_MSG_SEND, Buffer.from(payload), payload.length)
  that.debugOut(buf)
  that.serial.write(buf)
}

/* Wait for the next answer, or run `onTimeout`. */
function txListWait(that: any, ms: number, onTimeout: () => void) {
  clearTimeout(that.txListTimer)
  that.txListTimer = setTimeout(onTimeout, ms)
}

/* The gateway stores a PDU1 PGN with its low (destination) byte cleared:
   enabling PGN 1 enables PGN 0. */
function storedPgn(pgn: number) {
  return ((pgn >> 8) & 0xff) < 240 ? pgn & ~0xff : pgn
}

function readTxList(that: any) {
  const firmware = that.productInfo && that.productInfo.firmware
  if (firmware >= F2_FIRMWARE) {
    readTxListF2(that, 1)
  } else {
    readTxListF1(that, 1)
  }
}

function readTxListF1(that: any, attempt: number) {
  that.txList = { step: 'readingF1', have: [] }
  sendBem(that, [BEM_TX_PGN_ENABLE_LIST_F1])
  txListWait(that, TX_LIST_ANSWER_TIMEOUT_MS, () => {
    if (attempt < TX_LIST_READ_ATTEMPTS) {
      that.debug('no answer to Get Tx PGN Enable List F1, retrying...')
      readTxListF1(that, attempt + 1)
    } else {
      finishTxList(that, 'could not read the transmit PGN list')
    }
  })
}

function readTxListF2(that: any, attempt: number) {
  that.txList = {
    step: 'readingF2',
    supported: {},
    enabled: {},
    proprietary: undefined
  }
  sendBem(that, [BEM_SUPPORTED_PGN_LIST])
  sendBem(that, [BEM_TX_PGN_ENABLE_LIST_F2])
  txListWait(that, TX_LIST_ANSWER_TIMEOUT_MS, () => {
    if (attempt < TX_LIST_READ_ATTEMPTS) {
      that.debug('no answer to Get Tx PGN Enable List F2, retrying...')
      readTxListF2(that, attempt + 1)
    } else {
      that.debug('no answer to Get Tx PGN Enable List F2, trying F1')
      readTxListF1(that, 1)
    }
  })
}

/* Put `entries` in place from index `first`; a part giving another size
   than the earlier ones starts the list over. */
function addParts(parts: any, size: number, first: number, entries: any[]) {
  if (!parts.items || parts.items.length !== size) {
    parts.items = new Array(size).fill(undefined)
  }
  entries.forEach((entry, i) => {
    if (first + i < size) {
      parts.items[first + i] = entry
    }
  })
}

function completeParts(parts: any): any[] | undefined {
  return parts.items && parts.items.every((e: any) => e !== undefined)
    ? parts.items
    : undefined
}

/* A Supported PGN List answer's data: transfer id, structure variant (u32),
   N2K database version (u16), full size, first index, count, then per PGN
   its index and the PGN (u24). */
function addSupportedPgns(tx: any, d: Buffer) {
  if (d.length < 10 || d.readUInt32LE(1) !== SV_SUPPORTED_PGN_LIST) {
    return
  }
  const entries: number[][] = []
  for (let i = 0, o = 10; i < d[9] && o + 4 <= d.length; i++, o += 4) {
    entries.push([d[o], d[o + 1] | (d[o + 2] << 8) | (d[o + 3] << 16)])
  }
  addParts(tx.supported, d[7], d[8], entries)
}

/* A size byte and that many bytes, from `offset`. */
function bitmapAt(d: Buffer, offset: number) {
  if (offset >= d.length || offset + 1 + d[offset] > d.length) {
    return undefined
  }
  return d.subarray(offset + 1, offset + 1 + d[offset])
}

/* The PGNs a proprietary bitmap enables: bit n is base + n. */
function bitmapPgns(base: number, bitmap: Buffer) {
  const pgns: number[] = []
  bitmap.subarray(0, 32).forEach((bits, byte) => {
    for (let bit = 0; bit < 8; bit++) {
      if (bits & (1 << bit)) {
        pgns.push(base + byte * 8 + bit)
      }
    }
  })
  return pgns
}

/* An F2 answer's data: transfer id and structure variant (u32), then
   either the standard PGNs (full size, first index, count, then per PGN its
   index in the Supported PGN List, priority and rate (u16)), or the
   proprietary ones as two bitmaps, of 0xff00-0xffff and 0x1ff00-0x1ffff. */
function addEnabledPgns(tx: any, d: Buffer) {
  if (d.length < 5) {
    return
  }
  const variant = d.readUInt32LE(1)
  if (variant === SV_TX_ENABLE_LIST && d.length >= 8) {
    const entries: number[] = []
    for (let i = 0, o = 8; i < d[7] && o + 4 <= d.length; i++, o += 4) {
      entries.push(d[o])
    }
    addParts(tx.enabled, d[5], d[6], entries)
  } else if (variant === SV_PROP_TX_ENABLE_LIST) {
    const pdu2 = bitmapAt(d, 5)
    const fast = pdu2 && bitmapAt(d, 6 + pdu2.length)
    if (pdu2 && fast) {
      tx.proprietary = bitmapPgns(0xff00, pdu2).concat(
        bitmapPgns(0x1ff00, fast)
      )
    }
  }
}

/* The enabled PGNs, once every part of the F2 read is in. */
function f2Pgns(that: any, tx: any): number[] | undefined {
  const supported = completeParts(tx.supported)
  const enabled = completeParts(tx.enabled)
  if (!supported || !enabled || !tx.proprietary) {
    return undefined
  }
  const byIndex = new Map(supported as [number, number][])
  const pgns: number[] = []
  for (const index of enabled) {
    const pgn = byIndex.get(index)
    if (pgn === undefined) {
      that.debug('transmit PGN index %d is not a supported PGN', index)
    } else {
      pgns.push(pgn)
    }
  }
  return pgns.concat(tx.proprietary)
}

/* The gateway's list is in: keep it, to warn about PGNs sent that it
   lacks, and enable what is wanted and missing when asked to. Format 2
   lists every PGN; Format 1 can miss some. */
function onTxList(that: any, have: number[], complete: boolean) {
  that.debug('tx pgns: %j', have)
  that.txKnown = { pgns: [...have], complete }
  // The PGNs sent before the list was known.
  const sent = [...that.sentBeforeTxList]
  that.sentBeforeTxList.clear()
  sent.forEach((pgn: number) => warnIfNotOnTxList(that, pgn))
  if (that.options.disableSetTransmitPGNs) {
    finishTxList(that)
    return
  }
  const missing = _.uniq(that.transmitPGNs.map(storedPgn)).filter(
    (pgn: any) => !have.includes(pgn)
  ) as number[]
  if (missing.length === 0) {
    that.debug('the transmit PGN list is complete')
    finishTxList(that)
    return
  }
  that.debug('enabling tx pgns: %j', missing)
  that.txList = { step: 'enabling', todo: missing, added: [] }
  enableTxPgn(that, missing[0])
}

/* Set Tx PGN Enable: PGN (u32), enable, rate (u32), timeout (u32). The
   SDK's trailing priority is left off, so the priority stays as it is. */
function enableTxPgn(that: any, pgn: number) {
  const msg = Buffer.alloc(14)
  msg[0] = BEM_TX_PGN_ENABLE
  msg.writeUInt32LE(pgn, 1)
  msg[5] = 1
  msg.writeUInt32LE(TX_RATE_DEFAULT, 6)
  msg.writeUInt32LE(TX_TIMEOUT_IGNORED, 10)
  sendBem(that, [...msg])
  awaitTxListAnswer(that)
}

function awaitTxListAnswer(that: any) {
  txListWait(that, TX_LIST_ANSWER_TIMEOUT_MS, () =>
    finishTxList(
      that,
      'the gateway stopped answering while setting the transmit PGN list'
    )
  )
}

/* The read, or the sync, is over, done or not: let output through. */
function finishTxList(that: any, failure?: string) {
  clearTimeout(that.txListTimer)
  that.txList = { step: 'done' }
  if (failure) {
    console.warn(`actisense: ${failure}`)
    that.setProviderStatus(failure)
  }
  updateOutput(that)
}

function onTxListAnswer(that: any, bem: any) {
  const tx = that.txList
  // A Negative Ack names the command it refuses: on an NGT-1, its BEM id.
  const nak = bem.bem === BEM_NEGATIVE_ACK && bem.data.length >= 4
  const command = nak ? bem.data.readUInt32LE(0) : bem.bem
  if (tx.step === 'awaitStartup') {
    // Any operating mode answer will do, even a refusal: the gateway is
    // up, and its list does not depend on the mode.
    if (bem.bem === BEM_OPERATING_MODE && bem.data.length >= 2) {
      tx.step = 'readAt'
      txListWait(that, TX_LIST_READ_DELAY_MS, () => readTxList(that))
    }
  } else if (tx.step === 'readingF1' && bem.bem === BEM_TX_PGN_ENABLE_LIST_F1) {
    // The first message lists the PGNs: a count, then u32s.
    if (bem.sequence === F1_PGNS) {
      const d: Buffer = bem.data
      for (let i = 0, o = 1; i < d[0] && o + 4 <= d.length; i++, o += 4) {
        tx.have.push(d.readUInt32LE(o))
      }
    } else if (bem.sequence === F1_LAST) {
      onTxList(that, tx.have, false)
    }
  } else if (
    tx.step === 'readingF2' &&
    (command === BEM_SUPPORTED_PGN_LIST ||
      command === BEM_TX_PGN_ENABLE_LIST_F2)
  ) {
    if (bem.error || nak) {
      that.debug(
        'the gateway refused BEM 0x%s (error %s); reading the transmit PGN list with F1',
        command.toString(16),
        describeError(bem.error)
      )
      readTxListF1(that, 1)
      return
    }
    if (bem.bem === BEM_SUPPORTED_PGN_LIST) {
      addSupportedPgns(tx, bem.data)
    } else {
      addEnabledPgns(tx, bem.data)
    }
    const have = f2Pgns(that, tx)
    if (have) {
      onTxList(that, have, true)
    }
  } else if (tx.step === 'enabling' && bem.bem === BEM_TX_PGN_ENABLE) {
    // The outcome is the error code; the sequence is 1 whatever happens.
    const pgn = tx.todo.shift()
    if (bem.error === 0) {
      that.debug('enabled tx pgn %d', pgn)
      tx.added.push(pgn)
      that.txKnown?.pgns.push(pgn)
    } else if (bem.error === ALREADY_ENABLED) {
      that.debug('tx pgn %d was already enabled', pgn)
    } else {
      console.warn(
        `actisense: the gateway refused transmit PGN ${pgn}: error ${describeError(bem.error)}`
      )
    }
    if (tx.todo.length) {
      enableTxPgn(that, tx.todo[0])
    } else if (tx.added.length) {
      // Only a list that changed is saved: no needless EEPROM write.
      tx.step = 'committing'
      sendBem(that, [BEM_COMMIT_TO_EEPROM])
      awaitTxListAnswer(that)
    } else {
      finishTxList(that)
    }
  } else if (tx.step === 'committing' && command === BEM_COMMIT_TO_EEPROM) {
    if (bem.error || nak) {
      finishTxList(
        that,
        `the gateway refused Commit To EEPROM: error ${describeError(bem.error)}`
      )
      return
    }
    tx.step = 'activating'
    sendBem(that, [BEM_ACTIVATE_PGN_ENABLE_LISTS])
    awaitTxListAnswer(that)
  } else if (
    tx.step === 'activating' &&
    command === BEM_ACTIVATE_PGN_ENABLE_LISTS
  ) {
    if (bem.error || nak) {
      finishTxList(
        that,
        `the gateway refused Activate PGN Enable Lists: error ${describeError(bem.error)}`
      )
      return
    }
    that.debug('saved and activated tx pgns %j', tx.added)
    finishTxList(that)
  }
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
  if (bem) {
    that.bemSeen = true
  }
  if (command === BEM_PORT_PCODE && bem) {
    onPCodeAnswer(that, bem)
  } else if (command === BEM_OPERATING_MODE) {
    that.gotStartupResponse = true
    that.debug('got Operating Mode answer')
    if (bem) {
      onOperatingMode(that, bem)
    }
  } else if (command === BEM_PRODUCT_INFO && bem) {
    onProductInfo(that, bem)
  } else if (bem) {
    onGatewayStatus(that, bem)
  }

  if (bem && that.txList) {
    onTxListAnswer(that, bem)
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
  clearTimers(this)
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
