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

// Browser-safe exports only - no Node.js dependencies
export { Parser as FromPgn } from './fromPgn'
export type { ByteMapping, ByteMap, RepeatingByteMapping } from './fromPgn'
export { addCustomPgns } from './pgns'
export {
  parseN2kString,
  isN2KString,
  toActisenseSerialFormat,
  encodeCandump2
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
export { setupFilters, filterPGN } from './utilities'
export type { FilterConfig, FilterOptions } from './utilities'

import { getEnumerationValue, getEnumerationName } from '@canboat/ts-pgns'

export const lookupEnumerationValue = getEnumerationValue
export const lookupEnumerationName = getEnumerationName
