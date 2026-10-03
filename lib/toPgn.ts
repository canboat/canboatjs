/**
 * Copyright 2018 Scott Bender (scott@scottbender.net)
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

import {
  Field,
  PGN,
  getEnumerationValue,
  getFieldTypeEnumerationValue,
  getFieldTypeEnumeration,
  getBitEnumerationName
} from '@canboat/ts-pgns'
import { getField } from './fromPgn'
import { getPgn, getCustomPgn } from './pgns'
import _ from 'lodash'
import { scaleOf, siConversion } from './units'
import { BitStream } from 'bit-buffer'
import { Int64LE, Uint64LE } from 'int64-buffer'
import {
  encodeActisense,
  encodeActisenseN2KACSII,
  encodeYDRAW,
  encodeYDRAWFull,
  parseActisense,
  encodePCDIN,
  encodeMXPGN,
  encodePDGY,
  encodeCandump1,
  encodeCandump2,
  encodeCandump3
} from './stringMsg'
import { encodeN2KActisense } from './n2k-actisense'
import { createDebug, isPGNProprietary } from './utilities'

const debug = createDebug('canboatjs:toPgn')

const RES_STRINGLAU = 'STRING_LAU' //'ASCII or UNICODE string starting with length and control byte'
const RES_STRINGLZ = 'STRING_LZ' //'ASCII string starting with length byte'

type FieldTypeWriter = (
  pgn: number,
  field: Field,
  value: any,
  bs: BitStream
) => void
type FieldTypeMapper = (field: Field, value: any) => any

const fieldTypeWriters: {
  [key: string]: FieldTypeWriter
} = {}
const fieldTypeMappers: {
  [key: string]: FieldTypeMapper
} = {}

//const lengthsOff: {[key: number]: number} = { 129029: 45, 127257:8, 127258:8, 127251:8 }

const a126208_oldKey = '# of Parameters'
const a126208_newKey = 'Number of Parameters'

export function toPgn(data: any): Buffer | undefined {
  const customPgns = getCustomPgn(data.pgn)
  let pgnList = getPgn(data.pgn)
  if (!pgnList && !customPgns) {
    debug('no pgn found: ' + data.pgn)
    return
  }

  if (customPgns) {
    pgnList = [...customPgns.definitions, ...(pgnList || [])]
  }

  if (!pgnList || pgnList.length === 0) {
    debug('no pgn found: ' + data.pgn)
    return undefined
  }

  //we would never write fallback pgns
  pgnList = pgnList.filter(
    (pgn: any) => pgn.Fallback === undefined || pgn.Fallback === false
  )

  const pgn_number = data.pgn
  let pgnData = pgnList[0]

  const bs = new BitStream(Buffer.alloc(500))

  if (data.fields) {
    data = data.fields
  }

  if (pgn_number === 126208 && !data[a126208_newKey] && data[a126208_oldKey]) {
    //a bit of a hack because this field name changed and I'm sure there is code out
    //there that still uses the old field name

    data[a126208_newKey] = data[a126208_oldKey]
  }

  let fields = pgnData.Fields
  let RepeatingFields1 = pgnData.RepeatingFieldSet1Size ?? 0
  let RepeatingFields2 = pgnData.RepeatingFieldSet2Size ?? 0
  let totalRepeatingFields = RepeatingFields1 + RepeatingFields2
  let targetPgnForCondition: number | undefined
  for (let index = 0; index < fields.length - totalRepeatingFields; index++) {
    const field = fields[index]

    // Skip conditional proprietary fields when target PGN is not proprietary
    if (
      field.Condition === 'PGNIsProprietary' &&
      targetPgnForCondition !== undefined &&
      !isPGNProprietary(targetPgnForCondition)
    ) {
      continue
    }

    let value =
      data[field.Name] !== undefined ? data[field.Name] : data[field.Id]

    // Capture the target PGN value for conditional field checks
    if (field.FieldType === 'PGN' && typeof value === 'number') {
      targetPgnForCondition = value
    }

    if (!_.isUndefined(field.Match)) {
      //console.log(`matching ${field.Name} ${field.Match} ${value} ${_.isString(value)}`)
      if (_.isString(value)) {
        pgnList = pgnList.filter(
          (f) =>
            (f.Fields[index].Description == value ||
              f.Fields[index].Description === undefined) &&
            f.Fallback !== true
        )
      } else {
        pgnList = pgnList.filter(
          (f) =>
            (f.Fields[index].Match == value ||
              f.Fields[index].Match === undefined) &&
            f.Fallback !== true
        )
      }
      if (pgnList.length > 0) {
        //console.log(`matched ${field.Name} ${pgnList[0].Fields[index].Match}`)
        pgnData = pgnList[0]
        value = pgnData.Fields[index].Match
        fields = pgnData.Fields
        RepeatingFields1 = pgnData.RepeatingFieldSet1Size ?? 0
        RepeatingFields2 = pgnData.RepeatingFieldSet2Size ?? 0
        totalRepeatingFields = RepeatingFields1 + RepeatingFields2
      }
    }
    writeField(bs, pgn_number, field, data, value, fields)
  }

  // Process RepeatingFieldSet1 from data.list
  if (data.list) {
    const set1Start = fields.length - totalRepeatingFields
    data.list.forEach((repeat: any) => {
      for (let index = 0; index < RepeatingFields1; index++) {
        const field = fields[set1Start + index]
        const value =
          repeat[field.Name] !== undefined
            ? repeat[field.Name]
            : repeat[field.Id]

        writeField(
          bs,
          pgn_number,
          field,
          data,
          value,
          fields,
          undefined,
          repeat
        )
      }
    })
  }

  // Process RepeatingFieldSet2 from data.list2
  if (data.list2 && RepeatingFields2 > 0) {
    const set2Start = fields.length - RepeatingFields2
    data.list2.forEach((repeat: any) => {
      for (let index = 0; index < RepeatingFields2; index++) {
        const field = fields[set2Start + index]
        const value =
          repeat[field.Name] !== undefined
            ? repeat[field.Name]
            : repeat[field.Id]

        writeField(
          bs,
          pgn_number,
          field,
          data,
          value,
          fields,
          undefined,
          repeat
        )
      }
    })
  }

  const bitsLeft = bs.byteIndex * 8 - bs.index
  if (bitsLeft > 0) {
    //finish off the last byte
    bs.writeBits(0xffff, bitsLeft)
    //console.log(`bits left ${bitsLeft}`)
  }

  if (
    pgnData.Length !== undefined &&
    pgnData.Length !== 0xff &&
    fields[fields.length - 1].FieldType !== RES_STRINGLAU &&
    fields[fields.length - 1].FieldType !== RES_STRINGLZ &&
    !totalRepeatingFields
  ) {
    //const len = lengthsOff[pgnData.PGN] || pgnData.Length
    //console.log(`Length ${len}`)

    //if ( bs.byteIndex < pgnData.Length ) {
    //console.log(`bytes left ${pgnData.Length-bs.byteIndex}`)
    //}

    for (let i = bs.byteIndex; i < pgnData.Length; i++) {
      bs.writeUint8(0xff)
    }
  }

  return bs.view.buffer.slice(0, bs.byteIndex)
}

/*
function dumpWritten(bs, field, startPos, value) {
  //console.log(`${startPos} ${bs.byteIndex}`)
  if ( startPos == bs.byteIndex )
    startPos--
  let string = `${field.Name} (${field.BitLength}): [`
  for ( let i = startPos; i < bs.byteIndex; i++ ) {
    string = string + bs.view.buffer[i].toString(16) + ', '
  }
  console.log(string + `] ${value}`)
}
*/

