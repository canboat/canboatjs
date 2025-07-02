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

import { CanDevice } from './candevice'
import { CanID, encodeCanId, parseCanId } from './canId'
import { toActisenseSerialFormat, parseActisense } from './stringMsg'
import { toPgn } from './toPgn'
import { getPlainPGNs, binToActisense, createDebug } from './utilities'
import _ from 'lodash'

const debug = createDebug('canboatjs:simpleCan')

export function SimpleCan(
  this: any,
  options: any,
  messageCb: (data: any) => void
) {
  this.options = options
  this.messageCb = messageCb
  this.plainText = false
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  this.socketcan = require('socketcan')
}

SimpleCan.prototype.start = function () {
  const canDevice = this.options.canDevice || 'can0'

  this.channel = this.socketcan.createRawChannel(canDevice)
  if (this.messageCb) {
    this.channel.addListener('onMessage', (msg: any) => {
      const pgn = parseCanId(msg.id)

      if (
        this.candevice &&
        this.candevice.cansend &&
        pgn.src == this.candevice.address
      ) {
        return
      }

      const timestamp = new Date().toISOString()
      if (this.plainText) {
        this.messageCb(
          binToActisense(pgn, timestamp, msg.data, msg.data.length)
        )
      } else {
        this.messageCb({ pgn, length: msg.data.length, data: msg.data })
      }
    })
  }
  this.channel.start()
  this.candevice = new CanDevice(this, {
    ...this.options,
    disableDefaultTransmitPGNs: true,
    disableNAKs: true
  })
  this.candevice.start()
}

SimpleCan.prototype.sendPGN = function (msg: any) {
  if (this.candevice) {
    if (
      !this.candevice.cansend &&
      msg.pgn !== 59904 &&
      msg.pgn !== 60928 &&
      msg.pgn !== 126996
    ) {
      debug('ignoring %j', msg)
      return
    }

    debug('sending %j', msg)

    const src =
      msg.pgn === 59904 || (msg as any).forceSrc
        ? msg.src
        : this.candevice.address
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

    let canid: number
    let buffer: Buffer | undefined

    let pgn
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

    if (buffer) {
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

SimpleCan.prototype.sendActisenseFormat = function (msg: string) {
  this.sendPGN(msg)
}
