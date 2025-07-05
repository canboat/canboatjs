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

import { Field, PGN } from '@canboat/ts-pgns'
import { getField } from './fromPgn'
import {
  getPgn,
  getCustomPgn,
  lookupEnumerationValue,
  lookupFieldTypeEnumerationValue,
  lookupBitEnumerationName,
  lookupFieldTypeEnumerationBits
} from './pgns'
import _ from 'lodash'
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
  encodePDGY
} from './stringMsg'
import { encodeN2KActisense } from './n2k-actisense'
import { createDebug } from './utilities'

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
  let RepeatingFields = pgnData.RepeatingFieldSet1Size
    ? pgnData.RepeatingFieldSet1Size
    : 0
  for (let index = 0; index < fields.length - RepeatingFields; index++) {
    const field = fields[index]
    let value =
      data[field.Name] !== undefined ? data[field.Name] : data[field.Id]

    if (!_.isUndefined(field.Match)) {
      //console.log(`matching ${field.Name} ${field.Match} ${value} ${_.isString(value)}`)
      if (_.isString(value)) {
        pgnList = pgnList.filter((f) => f.Fields[index].Description == value)
      } else {
        pgnList = pgnList.filter((f) => f.Fields[index].Match == value)
      }
      if (pgnList.length > 0) {
        //console.log(`matched ${field.Name} ${pgnList[0].Fields[index].Match}`)
        pgnData = pgnList[0]
        value = pgnData.Fields[index].Match
        fields = pgnData.Fields
        RepeatingFields = pgnData.RepeatingFieldSet1Size
          ? pgnData.RepeatingFieldSet1Size
          : 0
      }
    }
    writeField(bs, pgn_number, field, data, value, fields)
  }

  if (data.list) {
    data.list.forEach((repeat: any) => {
      for (let index = 0; index < RepeatingFields; index++) {
        const field = fields[pgnData.Fields.length - RepeatingFields + index]
        const value =
          repeat[field.Name] !== undefined
            ? repeat[field.Name]
            : repeat[field.Id]

        writeField(bs, pgn_number, field, data, value, fields)
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
    !RepeatingFields
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
  bitLength: number | undefined = undefined
) {
  //const startPos = bs.byteIndex

  if (bitLength === undefined) {
    if (field.BitLengthVariable && field.FieldType === 'DYNAMIC_FIELD_VALUE') {
      bitLength = lookupKeyBitLength(data, fields)
    } else {
      bitLength = field.BitLength
    }
  }

  // console.log(`${field.Name}:${value}(${bitLength}-${field.Resolution})`)
  if (value === undefined || value === null) {
    if (field.FieldType && fieldTypeWriters[field.FieldType]) {
      fieldTypeWriters[field.FieldType](pgn_number, field, value, bs)
    } else if (bitLength !== undefined && bitLength % 8 == 0) {
      const bytes = bitLength / 8
      //const byte = field.Name.startsWith('Reserved') ? 0x00 : 0xff
      for (let i = 0; i < bytes - 1; i++) {
        bs.writeUint8(0xff)
      }
      bs.writeUint8(field.Signed ? 0x7f : 0xff)
    } else if (bitLength !== undefined) {
      bs.writeBits(0xffffffff, bitLength)
    } else {
      //FIXME: error! should not happen
    }
  } else {
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

    if (field.FieldType == 'NUMBER' && _.isString(value)) {
      value = Number(value)
    }

    if (field.Resolution && typeof value === 'number') {
      value = Number((value / field.Resolution).toFixed(0))
    }

    if (field.FieldType && fieldTypeWriters[field.FieldType]) {
      fieldTypeWriters[field.FieldType](pgn_number, field, value, bs)
    } else {
      /*
      if ( _.isString(value) && typeof bitLength !== 'undefined' && bitLength !== 0 ) {
        value = Number(value)
        }
        */

      if (field.Unit === 'kWh') {
        value /= 3.6e6 // 1 kWh = 3.6 MJ.
      } else if (field.Unit === 'Ah') {
        value /= 3600.0 // 1 Ah = 3600 C.
      }
      if (field.Offset) {
        value -= field.Offset
      }

      if (field.FieldType === 'VARIABLE') {
        writeVariableLengthField(bs, pgn_number, data, field, value, fields)
      } else if (_.isBuffer(value)) {
        value.copy(bs.view.buffer, bs.byteIndex)
        bs.byteIndex += value.length
      } else if (bitLength !== undefined) {
        if (bitLength === 8) {
          if (field.Signed) {
            bs.writeInt8(value)
          } else {
            bs.writeUint8(value)
          }
        } else if (bitLength === 16) {
          if (field.Signed) {
            bs.writeInt16(value)
          } else {
            bs.writeUint16(value)
          }
        } else if (bitLength === 32) {
          if (field.Signed) {
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
          if (field.Signed) {
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
    res = lookupEnumerationValue(field.LookupEnumeration, stringValue)
  } else {
    res = lookupFieldTypeEnumerationValue(
      field.LookupFieldTypeEnumeration,
      stringValue
    )
  }
  return _.isUndefined(res) ? stringValue : res
}

function lookupKeyBitLength(data: any, fields: Field[]) {
  const field = fields.find((field) => field.Name === 'Key')

  if (field) {
    let val = data['Key'] || data['key']
    if (typeof val === 'string') {
      val = lookupFieldTypeEnumerationValue(
        field.LookupFieldTypeEnumeration,
        val
      )
    }
    return lookupFieldTypeEnumerationBits(field.LookupFieldTypeEnumeration, val)
  }
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

function bitIsSet(field: Field, index: number, value: string) {
  const enumName = lookupBitEnumerationName(
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

fieldTypeWriters['STRING_FIX'] = (pgn, field, value, bs) => {
  if (field.BitLength !== undefined) {
    let fill = 0xff
    if (
      (pgn === 129810 &&
        (field.Name === 'Vendor ID' || field.Name === 'Callsign')) ||
      (pgn === 129809 && field.Name === 'Name')
    ) {
      if (_.isUndefined(value) || value.length == 0) {
        {
          fill = 0x40
          value = ''
        }
      }
    }

    if (value === undefined) {
      value = ''
    }
    const fieldLen = field.BitLength / 8

    for (let i = 0; i < value.length; i++) {
      bs.writeUint8(value.charCodeAt(i))
    }

    for (let i = 0; i < fieldLen - value.length; i++) {
      bs.writeUint8(fill)
    }
  }
}

fieldTypeWriters[RES_STRINGLZ] = (pgn, field, value, bs) => {
  if (_.isUndefined(value)) {
    value = ''
  }
  bs.writeUint8(value.length)
  for (let i = 0; i < value.length; i++) {
    bs.writeUint8(value.charCodeAt(i))
  }
  bs.writeUint8(0)
}

fieldTypeWriters['String with start/stop byte'] = (pgn, field, value, bs) => {
  if (_.isUndefined(value)) {
    value = ''
  }
  bs.writeUint8(0x02)
  for (let i = 0; i < value.length; i++) {
    bs.writeUint8(value.charCodeAt(i))
  }
  bs.writeUint8(0x01)
}

fieldTypeWriters[RES_STRINGLAU] = (pgn, field, value, bs) => {
  if (pgn === 129041 && field.Name === 'AtoN Name') {
    if (value.length > 18) {
      value = value.substring(0, 18)
    } else {
      value = value.padEnd(18, ' ')
    }
  }

  bs.writeUint8(value ? value.length + 2 : 2)
  bs.writeUint8(1)

  if (value) {
    for (let idx = 0; idx < value.length; idx++) {
      bs.writeUint8(value.charCodeAt(idx))
    }
  }
}

fieldTypeMappers['DATE'] = (field, value) => {
  //console.log(`Date: ${value}`)
  if (_.isString(value)) {
    const date = new Date(value)
    return date.getTime() / 86400 / 1000
  }

  return value
}

fieldTypeMappers['TIME'] = (field, value) => {
  if (_.isString(value)) {
    const split = value.split(':')

    const hours = Number(split[0])
    const minutes = Number(split[1])
    const seconds = Number(split[2])

    value = hours * 60 * 60 + minutes * 60 + seconds
  }
  return value
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