function writeField(
  bs: BitStream,
  pgn_number: number,
  field: Field,
  data: any,
  value: any,
  fields: Field[],
  bitLength: number | undefined = undefined,
  // The repeating-set record being written, which holds a dynamic value's
  // key; data, the whole message, holds it otherwise.
  record: any = data
) {
  //const startPos = bs.byteIndex

  if (bitLength === undefined) {
    if (field.BitLengthVariable && field.FieldType === 'DYNAMIC_FIELD_VALUE') {
      bitLength = lookupKeyBitLength(record, fields)
    } else {
      bitLength = field.BitLength
    }
  }

  // console.log(`${field.Name}:${value}(${bitLength}-${field.Resolution})`)
  if (
    (value === undefined || value === null) &&
    field.FieldType === 'VARIABLE'
  ) {
    // A group function parameter's value: its width comes from the target
    // field, so without a value nothing would be written and every later
    // byte would shift (#458). canboat's encoder refuses it too.
    const target = data.pgn ?? data.PGN
    const parameter = record.parameter ?? record.Parameter
    throw new Error(`Parameter ${parameter} of PGN ${target} has no value`)
  }
  if (value === undefined || value === null) {
    if (field.FieldType && fieldTypeWriters[field.FieldType]) {
      fieldTypeWriters[field.FieldType](pgn_number, field, value, bs)
    } else if (bitLength !== undefined && bitLength % 8 == 0) {
      const bytes = bitLength / 8
      //const byte = field.Name.startsWith('Reserved') ? 0x00 : 0xff
      for (let i = 0; i < bytes - 1; i++) {
        bs.writeUint8(0xff)
      }
      bs.writeUint8(field.Signed && !field.Offset ? 0x7f : 0xff) // Excess-K: unsigned
    } else if (bitLength !== undefined) {
      bs.writeBits(0xffffffff, bitLength)
    } else {
      //FIXME: error! should not happen
    }
  } else {
    if (field.FieldType === 'DYNAMIC_FIELD_VALUE') {
      // A lookup name gives the raw code; a number, also one written as
      // text, is in SI and takes the key's scaling off.
      if (_.isString(value)) {
        value = dynamicLookupValue(record, fields, value)
        if (_.isString(value)) {
          value = dynamicStringValue(record, value)
          if (typeof value === 'number') {
            value = dynamicScaledValue(record, fields, value)
          }
        }
      } else if (typeof value === 'number') {
        value = dynamicScaledValue(record, fields, value)
      }
    }
    const type = field.FieldType
    if (type && fieldTypeMappers[type]) {
      value = fieldTypeMappers[type](field, value)
    } else if (
      (field.FieldType === 'LOOKUP' ||
        field.FieldType === 'DYNAMIC_FIELD_KEY') &&
      _.isString(value)
    ) {
      value = lookup(field, value)
    }

    if (
      (field.FieldType == 'NUMBER' || field.FieldType === 'FLOAT') &&
      _.isString(value)
    ) {
      value = Number(value)
    }

    // The value is SI, as the decoder gives it: back to the unit the
    // database states the resolution in (J to kWh, ratio to %, ...)
    // before the resolution comes off.
    if (typeof value === 'number') {
      const si = siConversion(field.Unit, (field as any).PhysicalQuantity)
      if (si !== undefined) {
        value = (value * si.div) / si.mul
      }
      // canboat's Offset is in the field's own units, so remove it before
      // scaling to the raw value.
      if (field.Offset) {
        value -= field.Offset
      }
    }

    if (field.Resolution && typeof value === 'number') {
      // A FLOAT carries its fraction on the wire: no rounding to a count.
      value =
        field.FieldType === 'FLOAT'
          ? value / field.Resolution
          : Number((value / field.Resolution).toFixed(0))
    }

    if (field.FieldType && fieldTypeWriters[field.FieldType]) {
      fieldTypeWriters[field.FieldType](pgn_number, field, value, bs)
    } else {
      /*
      if ( _.isString(value) && typeof bitLength !== 'undefined' && bitLength !== 0 ) {
        value = Number(value)
        }
        */

      if (field.FieldType === 'VARIABLE') {
        writeVariableLengthField(bs, pgn_number, data, field, value, fields)
      } else if (_.isBuffer(value)) {
        value.copy(bs.view.buffer, bs.byteIndex)
        bs.byteIndex += value.length
      } else if (bitLength !== undefined) {
        // An Excess-K field (Signed with an Offset) holds an unsigned raw
        // value, as the decoder reads it.
        const signed = !!field.Signed && !field.Offset
        if (bitLength === 8) {
          if (signed) {
            bs.writeInt8(value)
          } else {
            bs.writeUint8(value)
          }
        } else if (bitLength === 16) {
          if (signed) {
            bs.writeInt16(value)
          } else {
            bs.writeUint16(value)
          }
        } else if (bitLength === 32) {
          if (signed) {
            bs.writeInt32(value)
          } else {
            bs.writeUint32(value)
          }
        } else if (bitLength === 48 || bitLength == 24) {
          let count = bitLength / 8
          let val = value
          if (value < 0) {
            val++
          }
          while (count-- > 0) {
            if (value > 0) {
              bs.writeUint8(val & 255)
              val /= 256
            } else {
              bs.writeUint8((-val & 255) ^ 255)
              val /= 256
            }
          }
        } else if (bitLength === 64) {
          let num
          if (signed) {
            num = new Int64LE(value)
          } else {
            num = new Uint64LE(value)
          }
          const buf = num.toBuffer()
          buf.copy(bs.view.buffer, bs.byteIndex)
          bs.byteIndex += buf.length
        } else {
          bs.writeBits(value, bitLength)
        }
      }
    }
  }
  //dumpWritten(bs, field, startPos, value)
}

