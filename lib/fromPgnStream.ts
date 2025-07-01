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
import { Transform } from 'stream'
import { Parser as FromPgn } from './fromPgn'
import util from 'util'

const debug = _debug('canboatjs:FromPgnStream')

function fromPgnStream(this: any, options: any) {
  Transform.call(this, {
    objectMode: true
  })

  this.fromPgn = new FromPgn(options)

  this.fromPgn.on('pgn', (pgn: PGN) => {
    this.push(pgn)
  })

  this.fromPgn.on('warning', (pgn: PGN, warning: string) => {
    debug(`[warning] ${pgn.pgn} ${warning}`)
  })

  this.fromPgn.on('error', (pgn: PGN, error: any) => {
    debug(`[error] ${pgn.pgn} ${error}`)
  })
}

util.inherits(fromPgnStream, Transform)

fromPgnStream.prototype._transform = function (
  chunk: any,
  encoding: string,
  done: any
) {
  this.fromPgn.parse(chunk)
  done()
}

module.exports = fromPgnStream
