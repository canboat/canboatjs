/**
 * Copyright 2026 Kees Verruijt (kees@verruijt.net)
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
import { encodeCanId, parseCanId } from './canId'
import { bdtpDecode, bdtpEncode, checksumOk, newBdtpDecoder } from './bdtp'

const debug = createDebug('canboatjs:bst95')

/*
  Actisense BST-95 raw CAN frames, as a W2K-1 or PRO-NDC-1E2K sends them in
  its "CAN Actisense" data mode, and an NGX in its CAN Packet operating
  mode. Specified in the Actisense SDK:
  https://github.com/Actisense/SDK/blob/main/docs/DataFormats/Binary/bst-detail/BST-95-can-frame.md

  A message travels in BDTP framing (see ./bdtp). Unframed, it is

    95 <L> <T:u16 LE> <S> <PDUS> <PDUF> <DPPC> <data: 0-8 bytes> <checksum>

  - L is the length of what follows it, the checksum aside: 6 + data.
  - T is the device's clock. It is not used.
  - S PDUS PDUF are the CAN id's source, PDU specific and PDU format.
  - DPPC holds the data page (bits 0-1) and priority (bits 2-4) of the CAN
    id, the timestamp resolution (bits 5-6) and the direction (bit 7, 1 =
    to the bus).

  Each message is one CAN frame: fast-packets are joined by the analyzer,
  as for other CAN-level formats. A frame on its way to the bus is the
  gateway echoing one we sent, and is skipped.
*/

const BST_95 = 0x95
/* 95, L, T, S, PDUS, PDUF, DPPC: everything before the data. */
const HEADER_LEN = 8
const MAX_DATA_LEN = 8
const DPPC_TO_BUS = 0x80

export type Bst95Frame = {
  canId: number
  pgn: number
  src: number
  dst: number
  prio: number
  data: Buffer
  timestamp: string
}

/* The CAN frame in an unframed message, and whether it is going to the
   bus; undefined when it is not a well-formed BST-95 message. */
function toFrame(m: number[]) {
  if (m.length < HEADER_LEN + 1 || m[0] !== BST_95) {
    return undefined
  }
  if (m[1] + 3 !== m.length || m[1] - 6 > MAX_DATA_LEN) {
    debug('bad length: %d for %d bytes', m[1], m.length)
    return undefined
  }
  if (!checksumOk(m)) {
    debug('bad checksum: %s', Buffer.from(m).toString('hex'))
    return undefined
  }
  const canId =
    (m[4] | (m[5] << 8) | (m[6] << 16) | ((m[7] & 0x1f) << 24)) >>> 0
  return {
    toBus: (m[7] & DPPC_TO_BUS) !== 0,
    canId,
    data: Buffer.from(m.slice(HEADER_LEN, m.length - 1))
  }
}

/**
 * Read BST-95 messages from `data`, calling `cb` with each CAN frame
 * received from the bus. A message split across reads is kept in
 * `context` until the rest arrives.
 */
export function readBst95(
  data: Buffer,
  context: any,
  cb: (frame: Bst95Frame) => void
) {
  if (!context.bst95) {
    context.bst95 = newBdtpDecoder()
  }
  bdtpDecode(
    context.bst95,
    data,
    HEADER_LEN + MAX_DATA_LEN + 1,
    (m) => {
      // Other BST messages (a BEM answer, say) are not CAN frames.
      const frame = toFrame(m)
      if (!frame || frame.toBus) {
        return
      }
      cb({
        ...parseCanId(frame.canId),
        data: frame.data,
        timestamp: new Date().toISOString()
      })
    },
    (why) => debug(why)
  )
}

/**
 * One CAN frame, `data` of at most 8 bytes, as a BDTP-framed BST-95
 * message from the host to the bus. The time is left 0.
 */
export function encodeBst95(
  id: { pgn: number; src: number; dst: number; prio: number },
  data: Buffer
) {
  if (data.length > MAX_DATA_LEN) {
    throw new Error(`BST-95: ${data.length} bytes do not fit one CAN frame`)
  }
  const canId = encodeCanId(id)
  const m = Buffer.alloc(HEADER_LEN + data.length + 1)
  m[0] = BST_95
  m[1] = 6 + data.length
  m[4] = canId & 0xff
  m[5] = (canId >> 8) & 0xff
  m[6] = (canId >> 16) & 0xff
  m[7] = ((canId >> 24) & 0x1f) | DPPC_TO_BUS
  data.copy(m, HEADER_LEN)
  return bdtpEncode(m)
}