function writeVariableLengthField(
  bs: BitStream,
  pgn_number: number,
  pgn: any,
  field: Field,
  value: any,
  fields: Field[]
) {
  const refField = getField(
    pgn.pgn | pgn.PGN,
    bs.view.buffer[bs.byteIndex - 1] - 1,
    pgn
  )

  if (refField) {
    // As canboat's encoder: a key/value field's value is bytes, not a
    // number. It used to go out silently wrong (#458), typically because
    // the target PGN has several variants and the pairs did not pick the
    // intended one.
    const target = pgn.pgn ?? pgn.PGN
    if (
      refField.FieldType === 'DYNAMIC_FIELD_VALUE' &&
      !Buffer.isBuffer(value)
    ) {
      throw new Error(
        `Parameter ${(refField as any).Order} of PGN ${target} is a key/value field ` +
          `(${refField.Name}) and needs its value bytes. If another variant ` +
          'of the PGN is meant, give its manufacturer (parameter 1) and ' +
          'industry (parameter 3) first'
      )
    }
    let bits

    if (refField.BitLength !== undefined) {
      bits = (refField.BitLength + 7) & ~7 // Round # of bits in field refField up to complete bytes: 1->8, 7->8, 8->8 etc.
    }

    return writeField(bs, pgn_number, refField, pgn, value, fields, bits)
  }
}

