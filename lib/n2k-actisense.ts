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
import { createDebug } from './utilities'
import { parseCanId, encodeCanId } from './canId'
import { BitStream } from 'bit-buffer'
import { binToActisense } from './utilities'

const debug = createDebug('canboatjs:w2k01')
const debugData = createDebug('canboatjs:w2k01-data')

export const readN2KActisense = (
  data: Buffer,
  plainText: boolean,
  context: any,
  cb: (data: any) => void
) => {
  const inBuf = Buffer.from(data)
  let inOffset = 0
  let last

  if (debugData.enabled) {
    debugData(
      'Received: (' + data.length + ') ' + Buffer.from(data).toString('hex')
    )
  }

  try {
    while (true) {
      const len = inBuf.readUInt16LE(inOffset + 3)

      if (inBuf.length < inOffset + 5 + len) {
        /*
          I've never seen this happen
        context.lastChunk = Buffer.alloc(inBuf.length - inOffset)
        inBuf.copy(context.lastChunk, 0, inOffset, inBuf.length-1)
        */

        if (debug.enabled) {
          debug(
            'incomplete packet: (' +
              len +
              ') ' +
              inBuf.toString('hex', inOffset)
          )
        }

        return
      } else if (
        inBuf[inOffset + 5 + len - 1] != 0x03 ||
        inBuf[inOffset + 5 + len - 2] != 0x10
      ) {
        if (debug.enabled) {
          debug('bad packet: (' + len + ') ' + inBuf.toString('hex', inOffset))
        }
        //context.lastChunk = null
        return
      }

      const buf = Buffer.alloc(len)
      inBuf.copy(buf, 0, inOffset + 5, inOffset + len + 5)

      //console.log('NextBuf: (' + buf.length + ') ' + buf.toString('hex'))

      let offset = 0
      const _dst = buf.readUInt8(offset)
      offset += 1
      const canid = buf.readUInt32LE(offset)
      offset += 4
      const _timestamp = buf.readUInt32LE(offset)
      offset += 4
      const _mhs = buf.readUInt8(offset)
      offset += 1

      const info = parseCanId(canid)

      //console.log(`${len} ${mhs} ${dst} (${info.src}, ${info.dst}) ${info.pgn} ${timestamp}`)

      const pgnData = Buffer.alloc(len - offset - 3)
      buf.copy(pgnData, 0, offset, len - 3)
      const timestamp = new Date().toISOString()

      if (plainText) {
        last = binToActisense(info, timestamp, pgnData, pgnData.length)
        cb && cb(last)
      } else {
        last = {
          pgn: info,
          length: pgnData.length,
          data: pgnData,
          coalesced: true
        }
        cb && cb(last)
      }

      inOffset += len + 5
      if (inOffset == inBuf.length) {
        return last
      }
    }
  } catch (error) {
    debug(`[error] ${error}`)
    //context.lastChunk = null
    return
  }
}

export const encodeN2KActisense = (pgn: PGN, data: Buffer) => {
  const bs = new BitStream(Buffer.alloc(18 + data.length))

  bs.writeUint8(0x10) //BST Message ID
  bs.writeUint8(0x02)
  bs.writeUint8(0xd0)

  bs.writeUint16(13 + data.length) //len
  bs.writeUint8(pgn.dst)
  bs.writeUint32(
    encodeCanId({
      pgn: pgn.pgn,
      src: pgn.src || 0,
      prio: pgn.prio || 2,
      dst: pgn.dst
    })
  )
  bs.writeUint32(0) //timestamp
  bs.writeUint8(0) //mhs
  data.copy(bs.view.buffer, bs.byteIndex, 0)
  bs.byteIndex += data.length
  bs.writeUint8(0) // ??
  bs.writeUint8(0x10)
  bs.writeUint8(0x03)

  if (debugData.enabled) {
    debugData('encoded: ' + bs.view.buffer.toString('hex'))
  }

  return bs.view.buffer
}
