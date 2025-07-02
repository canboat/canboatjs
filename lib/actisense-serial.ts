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
import { createDebug } from './utilities'
import util from 'util'
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

   DLE STX <command> <len> [<data> ...]  <checksum> DLE ETX

   <command> is a byte from the list below.
   In <data> any DLE characters are double escaped (DLE DLE).
   <len> encodes the unescaped length.
   <checksum> is such that the sum of all unescaped data bytes plus the command
              byte plus the length adds up to zero, modulo 256.
*/

const N2K_MSG_RECEIVED = 0x93 /* Receive standard N2K message */
const N2K_MSG_SEND = 0x94 /* Send N2K message */
const NGT_MSG_RECEIVED = 0xa0 /* Receive NGT specific message */
const NGT_MSG_SEND = 0xa1 /* Send NGT message */

const MSG_START = 1
const MSG_ESCAPE = 2
const MSG_MESSAGE = 3

const NGT_STARTUP_MSG = new Uint8Array([0x11, 0x02, 0x00])

export function ActisenseStream(this: any, options: any) {
  if (this === undefined) {
    return new (ActisenseStream as any)(options)
  }

  this.debugOut = createDebug('canboatjs:actisense-out', options)
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

util.inherits(ActisenseStream, Transform)

ActisenseStream.prototype.start = function (this: any) {
  if (this.serial !== null) {
    this.serial.unpipe(this)
    this.serial.removeAllListeners()
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

    if (this.options.app) {
      const writeString = (msg: string) => {
        this.debugOut(`sending ${msg}`)
        let buf = parseInput(msg)
        buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
        this.debugOut(buf)
        this.serial.write(buf)
        this.options.app.emit('connectionwrite', {
          providerId: this.options.providerId
        })
      }

      const writeObject = (msg: PGN) => {
        const data = toPgn(msg)
        const actisense = encodeActisense({ pgn: msg.pgn, data, dst: msg.dst })
        this.debugOut(`sending ${actisense}`)
        let buf = parseInput(actisense)
        buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
        this.debugOut(buf)
        this.serial.write(buf)
        this.options.app.emit('connectionwrite', {
          providerId: this.options.providerId
        })
      }

      this.options.app.on(
        this.options.outEevent || 'nmea2000out',
        (msg: string) => {
          if (this.outAvailable) {
            if (typeof msg === 'string') {
              writeString(msg)
            } else {
              writeObject(msg)
            }
          }
        }
      )

      this.options.app.on(
        this.options.jsonOutEvent || 'nmea2000JsonOut',
        (msg: PGN) => {
          if (this.outAvailable) {
            writeObject(msg)
          }
        }
      )
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
        const buf = composeMessage(
          NGT_MSG_SEND,
          Buffer.from(NGT_STARTUP_MSG),
          NGT_STARTUP_MSG.length
        )
        this.debugOut(buf)
        this.serial.write(buf)
        this.debug('sent startup message')
        this.gotStartupResponse = false
        if (this.options.disableSetTransmitPGNs) {
          enableOutput(this)
        } else {
          setTimeout(() => {
            if (this.gotStartupResponse === false) {
              this.debug('retry startup message...')
              this.debugOut(buf)
              this.serial.write(buf)
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

ActisenseStream.prototype.scheduleReconnect = function () {
  this.reconnectDelay *= this.reconnectDelay < 60 * 1000 ? 1.5 : 1
  const msg = `Not connected (retry delay ${(
    this.reconnectDelay / 1000
  ).toFixed(0)} s)`
  this.debug(msg)
  this.setProviderStatus(msg)
  setTimeout(this.start.bind(this), this.reconnectDelay)
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

  if (that.stat == MSG_START) {
    if (c == ESC && that.isFile) {
      noEscape = true
    }
  }

  if (that.stat == MSG_ESCAPE) {
    if (c == ETX) {
      if (!that.options.outputOnly) {
        if (that.buffer[0] == N2K_MSG_RECEIVED) {
          processN2KMessage(that, that.buffer, that.bufferOffset)
        } else if (that.buffer[0] == NGT_MSG_RECEIVED) {
          processNTGMessage(that, that.buffer, that.bufferOffset)
        }
      }
      that.bufferOffset = 0
      that.stat = MSG_START
    } else if (c == STX) {
      that.bufferOffset = 0
      that.stat = MSG_MESSAGE
    } else if (c == DLE || (c == ESC && that.isFile) || that.noEscape) {
      that.buffer.writeUInt8(c, that.bufferOffset)
      that.bufferOffset++
      that.stat = MSG_MESSAGE
    } else {
      console.error('DLE followed by unexpected char , ignore message')
      that.stat = MSG_START
    }
  } else if (that.stat == MSG_MESSAGE) {
    if (c == DLE) {
      that.stat = MSG_ESCAPE
    } else if (that.isFile && c == ESC && !noEscape) {
      that.stat = MSG_ESCAPE
    } else {
      that.buffer.writeUInt8(c, that.bufferOffset)
      that.bufferOffset++
    }
  } else {
    if (c == DLE) {
      that.stat = MSG_ESCAPE
    }
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

function processNTGMessage(that: any, buffer: Buffer, len: number) {
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

  if (command === 0x11) {
    //confirm startup
    that.gotStartupResponse = true
    that.debug('got startup response')
  }

  if (!that.outAvailable) {
    if (command === 0x11) {
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
          enableTXPGN(that.serial, that.neededTransmitPGNs[0])
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
  let checksum = 0

  for (let i = 0; i < len; i++) {
    checksum = addUInt8(checksum, buffer[i])
  }

  if (checksum != 0) {
    that.debug('received message with invalid checksum')
    return
  }

  if (that.options.plainText) {
    that.push(binToActisense(buffer.slice(2, len)))
  } else {
    that.push(buffer.slice(2, len))
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

function composeMessage(command: number, buffer: Buffer, len: number) {
  const outBuf = Buffer.alloc(500)
  const out = new BitStream(outBuf)

  out.writeUint8(DLE)
  out.writeUint8(STX)
  out.writeUint8(command)

  const lenPos = out.byteIndex
  out.writeUint8(0) //length. will update later
  let crc = command

  for (let i = 0; i < len; i++) {
    const c = buffer.readUInt8(i)
    if (c == DLE) {
      out.writeUint8(DLE)
    }
    out.writeUint8(c)
    crc = addUInt8(crc, c)
  }

  crc = addUInt8(crc, len)

  out.writeUint8(256 - crc)
  out.writeUint8(DLE)
  out.writeUint8(ETX)

  out.view.buffer.writeUInt8(len, lenPos)

  //that.debug(`command ${out.view.buffer[2]} ${lenPos} ${len} ${out.view.buffer[lenPos]} ${out.view.buffer.length} ${out.byteIndex}`)

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
