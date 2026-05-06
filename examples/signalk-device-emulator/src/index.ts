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

/// <reference types="node" />

import { ServerAPI, Plugin, PropertyValue } from '@signalk/server-api'

import {
  PGN,
  PGN_60928,
  PGN_126998,
  PGN_126996,
  ManufacturerCode,
  DeviceFunction,
  DeviceClass,
  YesNo,
  IndustryCode
} from '@canboat/ts-pgns'

import { DeviceEmulator, CanboatUtilities } from '@canboat/canboatjs'

const start = (app: ServerAPI) => {
  let onStop: any = []
  let emulator: DeviceEmulator | undefined = undefined
  let utils: CanboatUtilities | undefined = undefined

  const plugin: Plugin = {
    start: (_properties: any, _restartPluginParam) => {
      app.onPropertyValues(
        'canboatjsUtils',
        (propValuesHistory: (PropertyValue | undefined)[]) => {
          
          if (propValuesHistory !== undefined) {
            propValuesHistory.forEach((propValue) => {
              if ( emulator !== undefined ) {
                //make we don't create multiple emulators if we get multiple events
                return
              }

              if (propValue !== undefined) {
                utils = (propValue.value as any)
                  .utils as CanboatUtilities
                if (utils.supportsDeviceCreation) {
                  emulator = utils.createEmulator(
                    plugin.id,
                    {},
                    new PGN_60928({
                      manufacturerCode: ManufacturerCode.BepMarine,
                      deviceFunction: DeviceFunction.SwitchInterface,
                      deviceClass: DeviceClass.ElectricalDistribution,
                      deviceInstanceLower: 0,
                      deviceInstanceUpper: 0,
                      systemInstance: 0,
                      industryGroup: IndustryCode.Marine,
                      arbitraryAddressCapable: YesNo.Yes
                    }),
                    new PGN_126996({
                      nmea2000Version: 1300,
                      productCode: 100,
                      modelId: 'mock-czone-device',
                      softwareVersionCode: '1.0',
                      modelVersion: '1.0',
                      modelSerialCode: '123456',
                      certificationLevel: 0,
                      loadEquivalency: 1
                    }),
                    new PGN_126998({
                      installationDescription1: 'Signal K Device Emulator'
                    })
                  )
                  emulator.onPGN((_pgn: PGN) => { })
                }
              }
            })
          }
        }
      )
    },

    stop: function () {
      onStop.forEach((f: any) => f())
      onStop = []
      utils?.removeEmulator(plugin.id)
    },

    id: 'signalk-device-emulator',
    name: 'Signal K Device Emulator',
    description: 'Signal K Plugin to emulate a candevice',

    schema: {}
  }

  return plugin
}

module.exports = start
export default start
