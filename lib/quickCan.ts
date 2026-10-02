/**
 * Copyright 2025 Signal K contributors
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

/**
 * Quick CAN Protocol handler.
 *
 * Reads/writes 11-bit standard CAN frames from a dedicated SocketCAN
 * interface. Each CAN ID maps directly to a message type (no PGN encoding).
 * Multi-byte fields are little-endian. The talker identifier is the first
 * 16 bits of the payload and is decoded as a field, not derived from the frame.
 */

import { CanChannel, CanMessage } from './canSocket'
import { parseQuickCanId, encodeQuickCanId, quickCanIdString } from './canId'
import { getQuickMessageDef, isQuickCanId } from './quickPgns'
import { toQuickPgn } from './toPgn'
import { createDebug } from './utilities'
import _ from 'lodash'

export type QuickMessage = {
  protocol: 'quick'
  canId: number
  timestamp: string
  length: number
  data: Buffer
}

export type QuickCanOptions = {
  canDevice?: string
  app?: any
  providerId?: string
}

export function QuickCan(
  this: any,
  options: QuickCanOptions,
  messageCb: (data: QuickMessage) => void
) {
  this.options = options
  this.messageCb = messageCb
  this.debug = createDebug('canboatjs:quickCan', options)
}

QuickCan.prototype.start = function () {
  const canDevice = this.options.canDevice || 'can0'

  this.channel = new CanChannel(canDevice)

  if (this.messageCb) {
    this.channel.addListener('onMessage', (msg: CanMessage) => {
      // Only process 11-bit standard frames for Quick protocol
      if (msg.ext) {
        return
      }

      const quickId = parseQuickCanId(msg.id)

      if (!isQuickCanId(quickId.canId)) {
        return // unknown Quick CAN ID
      }

      const timestamp = new Date().toISOString()

      const quickMsg: QuickMessage = {
        protocol: 'quick',
        canId: quickId.canId,
        timestamp,
        length: msg.data.length,
        data: msg.data
      }

      this.debug(
        'received Quick message: CAN ID=0x%s len=%d',
        quickCanIdString(quickId.canId),
        msg.data.length
      )

      this.messageCb(quickMsg)
    })
  }

  this.channel.start()
}

QuickCan.prototype.stop = function () {
  if (this.channel) {
    this.channel.stop()
    this.channel = undefined
  }
}

/**
 * Send a Quick protocol message.
 *
 * @param msg - The message to send. Must include:
 *   - canId: 11-bit CAN ID (0x000 - 0x7FF)
 *   - fields: field values keyed by field id, including `sourceAddress`
 *     (the talker identifier, written as the first uint16 LE)
 *   OR
 *   - data: raw Buffer to send (optional, for raw payload)
 */
QuickCan.prototype.sendPGN = function (msg: any) {
  if (!this.channel) {
    this.debug('cannot send: channel not started')
    return
  }

  const canId = encodeQuickCanId(msg.canId)
  const pgnDef = getQuickMessageDef(canId)

  let data: Buffer

  if (msg.data && Buffer.isBuffer(msg.data)) {
    // Raw buffer provided
    data = msg.data
  } else if (pgnDef && msg.fields) {
    // Encode fields from definition
    const encoded = toQuickPgn(canId, msg.fields)
    if (!encoded) {
      this.debug(
        'cannot send: no Quick PGN definition for CAN ID 0x%s',
        quickCanIdString(canId)
      )
      return
    }
    data = encoded
  } else {
    this.debug(
      'cannot send: no data or field definition for CAN ID 0x%s',
      quickCanIdString(canId)
    )
    return
  }

  this.debug(
    'sending Quick message: CAN ID=0x%s len=%d',
    quickCanIdString(canId),
    data.length
  )

  this.channel.send({ id: canId, ext: false, data })

  if (
    this.options.app &&
    this.options.app.listenerCount('canboatjs:rawsend') > 0
  ) {
    this.options.app.emit('canboatjs:rawsend', {
      knownSrc: true,
      data: {
        pgn: canId,
        length: data.length,
        data: Array.from(data)
      }
    })
  }
}
