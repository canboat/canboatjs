/**
 * Copyright 2018 Scott Bender (scott@scottbender.net) and Jouni Hartikainen (jouni.hartikainen@iki.fi)
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

export class CanDevice extends N2kDevice {
  canbus: any

  constructor(canbus: any, options: any) {
    super(options, 'canboatjs:candevice')
    this.canbus = canbus

    if (options.app) {
      options.app.on(
        options.analyzerOutEvent || 'N2KAnalyzerOut',
        this.n2kMessage.bind(this)
      )
    }
  }

  sendPGN(pgn: PGN, src: number | undefined = undefined) {
    pgn.src = src || this.address
    this.debug('Sending PGN %j', pgn)
    this.canbus.sendPGN(pgn, true)
  }
}
