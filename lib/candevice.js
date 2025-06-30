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

const debug = require('debug')('canboatjs:candevice')
const EventEmitter = require('events')
const _ = require('lodash')
const Uint64LE = require('int64-buffer').Uint64LE
const { defaultTransmitPGNs } = require('./codes')
const { toPgn } = require('./toPgn')
const N2kDevice = require('./n2kDevice')

let packageJson
try
{
  packageJson = require('../' + 'package.json')
} catch (ex) {
}

const deviceTransmitPGNs = [ 60928, 59904, 126996, 126464 ]

class CanDevice extends N2kDevice {
  constructor (canbus, options) {
    super(options)
    this.canbus = canbus

    if ( options.app ) {
      options.app.on(options.analyzerOutEvent || 'N2KAnalyzerOut', this.n2kMessage.bind(this))
    }
  }

  sendPGN(pgn, src) {
    pgn.src = src || this.address
    debug('Sending PGN %j', pgn)
    this.canbus.sendPGN(pgn, true)
  }
}

module.exports = CanDevice
