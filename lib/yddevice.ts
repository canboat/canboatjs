/**
 * Copyright 2025 Scott Bender (scott@scottbender.net)
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
import { N2kDevice } from './n2kDevice'
import { actisenseToYdgwFullRawFormat } from './toPgn'

export class YdDevice extends N2kDevice {
  app: any
  n2kOutEvent: string

  constructor(options: any) {
    super(options, 'canboatjs:yddevice')
    this.app = options.app
    this.n2kOutEvent = options.jsonOutEvent || 'nmea2000JsonOut'

    const analyzerOutEvent = options.analyzerOutEvent || 'N2KAnalyzerOut'

    this.app.on(analyzerOutEvent, this.n2kMessage.bind(this))
  }

  sendPGN(pgn: PGN, src: number | undefined = undefined) {
    pgn.src = src || this.address

    const ppgn = pgn as any //FIXME??
    ppgn.ydFullFormat = true

    this.debug('Sending PGN %j', pgn)
    this.app.emit(this.n2kOutEvent, pgn)
  }

  sendActisenseFormat(msg: string) {
    this.app.emit('ydFullRawOut', actisenseToYdgwFullRawFormat(msg))
  }
}