function lookup(field: Field, stringValue: string) {
  let res
  if (field.LookupEnumeration) {
    res = getEnumerationValue(field.LookupEnumeration, stringValue)
  } else {
    res = getFieldTypeEnumerationValue(
      field.LookupFieldTypeEnumeration,
      stringValue
    )
  }
  return _.isUndefined(res) ? stringValue : res
}

function lookupKeyBitLength(data: any, fields: Field[]) {
  const entry = dynamicKeyEntry(data, fields)
  return entry?.Bits === undefined ? undefined : Number(entry.Bits)
}

/**
 * A DYNAMIC_FIELD_VALUE given as the name its key's lookup gives it, as
 * the decoder reports a LOOKUP value ("90%" for a Simnet Backlight level),
 * goes on the wire as that name's number. Any other value is written as is.
 */
function dynamicLookupValue(data: any, fields: Field[], value: string) {
  const entry = dynamicKeyEntry(data, fields)
  if (entry?.LookupEnumeration === undefined) {
    return value
  }
  return getEnumerationValue(entry.LookupEnumeration, value) ?? value
}

type DynamicKeyEntry = {
  value: number
  FieldType?: string
  Bits?: string
  Resolution?: number
  Unit?: string
  LookupEnumeration?: string
}

/**
 * The LookupFieldTypeEnumeration entry the record's DYNAMIC_FIELD_KEY
 * selects, by name or number: the key field is found by its type, so
 * Victron's registerId and Navico's sourceSettingId count as well as Key.
 */
function dynamicKeyEntry(
  data: any,
  fields: Field[]
): DynamicKeyEntry | undefined {
  const field = fields.find((f) => f.FieldType === 'DYNAMIC_FIELD_KEY')
  if (field?.LookupFieldTypeEnumeration === undefined) {
    return undefined
  }
  let key = data[field.Name] ?? data[field.Id]
  if (typeof key === 'string') {
    key = getFieldTypeEnumerationValue(field.LookupFieldTypeEnumeration, key)
  }
  const entries: DynamicKeyEntry[] =
    getFieldTypeEnumeration(field.LookupFieldTypeEnumeration)
      ?.EnumFieldTypeValues ?? []
  return entries.find((v) => v.value === key)
}

