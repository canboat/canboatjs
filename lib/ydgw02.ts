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

import { createDebug } from './utilities'
import { EventEmitter, Transform } from 'stream'
import { Parser as FromPgn } from './fromPgn'
import { YdDevice } from './yddevice'
import {
  pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat,
  actisenseToYdgwRawFormat,
  actisenseToYdgwFullRawFormat
} from './toPgn'
import { parseCanIdStr } from './canId'
import { DeviceEmulator } from './index'
import { PGN, PGN_60928, PGN_126998, PGN_126996 } from '@canboat/ts-pgns'
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
  this.debugOut = createDebug('canboatjs:n2k-out', options)
  this.sentAvailable = false
  this.options = options
  this.outEvent = options.ydgwOutEvent || 'ydwg02-out'
  this.device = undefined
  this.devices = {}
  this.supportsDeviceCreation = true

  this.fromPgn = new FromPgn(options)

  this.fromPgn.on('warning', (_pgn: any, _warning: string) => {
    //debug(`[warning] ${pgn.pgn} ${warning}`)
  })

  this.fromPgn.on('error', (pgn: PGN, error: any) => {
    this.debug(`[error] ${pgn.pgn} ${error}`)
  })

  if (options.app) {
    const outEvents = (this.options.outEvent || 'nmea2000out')
      .split(',')
      .map((event: string) => event.trim())
    outEvents.forEach((event: string) => {
      options.app.on(event, (msg: string) => {
        if (typeof msg === 'string') {
          this.sendYdgwPGN(msg)
        } else {
          this.sendPGN(msg)
        }
        options.app.emit('connectionwrite', { providerId: options.providerId })
      })
    })

    const jsonOutEvents = (options.jsonOutEvent || 'nmea2000JsonOut')
      .split(',')
      .map((event: string) => event.trim())
    jsonOutEvents.forEach((event: string) => {
      options.app.on(event, (msg: PGN) => {
        this.sendPGN(msg)
        options.app.emit('connectionwrite', { providerId: options.providerId })
      })
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
    this.debugOut('sending %s', msg)
    if (this.options.app.listenerCount('canboatjs:rawsend') > 0) {
      this.options.app.emit('canboatjs:rawsend', {
        knownSrc: this.device !== undefined,
        data: msg
      })
    }
    this.options.app.emit(this.outEvent, msg)
  }
}

Ydgw02Stream.prototype.sendPGN = function (pgn: PGN, force?: boolean): void {
  if (this.cansend() || (pgn as any).forceSend === true || force === true) {
    //let now = Date.now()
    //let lastSent = pgnsSent[pgn.pgn]
    let msgs
    if ((pgn as any).ydFullFormat === true || this.device !== undefined) {
      if (pgn.src !== 254) {
        pgn.src = this.device.address
      }
      msgs = pgnToYdgwFullRawFormat(pgn)
    } else {
      msgs = pgnToYdgwRawFormat(pgn)
    }
    msgs.forEach((raw) => {
      this.sendString(raw + '\r\n', (pgn as any).forceSend)
    })

    if (this.device !== undefined) {
      if (pgn.pgn === 126996 || pgn.pgn === 126998 || pgn.pgn === 60928) {
        // forward on so these are seen by the server
        this.push({ ...pgn, timestamp: new Date().toISOString() })
      }

      if (
        pgn.pgn == 59904 &&
        pgn.src !== 254 &&
        (pgn.dst == 255 || pgn.dst == this.address)
      ) {
        if ((pgn as any).PGN !== undefined) {
          pgn.fields = { pgn: (pgn as any).PGN, ...pgn.fields }
        }
        this.device.n2kMessage(pgn)
      }
    }

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
}

util.inherits(Ydgw02Stream, Transform)

Ydgw02Stream.prototype._transform = function (
  chunk: any,
  encoding: any,
  done: any
) {
  const line = chunk.toString().trim()

  if (line.length < 23) {
    //bad data
    done()
    return
  }

  if (
    this.sentAvailable === false &&
    (this.options.createDevice === false ||
      (this.device && this.device.cansend))
  ) {
    this.sentAvailable = true
    if (this.options.createDevice === false) {
      this.debug('emit nmea2000OutAvailable')
      this.options.app.emit('nmea2000OutAvailable')
    }
    if (this.options.app.emitPropertyValue) {
      this.options.app.emitPropertyValue('canboatjsUtils', {
        id: this.options.id,
        utils: this
      })
    }
  }

  if (this.options.createDevice === true) {
    if (this.device === undefined) {
      this.device = new YdDevice(this, this.options)
      this.device.start()
    }
    if (this.cansend() && line.charAt(13) === 'T') {
      //11:54:07.833 R 18eafffe 00 ee 00
      const canId = parseCanIdStr(line.slice(15, 23))
      if (canId.src === this.device.address) {
        //ignore pgn we're transmitting
        done()
        return
      }
    }
  } else {
    if (line.charAt(13) === 'T') {
      //ignore pgns we're transmitting
      done()
      return
    }
  }

  const pgn = this.fromPgn.parseYDGW02(line)

  this.options.app.emit('canboatjs:rawoutput', line)

  if (pgn !== undefined) {
    this.push(pgn)
    this.options.app.emit(
      this.options.analyzerOutEvent || 'N2KAnalyzerOut',
      pgn
    )
    Object.values(this.devices).forEach((device: any) => {
      const yd = device as YDDeviceEmulator
      yd.pgnReceived(pgn)
    })
  }

  done()
}

Ydgw02Stream.prototype.end = function () {}

Ydgw02Stream.prototype.createEmulator = function (
  id: string,
  options: any,
  addressClaim: PGN_60928,
  productInfo: PGN_126996,
  configInfo: PGN_126998 | undefined
): DeviceEmulator {
  const device = new YDDeviceEmulator(
    this,
    id,
    options,
    addressClaim,
    productInfo,
    configInfo
  )
  this.devices[id] = device
  return device
}

Ydgw02Stream.prototype.removeEmulator = function (id: string): void {
  const device: YDDeviceEmulator = this.devices[id]
  if (device) {
    device.stop()
    delete this.devices[id]
  }
}

class YDDeviceEmulator extends EventEmitter implements DeviceEmulator {
  private stream: any
  private device: YdDevice
  private id: string
  public config: any

  constructor(
    stream: any,
    id: string,
    options: any,
    addressClaim: PGN_60928,
    productInfo: PGN_126996,
    configInfo: PGN_126998 | undefined
  ) {
    super()
    this.stream = stream
    this.id = id
    this.config = { configPath: stream.options.app?.config?.configPath }
    this.device = new YdDevice(this, {
      app: this,
      providerId: 'emulator-' + id,
      addressClaim,
      productInfo,
      configurationInfo: configInfo
    })
    this.device.start()
  }

  stop() {
    this.device.stop()
    this.removeAllListeners()
  }

  pgnReceived(pgn: PGN) {
    this.emit('N2KAnalyzerOut', pgn)
  }

  sendPGN(pgn: PGN, force: boolean): void {
    if (force || this.device.cansend) {
      if (pgn.src !== 254) {
        pgn.src = this.device.address
      }
      const msgs = pgnToYdgwFullRawFormat(pgn)

      msgs.forEach((raw) => {
        this.stream.sendString(raw + '\r\n', (pgn as any).forceSend)
      })
    }
  }

  send(pgn: PGN | string): void {
    if (typeof pgn === 'string') {
      const src = this.device.address

      const split = pgn.split(',')
      split[3] = src.toString()
      pgn = split.join(',')

      const msgs = actisenseToYdgwFullRawFormat(pgn)

      msgs.forEach((raw) => {
        this.stream.sendString(raw + '\r\n')
      })
    } else {
      this.sendPGN(pgn, false)
    }
  }

  onPGN(cb: (pgn: PGN) => void): void {
    this.on('N2KAnalyzerOut', cb)
  }

  setProviderError(id: string, error: string): void {
    console.error(`${id}:${this.id} ${error}`)
  }

  setProviderStatus(id: string, status: string): void {
    console.log(`${id}:${this.id} ${status}`)
  }
}
