
/**
 * Copyright 2019 Scott Bender <scott@scottbender.net>
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

const debug = require('debug')('canboatjs:discovery')
const dgram = require('dgram')
const { isYDRAW } = require('./stringMsg')

module.exports = function discover(app) {

  if ( app.config.settings.pipedProviders ) {
    const exists = app.config.settings.pipedProviders.find(provider => {
      return provider.pipeElements
        && provider.pipeElements.length === 1
        && provider.pipeElements[0].type == 'providers/simple'
        && provider.pipeElements[0].options
        && provider.pipeElements[0].options.type === 'NMEA2000'
        && provider.pipeElements[0].options.subOptions.type === 'ydwg02-udp-canboatjs'
        && provider.pipeElements[0].options.subOptions.port === '2002'
    })

    if ( !exists ) {
      let socket = dgram.createSocket('udp4')
      socket.on('message', function (buffer, remote) {
        const msg = buffer.toString('utf8')
        if ( isYDRAW(msg) ) {
          socket.close()
          socket = undefined
          app.emit('discovered', {
            id: 'YDGW-02-UDP',
            pipeElements: [
              {
                "type": "providers/simple",
                "options": {
                  "logging": false,
                  "type": "NMEA2000",
                  "subOptions": {
                    "type": "ydwg02-udp-canboatjs",
                    "port": "2002"
                  }
                }
              }
            ]
          })
        }
      })
      socket.on('error', error => {
        debug(error)
      })
      socket.on('close', () => {
        debug('close')
      })
      debug('looking for YDGW over UDP')
      try {
        socket.bind(2002)
      } catch ( ex ) {
        debug(ex)
      }
      setTimeout(() => {
        if ( socket ) {
          socket.close()
        }
      }, 5000)
    }
  }  

  /*
  if ( app.config.settings.pipedProviders ) {
    const exists = app.config.settings.pipedProviders.find(provider => {
      return provider.pipeElements
        && provider.pipeElements.length === 1
        && provider.pipeElements[0].type == 'providers/simple'
        && provider.pipeElements[0].options
        && provider.pipeElements[0].options.type === 'NMEA2000'
        && provider.pipeElements[0].options.subOptions.host === '192.168.88.99'
        && provider.pipeElements[0].options.subOptions.port === '1457'
    })

    if ( !exists )
    {
      setTimeout(() =>
                 app.emit('discovered', {
                   id: 'TestDiscovered',
                   pipeElements: [
                     {
                       "type": "providers/simple",
                       "options": {
                         "logging": false,
                         "type": "NMEA2000",
                         "subOptions": {
                           "type": "ydwg02-canboatjs",
                           "host": "192.168.88.99",
                           "port": "1457"
                         }
                       }
                     }
                   ]
                 }), 5000)
      
    }
  }
*/
}