/**
 * A dynamic number or duration in SI, as the decoder gives it, back to
 * the count its key's entry puts on the wire: Polar Performance 0.1 (a
 * ratio) is 100 x 0.1 %.
 */
function dynamicScaledValue(data: any, fields: Field[], value: number) {
  const entry = dynamicKeyEntry(data, fields)
  if (
    entry === undefined ||
    !/^(NUMBER|FIX|UFIX|DURATION|TIME)/.test(entry.FieldType ?? '')
  ) {
    return value
  }
  return Math.round(value / scaleOf(entry).resolution)
}

/**
 * A DYNAMIC_FIELD_VALUE string that no lookup resolved: a number written
 * as text, or bytes in hex as the decoder gives the value of a key it has
 * no type for ("2d 7d 10 14"). Anything else would reach the bit writer,
 * which turns a string into 0, so it is refused.
 */
function dynamicStringValue(record: any, value: string): number | Buffer {
  const text = value.trim()
  if (text !== '' && Number.isFinite(Number(text))) {
    return Number(text)
  }
  if (/^[0-9a-f]{2}([ ,][0-9a-f]{2})*$/i.test(text)) {
    return Buffer.from(text.split(/[ ,]/).map((b) => parseInt(b, 16)))
  }
  const key = record['Key'] ?? record['key']
  throw new Error(`Invalid value for key ${key}: '${value}'`)
}

/*

function parseHex(s:string): number {
  return parseInt(s, 16)
};

function canboat2Buffer(canboatData:string) {
  return Buffer.alloc(canboatData
                     .split(',')
                     .slice(6)
                     .map(parseHex), 'hex')
                     }
*/

export function pgnToActisenseSerialFormat(pgn: PGN) {
  return encodeActisense({
    pgn: pgn.pgn,
    data: toPgn(pgn),
    dst: pgn.dst,
    src: pgn.src,
    prio: pgn.prio,
    timestamp: undefined
  })
}

export function pgnToActisenseN2KAsciiFormat(pgn: PGN) {
  return encodeActisenseN2KACSII({
    pgn: pgn.pgn,
    data: toPgn(pgn),
    dst: pgn.dst,
    src: pgn.src,
    prio: pgn.prio,
    timestamp: undefined
  })
}

export function pgnToN2KActisenseFormat(pgn: PGN) {
  const data = toPgn(pgn)
  if (data) {
    return encodeN2KActisense(pgn, data)
  }
}

export function toiKonvertSerialFormat(pgn: number, data: Buffer, dst = 255) {
  return `!PDGY,${pgn},${dst},${data.toString('base64')}`
}

export function pgnToiKonvertSerialFormat(pgn: any) {
  const data = toPgn(pgn)
  if (data) {
    return toiKonvertSerialFormat(pgn.pgn, data, pgn.dst)
  }
}

export function pgnToYdgwRawFormat(info: any) {
  return encodeYDRAW({ ...info, data: toPgn(info) })
}

export function pgnToYdgwFullRawFormat(info: any) {
  return encodeYDRAWFull({ ...info, data: toPgn(info) })
}

export function pgnToPCDIN(info: any) {
  return encodePCDIN({ ...info, data: toPgn(info) })
}

export function pgnToMXPGN(info: any) {
  return encodeMXPGN({ ...info, data: toPgn(info) })
}

export function pgnToCandump1(info: any) {
  return encodeCandump1({ ...info, data: toPgn(info) })
}

export function pgnToCandump2(info: any) {
  return encodeCandump2({ ...info, data: toPgn(info) })
}

export function pgnToCandump3(info: any) {
  return encodeCandump3({ ...info, data: toPgn(info) })
}

export const actisenseToYdgwRawFormat = _.flow(parseActisense, encodeYDRAW)
export const actisenseToYdgwFullRawFormat = _.flow(
  parseActisense,
  encodeYDRAWFull
)
export const actisenseToPCDIN = _.flow(parseActisense, encodePCDIN)
export const actisenseToMXPGN = _.flow(parseActisense, encodeMXPGN)
export const actisenseToiKonvert = _.flow(parseActisense, encodePDGY)
export const actisenseToN2KAsciiFormat = _.flow(
  parseActisense,
  encodeActisenseN2KACSII
)
export const actisenseToN2KActisenseFormat = _.flow(
  parseActisense,
  encodeN2KActisense
)

