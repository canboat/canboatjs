/*
 * Copyright 2025 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const canboatjs = require('@canboat/canboatjs')
const util = require('util')

const keepAlivePGN = '%s,7,65305,%s,255,8,41,9f,01,17,1c,01,00,00'

export default function (app: any) {
  const error = app.error
  const debug = app.debug
  let props: any
  let onStop: any = []
  let device: any

  const plugin: Plugin = {
    start: function (properties: any) {
      props = properties


      let n2kOptions = {
        app,
        canDevice: props.candevice,
        preferredAddress: props.sourceAddress,
        disableDefaultTransmitPGNs: true,
        transmitPGNs: [126996],
        addressClaim: {
          'Unique Number': 1731561,
          'Manufacturer Code': 'Navico',
          'Device Function': 190,
          'Device Class': 'Internal Environment',
          'Device Instance Lower': 0,
          'Device Instance Upper': 0,
          'System Instance': 0,
          'Industry Group': 'Marine'
        },
        productInfo: {
          'nmea2000Version': 2100,
          'productCode': 246,
          'modelId': 'H5000 CPU',
          'Software Version Code': '2.0.45.0.29',
          'modelVersion': '',
          'modelSerialCode': '005469',
          'certificationLevel': 2,
          'loadEquivalency': 1
        }
      }

      if ( props.emulationType === 'socketcan' ) {
        device = new canboatjs.SimpleCan(n2kOptions)
        device.start()
      } else {
        app.on('nmea2000OutAvailable', () => {
          device = new canboatjs.YdDevice(n2kOptions)
          device.start()
        })
      }
      
      const timer = setInterval(() => {
        this.sendKeepAlive()
      }, 1000)
      
      onStop.push(() => { clearInterval(timer) })
    },
    
    sendKeepAlive: () =>  {
      let msg = util.format(keepAlivePGN, (new Date()).toISOString(),
                            device.address)
      device.sendActisenseFormat(msg)

      /*
      device.sendPGN({
        "prio":2,
        "dst":255,
        "pgn":127245,
        "fields":{
          "Instance":252,
          "Direction Order":4,
          "Angle Order":-0.0021,
          "Position":-0.0029,
          "Reserved1":null,
          "Reserved2":null
        }
        })
        */
    },
    
    stop: function () {
      onStop.forEach((f: any) => f())
      onStop = []
    },

    id: 'signalk-device-emulator',
    name: 'signalk-device-emulator',
    description: 'signalk-device-emulator',

    schema: () => {
      const schema: any = {
        type: 'object',
        properties: {
          emulationType: {
            type: 'string',
            title: 'Emulation Device',
            enum: ['socketcan', 'yd'],
            enumNames: [
            'SocketCan',
            'Yacht Devices'
            ],
            default: 'yd'
          },
          candevice: {
            type: "string",
            title: "Candevice to use for device emulation)",
            default: "can0"
          },
          sourceAddress: {
            type: "number",
            title: "Source device id for device emulation to use.",
            default: 199
          },
        }
      }
      return schema
    }
  }
  return plugin
}

interface Plugin {
  start: (app: any) => void
  stop: () => void
  sendKeepAlive: () => void
  id: string
  name: string
  description: string
  schema: any
}
