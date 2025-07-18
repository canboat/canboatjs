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
import { Transform } from 'stream'
import { Parser as FromPgn } from './fromPgn'
import { YdDevice } from './yddevice'
import {
  pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat,
  actisenseToYdgwRawFormat,
  actisenseToYdgwFullRawFormat
} from './toPgn'
import util from 'util'

//const pgnsSent = {}

export function Ydgw02Stream(this: any, options: any, type: string) {
  if (this === undefined) {
    return new (Ydgw02Stream as any)(options, type)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.debug = createDebug('canboatjs:ydgw02', options)
  this.sentAvailable = false
  this.options = options
  this.outEvent = options.ydgwOutEvent || 'ydwg02-out'
  this.device = undefined

  this.fromPgn = new FromPgn(options)

  this.fromPgn.on('warning', (_pgn: any, _warning: string) => {
    //debug(`[warning] ${pgn.pgn} ${warning}`)
  })

  this.fromPgn.on('error', (pgn: PGN, error: any) => {
    this.debug(`[error] ${pgn.pgn} ${error}`)
  })

  if (options.app) {
    options.app.on(this.options.outEevent || 'nmea2000out', (msg: string) => {
      if (typeof msg === 'string') {
        this.sendYdgwPGN(msg)
      } else {
        this.sendPGN(msg)
      }
      options.app.emit('connectionwrite', { providerId: options.providerId })
    })

    options.app.on(options.jsonOutEvent || 'nmea2000JsonOut', (msg: PGN) => {
      this.sendPGN(msg)
      options.app.emit('connectionwrite', { providerId: options.providerId })
    })

    options.app.on('ydFullRawOut', (msgs: string[]) => {
      this.sendYdgwFullPGN(msgs)
      options.app.emit('connectionwrite', { providerId: options.providerId })
    })

    //this.sendString('$PDGY,N2NET_OFFLINE')

    if (type === 'usb') {
      // set ydnu to RAW mode
      options.app.emit(this.outEvent, Buffer.from([0x30, 0x0a]))
    }

    this.debug('started')
  }
}

Ydgw02Stream.prototype.cansend = function (_msg: any) {
  return this.options.createDevice
    ? this.device && this.device.cansend
    : this.sentAvailable
}

Ydgw02Stream.prototype.sendString = function (msg: string, forceSend: boolean) {
  if (this.cansend() || forceSend === true) {
    this.debug('sending %s', msg)
    this.options.app.emit(this.outEvent, msg)
  }
}

Ydgw02Stream.prototype.sendPGN = function (pgn: PGN) {
  if (this.cansend() || (pgn as any).forceSend === true) {
    //let now = Date.now()
    //let lastSent = pgnsSent[pgn.pgn]
    let msgs
    if ((pgn as any).ydFullFormat === true || this.device !== undefined) {
      pgn.src = this.device.address
      msgs = pgnToYdgwFullRawFormat(pgn)
    } else {
      msgs = pgnToYdgwRawFormat(pgn)
    }
    msgs.forEach((raw) => {
      this.sendString(raw + '\r\n', (pgn as any).forceSend)
    })
    //pgnsSent[pgn.pgn] = now
  }
}

Ydgw02Stream.prototype.sendYdgwFullPGN = function (msgs: string[]) {
  msgs.forEach((raw) => {
    this.sendString(raw + '\r\n')
  })
}

Ydgw02Stream.prototype.sendYdgwPGN = function (msg: string) {
  let msgs

  if (this.device != undefined) {
    msgs = actisenseToYdgwFullRawFormat(msg)
  } else {
    msgs = actisenseToYdgwRawFormat(msg)
  }

  msgs.forEach((raw) => {
    this.sendString(raw + '\r\n')
  })

  /*
  if ( !this.parser ) {
    this.parser = new Parser()

    let that = this
    this.parser.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
    })


    this.parser.on('pgn', (pgn) => {
      let now = Date.now()
      let lastSent = pgnsSent[pgn.pgn]
      if ( !lastSent || now - lastSent > rateLimit ) {
        pgnToYdwgRawFormat(pgn).forEach(raw => {
          this.sendString(raw)
        })
        pgnsSent[pgn.pgn] = now
      }
    })
  }
  this.parser.parseString(msg)
  */
}

util.inherits(Ydgw02Stream, Transform)

Ydgw02Stream.prototype._transform = function (
  chunk: any,
  encoding: any,
  done: any
) {
  const line = chunk.toString().trim()
  //line = line.substring(0, line.length) // take off the \r

  if (this.device === undefined && !this.sentAvailable) {
    this.debug('emit nmea2000OutAvailable')
    this.options.app.emit('nmea2000OutAvailable')
    this.sentAvailable = true

    if (this.options.createDevice === true) {
      this.device = new YdDevice(this.options)
      this.device.start()
    }
  }

  const pgn = this.fromPgn.parseYDGW02(line)
  if (pgn !== undefined) {
    this.push(pgn)
    this.options.app.emit(
      this.options.analyzerOutEvent || 'N2KAnalyzerOut',
      pgn
    )
  }

  done()
}

Ydgw02Stream.prototype.end = function () {}