function bitIsSet(field: Field, index: number, value: any) {
  // A BITLOOKUP value may arrive either as a raw numeric bitmask or as an
  // array (or string) of the set enumeration names.
  if (typeof value === 'number') {
    return Math.floor(value / Math.pow(2, index)) % 2 === 1
  }

  const enumName = getBitEnumerationName(
    field.LookupBitEnumeration as string,
    index
  )

  return enumName ? value.indexOf(enumName) != -1 : false
}

fieldTypeWriters['BITLOOKUP'] = (pgn, field, value, bs) => {
  if (field.BitLength !== undefined) {
    if (value === undefined || value.length === 0) {
      if (field.BitLength % 8 == 0) {
        const bytes = field.BitLength / 8
        //const lastByte = field.Signed ? 0x7f : 0xff
        for (let i = 0; i < bytes - 1; i++) {
          bs.writeUint8(0x0)
        }
        bs.writeUint8(0x0)
      } else {
        bs.writeBits(0xffffffff, field.BitLength)
      }
    } else {
      for (let i = 0; i < field.BitLength; i++) {
        bs.writeBits(bitIsSet(field, i, value) ? 1 : 0, 1)
      }
    }
  }
}

/**
 * The UTF-8 bytes of a string field's value.
 *
 * The writers used to walk the string with `charCodeAt()` and `writeUint8()`,
 * which is wrong three ways: the code unit is truncated mod 256, so U+016B
 * silently became 'k' rather than mojibake; the length byte was derived from
 * `value.length`, which counts UTF-16 code units rather than bytes; and the
 * STRING_FIX padding loop used the same count, producing a field of the wrong
 * width and shifting every field after it.
 *
 * UTF-8 is what canboat's encoder writes, and the only encoding that
 * round-trips through the reader, which takes valid UTF-8 as UTF-8 and falls
 * back to Latin-1 -- Latin-1 output would be re-read as UTF-8 whenever it
 * happened to be well-formed. See canboat/canboat#864.
 */
const stringBytes = (value: string, maxBytes: number): Buffer => {
  const buf = Buffer.from(value, 'utf8')
  if (buf.length <= maxBytes) {
    return buf
  }
  // Too long for the field: shorten it rather than refuse the message. Cut on
  // a character boundary -- a partial sequence is invalid UTF-8, which the
  // reader would quietly reinterpret as Latin-1.
  let end = maxBytes
  while (end > 0 && (buf[end] & 0xc0) === 0x80) {
    end--
  }
  return buf.subarray(0, end)
}

// An IEEE-754 single; not available is all ones (a NaN), as canboat sends it.
fieldTypeWriters['FLOAT'] = (pgn, field, value, bs) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    bs.writeFloat32(value)
  } else {
    bs.writeUint32(0xffffffff)
  }
}

// DECIMAL: two decimal digits per byte, first digits first, as fromPgn
// reads them: "2350763930" is 23 50 76 39 30. A shorter number is padded
// with leading zeros; an unset value is all 0xff (not available).
fieldTypeWriters['DECIMAL'] = (pgn, field, value, bs) => {
  const bits = field.BitLength ?? 0
  const nbytes = Math.floor(bits / 8)
  if (value == null) {
    for (let i = 0; i < nbytes; i++) {
      bs.writeUint8(0xff)
    }
  } else {
    const digits = String(value).trim()
    if (!/^[0-9]+$/.test(digits) || digits.length > nbytes * 2) {
      throw new Error(`Invalid value for ${field.Name}: '${value}'`)
    }
    const padded = digits.padStart(nbytes * 2, '0')
    for (let i = 0; i < nbytes; i++) {
      bs.writeUint8(Number(padded.slice(i * 2, i * 2 + 2)))
    }
  }
  if (bits % 8 > 0) {
    bs.writeBits(0xff, bits % 8)
  }
}

// The AIS PGNs with fixed-width text: 129040 Name, 129794 Callsign, Name
// and Destination, 129809 Name, 129810 Vendor ID and Callsign.
const AIS_TEXT_PGNS = new Set([129040, 129794, 129809, 129810])

