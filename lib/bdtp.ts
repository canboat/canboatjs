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

/*
  BDTP framing, which Actisense BST messages travel in on a link
  (https://github.com/Actisense/SDK/blob/main/docs/DataProtocols/bdtp-protocol.md):
  DLE STX <message> DLE ETX, with every DLE in the message doubled. A BST
  message ends in a checksum that makes the 8-bit sum of the message zero.
*/

export const DLE = 0x10
export const STX = 0x02
export const ETX = 0x03

enum State {
  Idle /* outside a frame, looking for DLE STX */,
  IdleDle /* outside a frame, just after a DLE */,
  InFrame /* inside a frame, collecting bytes */,
  InFrameDle /* inside a frame, just after a DLE */
}

/* A decoder's state, kept between reads so a message split across reads is
   joined. */
export type BdtpDecoder = { state: State; buf: number[] }

export const newBdtpDecoder = (): BdtpDecoder => ({
  state: State.Idle,
  buf: []
})

/**
 * Feed `data` to the decoder `d`, calling `onMessage` with each message it
 * completes, unframed and with its DLEs undoubled, checksum included. A
 * frame with a bad escape, cut short by the next DLE STX, or longer than
 * `maxCollect` is dropped with a call to `onDrop`, and decoding resumes at
 * the next DLE STX.
 */
export function bdtpDecode(
  d: BdtpDecoder,
  data: Buffer,
  maxCollect: number,
  onMessage: (m: number[]) => void,
  onDrop: (why: string) => void = () => {}
) {
  const drop = (why: string) => {
    onDrop(why)
    d.state = State.Idle
    d.buf = []
  }
  const collect = (b: number) => {
    if (d.buf.length < maxCollect) {
      d.buf.push(b)
    } else {
      drop('message too long')
    }
  }

  for (const b of data) {
    switch (d.state) {
      case State.Idle:
        if (b === DLE) {
          d.state = State.IdleDle
        }
        break
      case State.IdleDle:
        if (b === STX) {
          d.state = State.InFrame
          d.buf = []
        } else if (b !== DLE) {
          d.state = State.Idle
        }
        break
      case State.InFrame:
        if (b === DLE) {
          d.state = State.InFrameDle
        } else {
          collect(b)
        }
        break
      case State.InFrameDle:
        if (b === DLE) {
          d.state = State.InFrame
          collect(DLE)
        } else if (b === ETX) {
          const m = d.buf
          d.state = State.Idle
          d.buf = []
          onMessage(m)
        } else if (b === STX) {
          // A new frame before this one ended: drop this one.
          drop('frame cut short')
          d.state = State.InFrame
        } else {
          drop(`bad escape: DLE ${b.toString(16)}`)
        }
        break
    }
  }
}

/* Whether the 8-bit sum of `m` is zero. */
export const checksumOk = (m: ArrayLike<number>) => {
  let sum = 0
  for (let i = 0; i < m.length; i++) {
    sum = (sum + m[i]) & 0xff
  }
  return sum === 0
}

/**
 * Set the last byte of `m` to the checksum of the rest, and frame it:
 * DLE STX, the message with its DLEs doubled, DLE ETX.
 */
export function bdtpEncode(m: Buffer) {
  let sum = 0
  for (let i = 0; i < m.length - 1; i++) {
    sum = (sum + m[i]) & 0xff
  }
  m[m.length - 1] = (256 - sum) & 0xff

  const out = [DLE, STX]
  for (const b of m) {
    out.push(b)
    if (b === DLE) {
      out.push(DLE)
    }
  }
  out.push(DLE, ETX)
  return Buffer.from(out)
}
