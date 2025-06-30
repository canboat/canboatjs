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


const debug = require('debug')('canboatjs:n2kdevice')
const N2kDevice = require('./n2kDevice')

const { actisenseToYdgwFullRawFormat  } = require('./toPgn')

class YdDevice extends N2kDevice {
  constructor (options) {
    super(options)
    this.app = options.app
    this.n2kOutEvent = options.jsonOutEvent || 'nmea2000JsonOut'
    
    const analyzerOutEvent = options.analyzerOutEvent || 'N2KAnalyzerOut'
    
    this.app.on(analyzerOutEvent, this.n2kMessage.bind(this))
  }

  sendPGN(pgn, src) {
    pgn.src = src || this.address
    pgn.ydFullFormat = true
    debug('Sending PGN %j', pgn)
    this.app.emit(this.n2kOutEvent, pgn)
  }

  sendActisenseFormat(msg) {
    this.app.emit('ydFullRawOut', actisenseToYdgwFullRawFormat(msg))
  }
}

module.exports = YdDevice