fieldTypeWriters['STRING_FIX'] = (pgn, field, value, bs) => {
  if (field.BitLength !== undefined) {
    // AIS pads unused text characters with '@' (6-bit code 0, ITU-R
    // M.1371); MFDs (Raymarine Axiom, Furuno TZT) show 0xff padding in AIS
    // names as junk. Every other fixed string pads with 0xff.
    const fill = AIS_TEXT_PGNS.has(pgn) ? 0x40 : 0xff
    if (value == null) {
      value = ''
    }
    const fieldLen = field.BitLength / 8
    const buf = stringBytes(value, fieldLen)

    for (let i = 0; i < buf.length; i++) {
      bs.writeUint8(buf[i])
    }

    for (let i = 0; i < fieldLen - buf.length; i++) {
      bs.writeUint8(fill)
    }
  }
}

fieldTypeWriters[RES_STRINGLZ] = (pgn, field, value, bs) => {
  if (value == null) {
    value = ''
  }
  // [length][content][0x00], the length byte counting the content only --
  // what every Fusion device sends. A fixed-width field is 0x00-padded to
  // its width, with the content capped so the NUL still fits. canboat's
  // stage_string_lz.
  const width = field.BitLength !== undefined ? field.BitLength / 8 : undefined
  const room = width !== undefined ? Math.max(width - 2, 0) : 0xff
  const buf = stringBytes(value, Math.min(room, 0xff))
  bs.writeUint8(buf.length)
  for (let i = 0; i < buf.length; i++) {
    bs.writeUint8(buf[i])
  }
  bs.writeUint8(0)
  if (width !== undefined) {
    for (let i = buf.length + 2; i < width; i++) {
      bs.writeUint8(0)
    }
  }
}

fieldTypeWriters['String with start/stop byte'] = (pgn, field, value, bs) => {
  if (value == null) {
    value = ''
  }
  const buf = stringBytes(value, 0xff)
  bs.writeUint8(0x02)
  for (let i = 0; i < buf.length; i++) {
    bs.writeUint8(buf[i])
  }
  bs.writeUint8(0x01)
}

fieldTypeWriters[RES_STRINGLAU] = (pgn, field, value, bs) => {
  // The length byte counts itself and the control byte.
  const buf = value ? stringBytes(value, 0xff - 2) : Buffer.alloc(0)

  bs.writeUint8(buf.length + 2)
  bs.writeUint8(1) // 1 = ASCII / UTF-8

  for (let idx = 0; idx < buf.length; idx++) {
    bs.writeUint8(buf[idx])
  }
}

fieldTypeMappers['DATE'] = (field, value) => {
  if (_.isString(value)) {
    const parts = value.split('.')
    const date = new Date(
      Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    )
    return date.getTime() / 86400 / 1000
  }

  return value
}

/**
 * A TIME or DURATION in seconds, as the decoder gives it, read leniently:
 * a number of seconds, also as text ("300", "-1.5"), or a clock
 * "[-]HH:MM", "[-]HH:MM:SS" or "[-]HH:MM:SS.fff", as canboatjs and
 * canboat wrote it before.
 */
fieldTypeMappers['TIME'] = (field, value) => {
  if (!_.isString(value)) {
    return value
  }
  const text = value.trim()
  if (text !== '' && Number.isFinite(Number(text))) {
    return Number(text)
  }
  const negative = text.startsWith('-')
  const parts = (negative ? text.slice(1) : text).split(':')
  if (
    parts.length < 2 ||
    parts.length > 3 ||
    !parts.every((p) => /^\d+(\.\d+)?$/.test(p))
  ) {
    return value
  }
  const [hours, minutes, seconds = 0] = parts.map(Number)
  const total = hours * 3600 + minutes * 60 + seconds
  return negative ? -total : total
}

fieldTypeMappers['DURATION'] = fieldTypeMappers['TIME']

fieldTypeMappers['Pressure'] = (field, value) => {
  if (field.Unit) {
    switch (field.Unit[0]) {
      case 'h':
      case 'H':
        value /= 100
        break
      case 'k':
      case 'K':
        value /= 1000
        break
      case 'd':
        value *= 10
        break
    }
  }
  return value
}
