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
  Definition,
  Field,
  PGN,
  getEnumerationValue,
  getIndirectEnumerationValue,
  getFieldTypeEnumerationValue,
  getFieldTypeEnumeration,
  getBitEnumerationName,
  findFallBackPGN
} from '@canboat/ts-pgns'
import { parameterField, targetDefinition } from './fromPgn'
import { getPgn, getCustomPgn, isMatchName } from './pgns'
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
  let pgnList = [
    ...(customPgns?.definitions ?? []),
    ...(getPgn(data.pgn) ?? [])
  ]

  // A message that names its variant, as a decoded one does, is written
  // with that variant, as canboat does with a JSON message's id: even the
  // range's catch-all, which a message no variant describes decodes with,
  // also for a PGN that has no definition of its own.
  const fallback = findFallBackPGN(data.pgn)
  const named =
    typeof data.id === 'string'
      ? (pgnList.find((pgn) => pgn.Id === data.id) ??
        (fallback?.Id === data.id ? fallback : undefined))
      : undefined

  if (pgnList.length === 0 && !named) {
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
  // canboat's --nv form gives a value as {value, name}: read it as the
  // value it holds (#574). A copy, so the caller's message is left as it is.
  data = fromNvForm(data)

  // Pick the definition before writing anything: each definition names its
  // fields its own way (129808's distress and general calls), so a value
  // can only be read once it is known which definition it belongs to.
  // A custom definition comes before the built-in ones, so it overrides
  // them.
  const custom = new Set<unknown>(customPgns?.definitions)
  const selected =
    named ??
    selectDefinition(
      pgnList.filter((pgn) => custom.has(pgn)),
      data
    ) ??
    selectDefinition(
      pgnList.filter((pgn) => !custom.has(pgn)),
      data
    )
  if (selected) {
    pgnList = [selected]
    pgnData = selected
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
            (f.Fields[index].Match === undefined ||
              isMatchName(f.Fields[index], value)) &&
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
    // A catch-all's data runs to the end of the message, and so does a
    // BINARY that ends a multi-frame message outside any repeating set: the
    // decoder reads the bytes that are there, so they are written as given,
    // not padded to the field's width, and left out when not given, as
    // canboat does (canboat#1133). One byte ("10") is a byte too, and none
    // is nothing.
    const tail = openTail(pgnData, field)
    const bytes =
      (pgnData.Fallback === true || tail) && field.FieldType === 'BINARY'
        ? hexBytes(value)
        : undefined
    if (bytes !== undefined) {
      if (tail && bytes.length * 8 > field.BitLength!) {
        throw new Error(
          `field '${field.Name}': ${bytes.length} bytes do not fit in ${field.BitLength} bits`
        )
      }
      writeField(bs, pgn_number, field, data, bytes, fields, bytes.length * 8)
    } else if (tail && (value === undefined || value === null)) {
      // Not given: nothing to write.
    } else {
      writeField(bs, pgn_number, field, data, value, fields)
    }
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
    pgnData.Fallback !== true &&
    fields[fields.length - 1].FieldType !== RES_STRINGLAU &&
    fields[fields.length - 1].FieldType !== RES_STRINGLZ &&
    !openTail(pgnData, fields[fields.length - 1]) &&
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

/**
 * The first definition whose every Match field the data gives, under that
 * definition's own field name or id, as the matched value or its name. One
 * with Match fields goes before one without, which any data fits: canboat
 * lists such a catch-all variant last, a custom PGN may not.
 */
function selectDefinition<T extends { Fields: Field[] }>(
  pgnList: T[],
  data: any
): T | undefined {
  const hasMatch = (pgn: T) =>
    pgn.Fields.some((field) => field.Match !== undefined)
  const fits = (pgn: T) =>
    pgn.Fields.every((field) => {
      if (field.Match === undefined) {
        return true
      }
      const value =
        data[field.Name] !== undefined ? data[field.Name] : data[field.Id]
      return _.isString(value)
        ? isMatchName(field, value)
        : value !== undefined && field.Match == value
    })
  return pgnList.find((pgn) => hasMatch(pgn) && fits(pgn)) ?? pgnList.find(fits)
}

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
      // A value the record leaves out stays out, whatever its length says.
      bitLength =
        (value != null
          ? dynamicLengthBitLength(record, fields, field)
          : undefined) ?? lookupKeyBitLength(record, fields)
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
    if (field.FieldType === 'SPARE' && bitLength !== undefined) {
      // A spare field is zero, as canboat's encoder writes it; every other
      // field without a value is not available, all ones.
      writeZeros(bs, bitLength)
    } else if (field.FieldType && fieldTypeWriters[field.FieldType]) {
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
      // A value without a DYNAMIC_FIELD_KEY is bytes, as the decoder gives
      // them ("10" is the byte 0x10, not ten).
      const keyless = !fields.some((f) => f.FieldType === 'DYNAMIC_FIELD_KEY')
      const bytes = keyless ? hexBytes(value) : undefined
      if (bytes !== undefined) {
        value = bytes
      } else if (_.isString(value)) {
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
    if (field.FieldType === 'INDIRECT_LOOKUP' && _.isString(value)) {
      value = indirectLookupValue(field, fields, record, data, value)
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
    const given = value
    if (typeof value === 'number') {
      const si = siConversion(field.Unit, (field as any).PhysicalQuantity)
      if (si !== undefined) {
        value = (value * si.div) / si.mul
      }
      if (field.FieldType === 'NUMBER') {
        value = fullTurnAngle(field, value)
      }
      // canboat's Offset is in the field's own units, so remove it before
      // scaling to the raw value.
      if (field.Offset) {
        value -= field.Offset
      }
    }

    if (field.Resolution && typeof value === 'number') {
      // A FLOAT carries its fraction on the wire: no rounding to a count.
      // A 64-bit count is worked out in decimal, as a number divided by
      // 1e-16 is not exact (129029's longitude, #571).
      const exact =
        field.FieldType !== 'FLOAT' && bitLength === 64
          ? decimalCount(value, field.Resolution)
          : undefined
      value =
        exact ??
        (field.FieldType === 'FLOAT'
          ? value / field.Resolution
          : Number((value / field.Resolution).toFixed(0)))
    }

    if (field.FieldType === 'NUMBER' && typeof value === 'number') {
      checkRange(field, given, value)
    } else if (
      field.FieldType === 'NUMBER' &&
      typeof value === 'string' &&
      typeof given === 'number'
    ) {
      // A 64-bit count worked out in decimal (decimalCount) is checked as
      // a number, as close as the range is; its digits are what is written.
      checkRange(field, given, Number(value))
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
        writeVariableLengthField(
          bs,
          pgn_number,
          data,
          field,
          value,
          fields,
          record
        )
      } else if (_.isBuffer(value)) {
        value.copy(bs.view.buffer, bs.byteIndex)
        bs.byteIndex += value.length
      } else if (
        field.FieldType === 'BINARY' &&
        _.isString(value) &&
        bitLength !== undefined &&
        (bitLength > 64 || isHexBytes(value))
      ) {
        writeBinary(bs, field, value, bitLength)
      } else if (
        (field.FieldType === 'RESERVED' || field.FieldType === 'SPARE') &&
        bitLength !== undefined &&
        hexBytes(value) !== undefined
      ) {
        // As the decoder gives it, and canboat prints it: its bytes (#572).
        // A number is still read as the field's bits.
        writeBinary(bs, field, value, bitLength)
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
            if (value >= 0) {
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
        } else if (bitLength > 32) {
          // bit-buffer keeps 32 bits of a value it shifts: write a 40- or
          // 56-bit value as its low 32 bits, then the rest. A negative one
          // is its two's complement.
          const raw = value < 0 ? value + 2 ** bitLength : value
          const high = Math.floor(raw / 2 ** 32)
          bs.writeUint32(raw - high * 2 ** 32)
          bs.writeBits(high, bitLength - 32)
        } else {
          bs.writeBits(value, bitLength)
        }
      }
    }
  }
  //dumpWritten(bs, field, startPos, value)
}

/**
 * An angle field that covers a full turn (0 to 2 pi rad, 0 to 360 deg)
 * takes a negative angle down to minus half a turn as the same direction:
 * -0.5 rad is 2 pi - 0.5. Signal K gives a port angle as -pi..0. `value`
 * is in the field's unit. As canboat's full_turn_angle.
 */
function fullTurnAngle(field: Field, value: number) {
  if (
    (field as any).PhysicalQuantity !== 'ANGLE' ||
    field.RangeMin !== 0 ||
    value >= 0
  ) {
    return value
  }
  const full =
    field.Unit === 'rad' ? 2 * Math.PI : field.Unit === 'deg' ? 360 : undefined
  // The top of the range is a step or a rounding short of the full turn:
  // 359 for a field in whole degrees.
  const step = Number(field.Resolution ?? 1)
  if (
    full !== undefined &&
    field.RangeMax !== undefined &&
    field.RangeMax >= Math.min(full * 0.999, full - step) &&
    value >= -full / 2
  ) {
    return value + full
  }
  return value
}

const warnedNotAvailable = new Set<string>()

/**
 * Warn, once per field, that a not-available value was given as a number
 * where it should be left out or given as null.
 */
function warnNotAvailableValue(field: Field, given: number) {
  if (warnedNotAvailable.has(field.Name)) {
    return
  }
  warnedNotAvailable.add(field.Name)
  process.emitWarning(
    `canboatjs: field '${field.Name}' was given ${given}, its not-available ` +
      'value. Leave the field out or give null instead: the next major ' +
      'release refuses it as out of range.',
    'DeprecationWarning'
  )
}

/**
 * Refuse a NUMBER whose raw value is outside the field's range: written
 * anyway it would wrap at the field width, or land on a not-available or
 * reserved value, and decode as some other value (#524). Raw is compared
 * with raw, so a value within half a step of an end still rounds onto it.
 * As canboat's encoder (canboat/canboat#975), with one exception: the
 * field's not-available value itself (SID 0xff, as Signal K's conversions
 * send it) is written as given, with a deprecation warning; the next
 * major release refuses it, as canboat does. A field without a range, as
 * a custom PGN may have, is held to what its bits can carry.
 */
function checkRange(field: Field, given: number, raw: number) {
  if (raw === (field as any).UnknownValue) {
    warnNotAvailableValue(field, given)
    return
  }
  const offset = field.Offset ? Number(field.Offset) : 0
  const resolution = field.Resolution ? Number(field.Resolution) : 1
  const rawOf = (v: number) => Number(((v - offset) / resolution).toFixed(0))
  // An Excess-K field (Signed with an Offset) holds an unsigned raw value.
  const bits = field.BitLength
  const signed = !!field.Signed && !field.Offset
  // What the bits can carry bounds a declared range too: a custom PGN may
  // declare a range wider than its field.
  const bitsMin =
    bits === undefined ? -Infinity : signed ? -(2 ** (bits - 1)) : 0
  const bitsMax =
    bits === undefined ? Infinity : signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1
  const declaredMin =
    field.RangeMin !== undefined ? rawOf(field.RangeMin) : -Infinity
  const declaredMax =
    field.RangeMax !== undefined ? rawOf(field.RangeMax) : Infinity
  const minRaw = Math.max(declaredMin, bitsMin)
  const maxRaw = Math.min(declaredMax, bitsMax)
  // 2^56 - 1 rounds to 2^56 as a Number, so test the bits' bound as the
  // power of two above it.
  const bitsLimit =
    bits === undefined ? Infinity : signed ? 2 ** (bits - 1) : 2 ** bits
  if (
    !Number.isFinite(raw) ||
    raw < minRaw ||
    raw > maxRaw ||
    raw >= bitsLimit
  ) {
    // The range in SI, the unit the value was given in.
    const si = siConversion(field.Unit, (field as any).PhysicalQuantity)
    const toSI = (v: number) => (si ? (v * si.mul) / si.div : v)
    const min = toSI(
      minRaw === declaredMin ? field.RangeMin! : minRaw * resolution + offset
    )
    const max = toSI(
      maxRaw === declaredMax ? field.RangeMax! : maxRaw * resolution + offset
    )
    throw new Error(
      `field '${field.Name}': value ${given} is outside its range ${min} to ${max}`
    )
  }
}

function writeVariableLengthField(
  bs: BitStream,
  pgn_number: number,
  pgn: any,
  field: Field,
  value: any,
  fields: Field[],
  record: any
) {
  // The definition the parameters address, as canboat and the decoder
  // resolve it: the variant they select, else the range's catch-all.
  const target = pgn.pgn ?? pgn.PGN
  const def = targetDefinition(target, pgn)
  const refField = def
    ? parameterField(def, bs.view.buffer[bs.byteIndex - 1])
    : null

  if (refField) {
    // As canboat's encoder: a key/value field's value is bytes, not a
    // number. It used to go out silently wrong (#458), typically because
    // the target PGN has several variants and the pairs did not pick the
    // intended one.
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

    // A BINARY, RESERVED or SPARE value given as hex text, as the decoder
    // gives it ("00 05 64"), is those bytes (canboat#1131).
    const bytes = ['BINARY', 'RESERVED', 'SPARE'].includes(
      refField.FieldType ?? ''
    )
      ? hexBytes(value)
      : undefined

    // A BINARY that ends the target's definition, such as the catch-all's
    // Data, which parameters no variant agrees with address, takes the rest
    // of the message: as the last parameter it is written as long as given,
    // as canboat reads it; before another, it cannot be read back.
    const endsTarget =
      refField.FieldType === 'BINARY' &&
      def!.Fields[def!.Fields.length - 1] === refField
    const list = pgn.list
    const last = !Array.isArray(list) || record === list[list.length - 1]
    if (endsTarget && last && bytes !== undefined) {
      return writeField(
        bs,
        pgn_number,
        refField,
        pgn,
        bytes,
        fields,
        bytes.length * 8
      )
    }
    if (endsTarget && !last && def === findFallBackPGN(target)) {
      throw new Error(
        `Parameter ${(refField as any).Order} of PGN ${target} is the catch-all's data, ` +
          'which takes the rest of the message, so it must be the last parameter'
      )
    }
    if (refField.BitLength !== undefined) {
      bits = (refField.BitLength + 7) & ~7 // Round # of bits in field refField up to complete bytes: 1->8, 7->8, 8->8 etc.
    }

    if (bytes !== undefined && bits !== undefined) {
      // Padded with zeros to the field's width, as canboat does.
      const padded = Buffer.alloc(bits / 8)
      if (bytes.length > padded.length) {
        throw new Error(
          `Parameter ${(refField as any).Order} of PGN ${target}: ${bytes.length} bytes do not fit its ${padded.length}`
        )
      }
      bytes.copy(padded)
      return writeField(bs, pgn_number, refField, pgn, padded, fields, bits)
    }

    return writeField(bs, pgn_number, refField, pgn, value, fields, bits)
  }
}

/**
 * An INDIRECT_LOOKUP name's code, under the value of the field it is named
 * by (60928's device function under its device class), which the record
 * gives as a number or as its own lookup name. In a repeating set the key
 * may be in the same record or in the message. A code given as text is
 * read as the code; a name that does not resolve throws.
 */
function indirectLookupValue(
  field: Field,
  fields: Field[],
  record: any,
  data: any,
  name: string
) {
  // A code given as text is the code, if it fits the field: one that does
  // not would be written as some other code.
  if (name.trim() !== '' && !Number.isNaN(Number(name))) {
    const code = Number(name)
    const max =
      field.BitLength !== undefined ? 2 ** field.BitLength - 1 : Infinity
    if (!Number.isInteger(code) || code < 0 || code > max) {
      throw new Error(
        `field '${field.Name}': ${name} is not a code of its ${field.BitLength} bits`
      )
    }
    return code
  }
  const keyField = fields.find(
    (f) => f.Order === field.LookupIndirectEnumerationFieldOrder
  )
  let key =
    keyField === undefined
      ? undefined
      : (record[keyField.Name] ??
        record[keyField.Id] ??
        data[keyField.Name] ??
        data[keyField.Id])
  if (keyField !== undefined && _.isString(key)) {
    key = lookup(keyField, key)
  }
  const code =
    typeof key === 'number' && field.LookupIndirectEnumeration !== undefined
      ? getIndirectEnumerationValue(field.LookupIndirectEnumeration, key, name)
      : undefined
  if (code === undefined) {
    // Written as it is, a name would become whatever bits the writer makes
    // of text. canboat's encoder refuses an unknown name too.
    throw new Error(
      `field '${field.Name}': '${name}' is not a name of ${field.LookupIndirectEnumeration}` +
        (keyField !== undefined
          ? ` under ${keyField.Name} ${JSON.stringify(key)}`
          : '')
    )
  }
  return code
}

/**
 * A message's fields with canboat's --nv form (`canboat convert --nv`,
 * `analyzer -nv`) read as canboatjs gives them, in the message and in its
 * repeating sets (#574):
 * - `{"value": 2, "name": "Apparent"}`, a lookup, an indirect lookup, a
 *   PGN, a dynamic key or a number, often with `"key": true`: its value,
 *   the code or number canboatjs writes;
 * - a date, `{"value": 20612, "name": "2026.06.08"}`: its name, the form
 *   canboatjs gives a date in;
 * - a bit lookup, a list of `{"value": mask, "name": ...}`: the list of
 *   its bits by name, or by mask where the lookup has no name, as in
 *   canboat's plain form.
 * Anything else is left as it is.
 */
function fromNvForm(fields: any): any {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    return fields
  }
  const out: any = {}
  for (const [key, value] of Object.entries(fields)) {
    if ((key === 'list' || key === 'list2') && Array.isArray(value)) {
      out[key] = value.map((record) => fromNvForm(record))
    } else {
      out[key] = fromNvValue(value)
    }
  }
  return out
}

const NV_DATE = /^\d{4}\.\d{2}\.\d{2}$/

/** One field's value in canboat's --nv form, as canboatjs gives it. */
function fromNvValue(value: any): any {
  if (Array.isArray(value)) {
    // A bit lookup's set bits, each with its mask.
    if (
      value.length > 0 &&
      value.every(
        (bit) =>
          bit !== null &&
          typeof bit === 'object' &&
          typeof bit.value === 'number'
      )
    ) {
      // As in canboat's plain form, which toPgn writes: each bit by its
      // name, or by its mask when the lookup does not name it. A list,
      // not the masks OR-ed together, which would lose the bits of a
      // field wider than 32 (130820 Fusion System Capabilities).
      return value.map((bit) => bit.name ?? bit.value)
    }
    return value
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    _.isBuffer(value) ||
    !('value' in value)
  ) {
    return value
  }
  if (typeof value.name === 'string' && NV_DATE.test(value.name)) {
    return value.name
  }
  return value.value
}

/**
 * The count a 64-bit field holds for `value` at `resolution`, worked out in
 * decimal from the digits of `value` (the shortest that read back as it),
 * for a resolution that is a power of ten: a number divided by 1e-16 is
 * not exact. The digits, for Int64LE and Uint64LE to read, or undefined
 * when the division as numbers is the better answer.
 */
function decimalCount(value: number, resolution: number): string | undefined {
  const places = -Math.log10(resolution)
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(Math.round(places * 1e9) / 1e9)
  ) {
    return undefined
  }
  const decimals = Math.round(places)
  if (decimals < 0) {
    return undefined
  }
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(value))
  if (!m) {
    return undefined
  }
  const [, sign, int, frac = '', exp = '0'] = m
  // Only a value whose digits say what it is: up to 15 significant digits
  // (the decoder rounds a 1e-16 longitude to 7 decimals). One with more
  // digits than a number holds is not that decimal; its binary value,
  // divided as a number, is the best there is (129029's altitude).
  if ((int + frac).replace(/^0+/, '').length > 15) {
    return undefined
  }
  // value = sign int.frac * 10^exp; count = value * 10^decimals
  const shift = decimals + Number(exp) - frac.length
  let count = BigInt(int + frac)
  if (shift >= 0) {
    count *= 10n ** BigInt(shift)
  } else {
    const div = 10n ** BigInt(-shift)
    count = (count + div / 2n) / div
  }
  return (sign === '-' && count !== 0n ? '-' : '') + count.toString()
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

