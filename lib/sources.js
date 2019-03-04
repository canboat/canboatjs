/**
 * Copyright 2019 Scott Bender (scott@scottbender.net)
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



const sources = [
  {
    type: 'ngt-1-canboatjs',
    sourceKey: 'NMEA2000JS',
    name: 'Actisense NGT-1',
    input: 'serial',
    inputModules: ['@canboat/canboatjs/lib/serial'],
    defaults: [{
      baudRate: 115200,
      outEvent: 'nmea2000out'
    }]
  },
  {
    type: 'ikonvert-canboatjs',
    sourceKey: 'NMEA2000IK',
    name: 'iKonvert',
    input: 'serial',
    inputModules: ['./serialport'],
    defaults: [{
      baudrate: 230400,
      toStdout: 'ikonvertOut'
    }],
    timestampThrottleOptions: {
      getMilliseconds: msg => {
        return msg.timer * 1000
      }
    }
  },
  {
    type: 'ydwg02-canboatjs',
    sourceKey: 'NMEA2000IK',
    name: 'Yacht Devices YDWG-02',
    input: 'network',
    inputModules: [ './tcp', './liner' ]
  }
]

function getSources() {
  return sources
}

function getSourceForType(type) {
  return sources.find(source => { return type == source.type })
}

module.exports.getSources = getSources
module.exports.getSourceForType = getSourceForType

