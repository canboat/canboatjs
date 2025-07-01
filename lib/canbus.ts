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

import { PGN } from '@canboat/pgns'
import { debug as _debug } from 'debug'
const debug = _debug('canboatjs:canbus')
import { Transform } from 'stream'
import { toPgn } from './toPgn'
import _ from 'lodash'
import { CanDevice } from './candevice'
import { getPlainPGNs, binToActisense } from './utilities'
import { CanID, encodeCanId, parseCanId } from './canId'
import { toActisenseSerialFormat, parseActisense } from './stringMsg'
import util from 'util'

export function CanbusStream(this: any, options: any) {
  /*
  if (!(this instanceof CanbusStream)) {
    return new CanbusStream(options)
    }
    */

  Transform.call(this, {
    objectMode: true
  })

  this.plainText = false
  this.options = options
  this.start()

  this.setProviderStatus =
    options.app && options.app.setProviderStatus
      ? (msg: string) => {
          options.app.setProviderStatus(options.providerId, msg)
        }
      : () => {}
  this.setProviderError =
    options.app && options.app.setProviderError
      ? (msg: string) => {
          options.app.setProviderError(options.providerId, msg)
        }
      : () => {}

  if (options.fromStdIn) {
    return
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    this.socketcan = require('socketcan')
  } catch (err) {
    console.error(err)
    const msg = 'unable to load native socketcan interface'
    console.error(msg)
  }

  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const that = this

  if (options.app) {
    options.app.on(options.outEvent || 'nmea2000out', (msg: string) => {
      that.sendPGN(msg)
    })
    options.app.on(options.jsonOutEvent || 'nmea2000JsonOut', (msg: PGN) => {
      that.sendPGN(msg)
    })
  }

  if (this.connect() == false) {
    return
  }

  const noDataReceivedTimeout =
    typeof options.noDataReceivedTimeout !== 'undefined'
      ? options.noDataReceivedTimeout
      : -1
  if (noDataReceivedTimeout > 0) {
    this.noDataInterval = setInterval(() => {
      if (
        this.channel &&
        this.lastDataReceived &&
        Date.now() - this.lastDataReceived > noDataReceivedTimeout * 1000
      ) {
        const channel = this.channel
        delete this.channel
        try {
          channel.stop()
        } catch (_error) {}
        this.setProviderError('No data received, retrying...')
        if (this.options.app) {
          console.error('No data received, retrying...')
        }
        this.connect()
      }
    }, noDataReceivedTimeout * 1000)
  }
}

CanbusStream.prototype.connect = function () {
  const canDevice = this.options.canDevice || 'can0'

  try {
    if (this.socketcan === undefined) {
      this.setProviderError('unable to load native socketcan interface')
      return false
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this
    this.channel = this.socketcan.createRawChannelWithOptions(canDevice, {
      non_block_send: true
    })
    this.channel.addListener('onStopped', () => {
      if (this.channel) {
        // stoped by us?
        delete this.channel
        this.setProviderError('Stopped, Retrying...')
        if (this.options.app) {
          console.error('socketcan stopped, retrying...')
        }
        setTimeout(() => {
          this.setProviderError('Reconnecting...')
          this.connect()
        }, 2000)
      }
    })
    this.channel.addListener('onMessage', (msg: any) => {
      const pgn: any = parseCanId(msg.id)

      if (this.noDataInterval) {
        this.lastDataReceived = Date.now()
      }

      //always send address claims through
      if (
        pgn.pgn != 60928 &&
        that.candevice &&
        that.candevice.cansend &&
        pgn.src == that.candevice.address
      ) {
        return
      }

      pgn.timestamp = new Date().toISOString()
      if (that.plainText) {
        this.push(binToActisense(pgn, msg.data, msg.data.length))
      } else {
        that.push({ pgn, length: msg.data.length, data: msg.data })
      }
    })
    this.channel.start()
    this.setProviderStatus('Connected to socketcan')
    this.candevice = new CanDevice(this, this.options)
    this.candevice.start()
    return true
  } catch (e: any) {
    console.error(`unable to open canbus ${canDevice}: ${e}`)
    console.error(e.stack)
    this.setProviderError(e.message)
    return false
  }
}

util.inherits(CanbusStream, Transform)

CanbusStream.prototype.start = function () {}

CanbusStream.prototype.sendPGN = function (msg: any, force: boolean) {
  if (this.candevice) {
    //if ( !this.candevice.cansend && (_.isString(msg) || msg.pgn !== 59904) ) {
    if (!this.candevice.cansend && force !== true) {
      //we have not completed address claim yet
      return
    }

    debug('sending %j', msg)

    if (this.options.app) {
      this.options.app.emit('connectionwrite', {
        providerId: this.options.providerId
      })
    }

    const src =
      msg.pgn === 59904 || msg.forceSrc ? msg.src : this.candevice.address
    if (_.isString(msg)) {
      const split = msg.split(',')
      split[3] = src
      msg = split.join(',')
    } else {
      msg.src = src
      if (_.isUndefined(msg.prio)) {
        msg.prio = 3
      }
      if (_.isUndefined(msg.dst)) {
        msg.dst = 255
      }
    }

    if (this.socketCanWriter) {
      if (_.isString(msg)) {
        this.socketCanWriter.stdin.write(msg + '\n')
      } else {
        const str = toActisenseSerialFormat(
          msg.pgn,
          toPgn(msg),
          msg.dst,
          msg.src
        )
        this.socketCanWriter.stdin.write(str + '\n')
      }
    } else if (this.channel) {
      let canid: number
      let buffer: Buffer | undefined
      let pgn: any

      if (_.isObject(msg)) {
        canid = encodeCanId(msg as CanID)
        buffer = toPgn(msg)
        pgn = msg
      } else {
        pgn = parseActisense(msg)
        canid = encodeCanId(pgn)
        buffer = pgn.data
      }

      if (debug.enabled) {
        const str = toActisenseSerialFormat(pgn.pgn, buffer, pgn.dst, pgn.src)
        debug(str)
      }

      if (buffer === undefined) {
        debug("can't convert %j", msg)
        return
      }

      //seems as though 126720 should always be encoded this way
      if (buffer.length > 8 || pgn.pgn == 126720) {
        const pgns = getPlainPGNs(buffer)
        pgns.forEach((pbuffer) => {
          this.channel.send({ id: canid, ext: true, data: pbuffer })
        })
      } else {
        this.channel.send({ id: canid, ext: true, data: buffer })
      }
    }
  }
}

CanbusStream.prototype._transform = function (
  chunk: any,
  encoding: any,
  done: any
) {
  done()
}

CanbusStream.prototype.end = function () {
  if (this.channel) {
    const channel = this.channel
    delete this.channel
    channel.stop()
  }
  if (this.noDataInterval) {
    clearInterval(this.noDataInterval)
  }
}

CanbusStream.prototype.pipe = function (pipeTo: any) {
  if (!pipeTo.fromPgn) {
    this.plainText = true
  }
  /*
  pipeTo.fromPgn.on('pgn', (pgn) => {
    if ( this.candevice ) {
      this.candevice.n2kMessage(pgn)
    }
  })
  */
  return (CanbusStream as any).super_.prototype.pipe.call(this, pipeTo)
}
