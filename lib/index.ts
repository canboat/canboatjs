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

export { Parser as FromPgn } from './fromPgn'
export type { ByteMapping, ByteMap, RepeatingByteMapping } from './fromPgn'
export { setupFilters, filterPGN } from './utilities'
export type { FilterConfig, FilterOptions } from './utilities'
export { CanbusStream as canbus } from './canbus'
export { addCustomPgns } from './pgns'
export {
  parseN2kString,
  isN2KString,
  toActisenseSerialFormat,
  encodeCandump2,
  encodeActisense,
  encodeActisenseN2KACSII,
  encodeYDRAW,
  encodeYDRAWFull,
  encodePDGY,
  encodePCDIN,
  encodeMXPGN,
  encodeCandump1,
  encodeCandump3
} from './stringMsg'
export {
  toPgn,
  pgnToActisenseSerialFormat,
  pgnToActisenseN2KAsciiFormat,
  pgnToiKonvertSerialFormat,
  pgnToYdgwRawFormat,
  pgnToYdgwFullRawFormat,
  pgnToPCDIN,
  pgnToMXPGN,
  pgnToCandump1,
  pgnToCandump2,
  pgnToCandump3
} from './toPgn'
export { Ydgw02Stream as Ydwg02 } from './ydgw02'
export { Ydgw02Stream as Ydgw02 } from './ydgw02'
export { W2K01Stream as W2k01 } from './w2k01'
export { iKonvertStream as iKonvert } from './ikonvert'
export { MaretronIPGStream as MaretronIPG } from './maretron-ipg'
export { VenusStream as Venus } from './venus'
export { VenusMQTT } from './venus-mqtt'
export { discover } from './discovery'
export { SimpleCan } from './simpleCan'
export { N2kIpGateway } from './n2kIpGateway'
export type { N2kIpGatewayOptions } from './n2kIpGateway'
export { YdDevice } from './yddevice'
export { CanDevice } from './candevice'
export { N2kDevice } from './n2kDevice'
export { ActisenseStream as serial } from './actisense-serial'
export {
  buildMaretronConfigCommand,
  buildMaretronConfigCommandActisense,
  parseMaretronConfigResponse,
  getMaretronProductName,
  getMaretronOpcodeName
} from './maretron'
export type { MaretronConfigResponse } from './maretron'

import { getEnumerationValue, getEnumerationName } from '@canboat/ts-pgns'

export const lookupEnumerationValue = getEnumerationValue
export const lookupEnumerationName = getEnumerationName

import { PGN, PGN_60928, PGN_126998, PGN_126996 } from '@canboat/ts-pgns'

export interface DeviceEmulator {
  send(pgn: PGN | string): void
  onPGN(cb: (pgn: PGN) => void): void
}

export interface CanboatUtilities {
  supportsDeviceCreation: boolean

  createEmulator: (
    id: string,
    options: any,
    addressClaim: PGN_60928,
    productInfo: PGN_126996,
    configInfo: PGN_126998 | undefined
  ) => DeviceEmulator

  removeEmulator: (id: string) => void
}