/**
 * A DYNAMIC_FIELD_VALUE's width from the record's DYNAMIC_FIELD_LENGTH, less
 * the bytes that count lies about (DynamicFieldLengthOverhead: Navico's class
 * byte and data type). As the decoder and canboat do, it wins over the
 * width the key's entry gives.
 */
function dynamicLengthBitLength(data: any, fields: Field[], value: Field) {
  // The DYNAMIC_FIELD_LENGTH nearest before the value, as the decoder pairs
  // them, should a definition have several.
  const before = fields.slice(0, Math.max(fields.indexOf(value), 0)).reverse()
  const field = before.find((f) => f.FieldType === 'DYNAMIC_FIELD_LENGTH') as
    | (Field & {
        DynamicFieldLengthOverhead?: number
        UnknownValue?: number
        OutOfRangeValue?: number
        ReservedValue?: number
      })
    | undefined
  if (field === undefined) {
    return undefined
  }
  const length = data[field.Name] ?? data[field.Id]
  if (
    typeof length !== 'number' ||
    length === field.UnknownValue ||
    length === field.OutOfRangeValue ||
    length === field.ReservedValue
  ) {
    return undefined
  }
  const bytes = length - (field.DynamicFieldLengthOverhead ?? 0)
  return bytes > 0 ? bytes * 8 : undefined
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
function dynamicStringValue(
  record: any,
  value: string
): number | string | Buffer {
  const text = value.trim()
  // A whole number past what a number holds exactly (a 64-bit value, which
  // the decoder gives as its digits) stays its digits: the 64-bit writer
  // takes them exactly (130822's value, #571).
  if (/^-?\d+$/.test(text) && !Number.isSafeInteger(Number(text))) {
    return text
  }
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

/**
 * `info` as $MXPGN: one string for a single-frame message, an array of
 * strings, one sentence each, for a fast-packet one (see encodeMXPGN).
 */
export function pgnToMXPGN(info: any, options?: any) {
  return encodeMXPGN({ ...info, data: toPgn(info) }, options)
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
/** An Actisense line as $MXPGN: a string, or an array of strings (see pgnToMXPGN). */
export const actisenseToMXPGN = (input: string, options?: any) =>
  encodeMXPGN(parseActisense(input), options)
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
  // array (or string) of the set enumeration names, and the values of set
  // bits without a name.
  if (typeof value === 'number') {
    return Math.floor(value / Math.pow(2, index)) % 2 === 1
  }

  const enumName = getBitEnumerationName(
    field.LookupBitEnumeration as string,
    index
  )

  // A bit without a name is given as its value, as the decoder gives it.
  return (
    (enumName !== undefined && value.indexOf(enumName) != -1) ||
    (Array.isArray(value) && value.indexOf(2 ** index) != -1)
  )
}

/**
 * Bytes as the decoder gives a BINARY field wider than 64 bits: two or more
 * hex pairs, "02 08". A narrower one it gives as a number, which callers
 * also pass as a decimal string ("33188"), so a lone "10" is not hex.
 */
/**
 * Whether `field` is a BINARY that ends a multi-frame message, outside any
 * repeating set: the decoder reads only the bytes that are there. A single
 * frame keeps its 8 bytes.
 */
function openTail(def: Definition, field: Field) {
  return (
    def.Type !== 'Single' &&
    field.FieldType === 'BINARY' &&
    field.BitLength !== undefined &&
    def.Fields[def.Fields.length - 1] === field &&
    !def.RepeatingFieldSet1Size
  )
}

/** Hex bytes as the decoder gives a BINARY field ("10 20", "10", ""). */
function hexBytes(value: unknown): Buffer | undefined {
  if (
    !_.isString(value) ||
    !/^([0-9a-fA-F]{2}([\s:]+[0-9a-fA-F]{2})*)?$/.test(value.trim())
  ) {
    return undefined
  }
  return Buffer.from(value.replace(/[\s:]/g, ''), 'hex')
}

const isHexBytes = (value: string) =>
  /^[0-9a-fA-F]{2}([\s:]+[0-9a-fA-F]{2})+$/.test(value.trim())

/**
 * A BINARY field given as hex bytes ("02 08"), as the decoder gives it:
 * written as given and padded with zeros to the field's width, as canboat's
 * encoder does. Bit by bit, so a field that is not byte-aligned (the 19-bit
 * AIS communication state) takes its bits too; a bit set past its width is
 * refused rather than dropped.
 */
function writeBinary(
  bs: BitStream,
  field: Field,
  value: string,
  bitLength: number
) {
  const hex = value.replace(/[\s:]/g, '')
  if (!/^([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new Error(`field '${field.Name}': '${value}' is not hex bytes`)
  }
  const bytes = Buffer.from(hex, 'hex')
  if (bytes.length > Math.ceil(bitLength / 8)) {
    throw new Error(
      `field '${field.Name}': ${bytes.length} bytes do not fit in ${bitLength} bits`
    )
  }
  const spare = bitLength % 8
  if (
    spare !== 0 &&
    bytes.length === Math.ceil(bitLength / 8) &&
    bytes[bytes.length - 1] >> spare !== 0
  ) {
    throw new Error(
      `field '${field.Name}': '${value}' has bits set past its ${bitLength} bits`
    )
  }
  for (let left = bitLength, i = 0; left > 0; left -= 8, i++) {
    bs.writeBits(bytes[i] ?? 0, Math.min(left, 8))
  }
}

/** Write `bits` zero bits, in pieces of at most 32. */
function writeZeros(bs: BitStream, bits: number) {
  for (let left = bits; left > 0; left -= 32) {
    bs.writeBits(0, Math.min(left, 32))
  }
}

fieldTypeWriters['BITLOOKUP'] = (pgn, field, value, bs) => {
  if (field.BitLength !== undefined) {
    if (Array.isArray(value) && value.length === 0) {
      // No bit set.
      writeZeros(bs, field.BitLength)
    } else if (value === undefined || value.length === 0) {
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
// reads them: "2350763930" is 23 50 76 39 30. Digits are written from the
// start and a shorter value is filled out with 0s at the end, so a 9-digit
// MMSI "235076393" goes out as 2350763930, the 0 a DSC call adds after it
// (ITU-R M.585). A number has lost its leading zeros (a group or coast
// station MMSI starts with 0 or 00), so it is first zero-filled to 9 digits.
// An unset value is all 0xff (not available).
fieldTypeWriters['DECIMAL'] = (pgn, field, value, bs) => {
  const bits = field.BitLength ?? 0
  const nbytes = Math.floor(bits / 8)
  if (value == null) {
    for (let i = 0; i < nbytes; i++) {
      bs.writeUint8(0xff)
    }
  } else {
    let digits = String(value).trim()
    if (!/^[0-9]+$/.test(digits) || digits.length > nbytes * 2) {
      throw new Error(`Invalid value for ${field.Name}: '${value}'`)
    }
    if (typeof value === 'number' && digits.length < nbytes * 2) {
      digits = digits.padStart(nbytes * 2 - 1, '0')
    }
    const padded = digits.padEnd(nbytes * 2, '0')
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
  // A variable-width string not given is its length byte alone, 0, as
  // canboat writes it and as the decoder reads an empty one back (130847,
  // #571); a given empty string keeps its NUL.
  if (value == null && field.BitLength === undefined) {
    bs.writeUint8(0)
    return
  }
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
