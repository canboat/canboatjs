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
import { binToActisense } from './utilities'
import { getPgn, getCustomPgn } from './pgns'
import { bdtpDecode, bdtpEncode, checksumOk, newBdtpDecoder } from './bdtp'

const debug = createDebug('canboatjs:w2k01')
const debugData = createDebug('canboatjs:w2k01-data')

/*
  Actisense BST-D0 messages: whole NMEA 2000 messages, as a W2K-1 or
  PRO-NDC-1E2K sends them in its "Actisense" data mode. Specified in the
  Actisense SDK:
  https://github.com/Actisense/SDK/blob/main/docs/DataFormats/Binary/bst-detail/BST-D0.md

  A message travels in BDTP framing, DLE STX ... DLE ETX, with every DLE
  inside doubled. Unframed, it is

    D0 <L:u16 LE> <D> <S> <PDUS> <PDUF> <DPP> <C> <T:u32 LE> <data...> <checksum>

  - L is the length of everything before the checksum: 13 + data.
  - D is the destination; S PDUS PDUF DPP the CAN id, little-endian.
  - C is the control byte: message type in bits 0-1 (0 single frame, 1
    fast-packet, 2 ISO multi-packet), direction in bit 3 (1 = to the bus),
    internally generated in bit 4, fast-packet sequence in bits 5-7.
  - T is the device's millisecond clock. It is not used.
  - The checksum makes the 8-bit sum of the whole message zero.

  A frame with a bad length, checksum or escape is dropped, and reading
  resumes at the next DLE STX. Other BST messages are skipped.
*/

const BST_D0 = 0xd0

/* D0, L, D, the CAN id, C and T: everything before the data. */
const HEADER_LEN = 13
/* No NMEA 2000 message is longer than ISO transport's 255 packets of 7. */
const MAX_DATA_LEN = 255 * 7
const MAX_COLLECT = HEADER_LEN + MAX_DATA_LEN + 1
/* The most a fast-packet message carries. */
const FAST_PACKET_MAX_LEN = 223

const C_SINGLE = 0
const C_FAST_PACKET = 1
const C_ISO_MULTI_PACKET = 2
const C_TO_BUS = 1 << 3

/* The CAN id and data of an unframed message, or undefined when it is not
   a well-formed BST-D0 message. */
function toMessage(m: number[]) {
  if (m.length < HEADER_LEN + 1 || m[0] !== BST_D0) {
    return undefined
  }
  const len = m[1] | (m[2] << 8)
  if (len < HEADER_LEN || len + 1 !== m.length) {
    debug('bad length: %d for %d bytes', len, m.length)
    return undefined
  }
  if (!checksumOk(m)) {
    debug('bad checksum: %s', Buffer.from(m).toString('hex'))
    return undefined
  }
  const canId = (m[4] | (m[5] << 8) | (m[6] << 16) | (m[7] << 24)) >>> 0
  return {
    canId: canId & 0x1fffffff,
    data: Buffer.from(m.slice(HEADER_LEN, len))
  }
}

export const readN2KActisense = (
  data: Buffer,
  plainText: boolean,
  context: any,
  cb: (data: any) => void
) => {
  let last

  if (debugData.enabled) {
    debugData(
      'Received: (' + data.length + ') ' + Buffer.from(data).toString('hex')
    )
  }

  if (!context.bstD0) {
    context.bstD0 = newBdtpDecoder()
  }

  bdtpDecode(
    context.bstD0,
    data,
    MAX_COLLECT,
    (m) => {
      const msg = toMessage(m)
      if (!msg) {
        return
      }
      const info = parseCanId(msg.canId)
      const timestamp = new Date().toISOString()
      if (plainText) {
        last = binToActisense(info, timestamp, msg.data, msg.data.length)
      } else {
        last = {
          pgn: info,
          length: msg.data.length,
          data: msg.data,
          coalesced: true
        }
      }
      cb && cb(last)
    },
    (why) => debug(why)
  )

  return last
}

/* The message type the gateway needs to put `data` on the bus. */
function messageType(pgn: number, length: number) {
  if (length > FAST_PACKET_MAX_LEN) {
    return C_ISO_MULTI_PACKET
  }
  const custom = getCustomPgn(pgn)
  const definitions = [
    ...((custom && custom.definitions) || []),
    ...(getPgn(pgn) || [])
  ]
  if (definitions.length > 0 && definitions[0].Type === 'Fast') {
    return C_FAST_PACKET
  }
  return length > 8 ? C_ISO_MULTI_PACKET : C_SINGLE
}

/* `pgn` as one BDTP-framed BST-D0 message going to the bus. `data`
   defaults to `pgn.data`, as a parsed Actisense string carries it. */
export const encodeN2KActisense = (pgn: PGN, data?: Buffer) => {
  if (data === undefined) {
    data = (pgn as any).data as Buffer
  }
  const dst = pgn.dst === undefined ? 255 : pgn.dst
  const m = Buffer.alloc(HEADER_LEN + data.length + 1)
  m[0] = BST_D0
  m.writeUInt16LE(HEADER_LEN + data.length, 1)
  m[3] = dst
  m.writeUInt32LE(
    encodeCanId({
      pgn: pgn.pgn,
      src: pgn.src || 0,
      prio: pgn.prio || 2,
      dst
    }) >>> 0,
    4
  )
  m[8] = messageType(pgn.pgn, data.length) | C_TO_BUS
  // T, the time, is left 0, as the SDK allows.
  data.copy(m, HEADER_LEN)
  const encoded = bdtpEncode(m)

  if (debugData.enabled) {
    debugData('encoded: ' + encoded.toString('hex'))
  }

  return encoded
}
