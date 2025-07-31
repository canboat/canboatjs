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
  FieldType,
  createPGN,
  getPGNWithId,
  Type,
  getEnumerationName,
  getBitEnumerationName,
  getFieldTypeEnumerationName,
  getFieldTypeEnumerationValue,
  getFieldTypeEnumerationBits
} from '@canboat/ts-pgns'
import { createDebug, byteString } from './utilities'
import { EventEmitter } from 'events'
import pkg from '../package.json'
import _ from 'lodash'
import { getPgn, getCustomPgn, addCustomPgns } from './pgns'
import { BitStream, BitView } from 'bit-buffer'
import { Int64LE, Uint64LE } from 'int64-buffer'
import { encodeCandump2 } from './stringMsg'

import {
  parseN2kString,
  parseYDRAW,
  isN2KOver0183,
  parsePDGY,
  parseActisenseN2KASCII
} from './stringMsg'

const debug = createDebug('canboatjs:fromPgn')
const trace = createDebug('canboatjs:fromPgn:trace')

export type FromPgnCallback = (msg: any, pgn: any | undefined) => void
export type PostProcessor = (field: Field, value: any) => any
type FieldTypeReader = (pgn: PGN, field: Field, bs: BitStream) => any

const fieldTypeReaders: {
  [key: string]: FieldTypeReader
} = {}

const fieldTypePostProcessors: {
  [key: string]: PostProcessor
} = {}

const FORMAT_PLAIN = 0
const FORMAT_COALESCED = 1
const RES_BINARY = 'Binary data'

const FASTPACKET_INDEX = 0
const FASTPACKET_SIZE = 1
const FASTPACKET_BUCKET_0_SIZE = 6
const FASTPACKET_BUCKET_N_SIZE = 7
const FASTPACKET_BUCKET_0_OFFSET = 2
const FASTPACKET_BUCKET_N_OFFSET = 1
const FASTPACKET_MAX_INDEX = 0x1f

export class Parser extends EventEmitter {
  options: any
  name: string
  version: string
  author: string
  license: string
  format: number
  devices: { [key: number]: { [key: number]: any } }
  mixedFormat: boolean

  constructor(opts: any = {}) {
    super()
    this.options = opts === undefined ? {} : opts

    if (this.options.returnNulls === undefined) {
      this.options.returnNulls = false
    }

    if (this.options.useCamel === undefined) {
      this.options.useCamel = true
    }

    if (this.options.useCamelCompat === undefined) {
      this.options.useCamelCompat = false
    }

    if (this.options.returnNonMatches === undefined) {
      this.options.returnNonMatches = false
    }

    if (this.options.createPGNObjects === undefined) {
      this.options.createPGNObjects = false
    }

    if (this.options.includeInputData === undefined) {
      this.options.includeInputData = false
    }

    this.name = pkg.name
    this.version = pkg.version
    this.author = pkg.author
    this.license = pkg.license
    this.format = this.options.format === undefined ? -1 : this.options.format
    this.devices = {}
    this.mixedFormat = this.options.mixedFormat || false

    if (this.options.onPropertyValues) {
      this.options.onPropertyValues('canboat-custom-pgns', (values: any[]) => {
        values
          .filter((v) => v != null)
          .forEach((pv) => {
            addCustomPgns(pv.value, pv.setter)
          })
      })
    }
  }

  _parse(
    pgn: PGN,
    bs: BitStream,
    len: number,
    coalesced: boolean,
    cb: FromPgnCallback | undefined,
    sourceString: string | undefined = undefined
  ) {
    if (pgn.src === undefined) {
      throw new Error('invalid pgn, missing src')
    }

    const customPgns = getCustomPgn(pgn.pgn)
    let pgnList = getPgn(pgn.pgn)

    if (!pgnList && !customPgns) {
      this.emit(
        'warning',
        pgn,
        `no conversion found for pgn ${JSON.stringify(pgn)}`
      )
      return undefined
    }

    if (customPgns) {
      pgnList = [...customPgns.definitions, ...(pgnList || [])]
    }

    if (!pgnList || pgnList.length === 0) {
      this.emit(
        'warning',
        pgn,
        `no conversion found for pgn ${JSON.stringify(pgn)}`
      )
      return undefined
    }

    if (pgnList === undefined) {
      return
    }

    if (pgn.pgn === 59392) {
      pgnList = pgnList.filter(
        (pgn: any) => pgn.Fallback === undefined || pgn.Fallback === false
      )
    }

    let pgnData: Definition | undefined
    const origPGNList = pgnList

    if (pgnList.length > 1) {
      pgnData = this.findMatchPgn(pgnList)

      if (pgnData === null) {
        pgnData = pgnList[0]
      }
    } else {
      pgnData = pgnList[0]
    }

    if (pgnData === undefined) {
      return
    }

    let couldBeMulti = false

    if (pgnList.length > 0 && len == 8) {
      pgnList.forEach((pgnD) => {
        if (pgnD.Length && pgnD.Length > 8) {
          couldBeMulti = true
        }
      })
    }

    trace(`${pgn.pgn} ${len} ${pgnData.Length} ${couldBeMulti}`)
    if (
      coalesced ||
      len > 0x8 ||
      (this.format == FORMAT_COALESCED && !this.mixedFormat)
    ) {
      this.format = FORMAT_COALESCED
      if (sourceString && this.options.includeInputData) {
        pgn.input = [sourceString]
      }
      //} else if ( pgnData.Length > 0x8 || (len == 0x8 && (pgnData.RepeatingFields || couldBeMulti))) {
    } else if (pgnData.Type === 'Fast') {
      //partial packet
      this.format = FORMAT_PLAIN

      if (this.devices[pgn.src] === undefined) {
        this.devices[pgn.src] = {}
      }
      let packet = this.devices[pgn.src][pgn.pgn]

      if (!packet) {
        packet = { bufferSize: 0, lastPacket: 0, src: [] }
        this.devices[pgn.src][pgn.pgn] = packet
      }
      if (sourceString) {
        packet.src.push(sourceString)
      }

      const start = bs.byteIndex
      const packetIndex = bs.view.buffer.readUInt8(FASTPACKET_INDEX)
      const bucket = packetIndex & FASTPACKET_MAX_INDEX

      trace(`${pgn.pgn} partial ${packetIndex} ${bucket} ${packet.size}`)

      if (bucket == 0) {
        packet.size = bs.view.buffer.readUInt8(FASTPACKET_SIZE)
        const newSize = packet.size + FASTPACKET_BUCKET_N_SIZE
        if (newSize > packet.bufferSize) {
          const newBuf = Buffer.alloc(newSize)
          packet.bufferSize = newSize
          if (packet.buffer) {
            packet.buffer.copy(newBuf)
          }
          packet.buffer = newBuf
        }
        bs.view.buffer.copy(packet.buffer, 0, FASTPACKET_BUCKET_0_OFFSET, 8)
        trace(
          `${pgn.pgn} targetStart: 0 sourceStart: ${FASTPACKET_BUCKET_0_OFFSET}`
        )
      } else if (!packet.buffer) {
        //we got a non-zero bucket, but we never got the zero bucket
        debug(
          `PGN ${pgn.pgn} malformed packet for ${pgn.src} received; got a non-zero bucket first`
        )
        cb && cb(`Could not parse ${JSON.stringify(pgn)}`, undefined)
        bs.byteIndex = start
        delete this.devices[pgn.src][pgn.pgn]
        return
      } else {
        if (packet.lastPacket + 1 != packetIndex) {
          debug(
            `PGN ${pgn.pgn} malformed packet for ${pgn.src} received; expected ${packet.lastPacket + 1} but got ${packetIndex}`
          )
          cb && cb(`Could not parse ${JSON.stringify(pgn)}`, undefined)
          bs.byteIndex = start
          delete this.devices[pgn.src][pgn.pgn]
          return
        } else {
          trace(
            `${pgn.pgn} targetStart: ${FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * (bucket - 1)} sourceStart: ${FASTPACKET_BUCKET_N_OFFSET} sourceEned: ${FASTPACKET_BUCKET_N_SIZE}`
          )
          bs.view.buffer.copy(
            packet.buffer,
            FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * (bucket - 1),
            FASTPACKET_BUCKET_N_OFFSET,
            8
          )
        }
      }
      packet.lastPacket = packetIndex
      if (
        FASTPACKET_BUCKET_0_SIZE + FASTPACKET_BUCKET_N_SIZE * bucket <
        packet.size
      ) {
        // Packet is not complete yet
        trace(`${pgn.pgn} not complete`)
        return
      }
      const view = new BitView(packet.buffer)
      bs = new BitStream(view)
      trace(`${pgn.pgn} done`)
      if (this.options.includeInputData) {
        pgn.input = packet.src
      }
      delete this.devices[pgn.src][pgn.pgn]
    } else if (sourceString && this.options.includeInputData) {
      pgn.input = [sourceString]
    }

    let RepeatingFields = pgnData.RepeatingFieldSet1Size
      ? pgnData.RepeatingFieldSet1Size
      : 0

    pgn.fields = {}

    try {
      let fields = pgnData.Fields

      const continueReading = true
      let unknownPGN = false
      for (
        let i = 0;
        i < fields.length - RepeatingFields && continueReading;
        i++
      ) {
        const field = fields[i]
        const hasMatch = field.Match !== undefined

        let [value] = readField(
          pgnData!,
          this.options,
          !hasMatch,
          pgn,
          field,
          bs,
          fields
        )

        if (hasMatch) {
          //console.log(`looking for ${field.Name} == ${value}`)
          //console.log(JSON.stringify(pgnList, null, 2))
          pgnList = pgnList.filter((f) => f.Fields[i].Match == value)
          if (pgnList.length == 0) {
            if (this.options.returnNonMatches) {
              //this.emit('warning', pgn, `no conversion found for pgn`)
              trace('warning no conversion found for pgn %j', pgn)
              //continueReading = false

              const nonMatch = this.findNonMatchPgn(origPGNList)
              if (nonMatch) {
                pgnList = [nonMatch]
                pgnData = pgnList[0]
                fields = pgnData.Fields

                const data = bs.readArrayBuffer(Math.floor(bs.bitsLeft / 8))
                if (data.length > 0) {
                  ;(pgn.fields as any).data = byteString(Buffer.from(data), ' ')
                }
              } else {
                if (pgn.pgn >= 0xff00 && pgn.pgn <= 0xffff) {
                  pgnData = getPGNWithId(
                    '0xff000xffffManufacturerProprietarySingleFrameNonAddressed'
                  )!
                  fields = pgnData.Fields
                } else if (pgn.pgn >= 0x1ed00 && pgn.pgn <= 0x1ee00) {
                  pgnData = getPGNWithId(
                    '0x1ed000x1ee00StandardizedFastPacketAddressed'
                  )!
                  fields = pgnData.Fields
                } else {
                  unknownPGN = true
                  fields = []
                  const data = bs.readArrayBuffer(Math.floor(bs.bitsLeft / 8))
                  if (data.length > 0) {
                    ;(pgn.fields as any).data = byteString(
                      Buffer.from(data),
                      ' '
                    )
                  }
                }
              }

              const postProcessor = fieldTypePostProcessors[field.FieldType]
              if (postProcessor) {
                value = postProcessor(field, value)
              } else if (
                field.FieldType === 'LOOKUP' &&
                (_.isUndefined(this.options.resolveEnums) ||
                  this.options.resolveEnums)
              ) {
                value = lookup(field, value)
              }
            } else {
              return undefined
            }
          } else {
            pgnData = pgnList[0]
            fields = pgnData.Fields
            //console.log(`using ${JSON.stringify(pgnData, null, 2)}`)
            value = pgnData.Fields[i].Description
            if (value == null) {
              value = pgnData.Fields[i].Match
            }
            RepeatingFields = pgnData.RepeatingFieldSet1Size
              ? pgnData.RepeatingFieldSet1Size
              : 0
          }
        }

        if (
          value !== undefined &&
          (value != null || this.options.returnNulls)
        ) {
          this.setField(pgn.fields, field, value)
        }
      }
      if (RepeatingFields > 0 && continueReading) {
        const repeating: Field[] = (fields as any).slice(
          fields.length - RepeatingFields
        )

        const fany = pgn.fields as any
        fany.list = []

        let count

        if (pgnData.RepeatingFieldSet1CountField !== undefined) {
          const rfield =
            pgnData.Fields[pgnData.RepeatingFieldSet1CountField - 1]
          const dataKey = this.options.useCamel ? rfield.Id : rfield.Name
          count = (pgn.fields as any)[dataKey]
        } else {
          count = 2048
        }

        while (bs.bitsLeft > 0 && --count >= 0) {
          const group: { [key: string]: any } = {}
          repeating.forEach((field) => {
            if (bs.bitsLeft > 0) {
              const [value, refField] = readField(
                pgnData!,
                this.options,
                true,
                pgn,
                field,
                bs,
                fields
              )
              if (refField) {
                group.parameterId = refField.Id
              }
              if (
                value !== undefined &&
                (value != null || this.options.returnNulls)
              ) {
                this.setField(group, field, value)
              }
            }
          })
          if (_.keys(group).length > 0) {
            fany.list.push(group)
          }
        }
      }

      /*
      if ( pgnData.callback ) {
        pgnData.callback(pgn)
        }
      */

      const res =
        this.options.createPGNObjects === false
          ? pgn
          : unknownPGN === false
            ? createPGN(pgnData.Id, pgn.fields)
            : new PGN_Uknown(pgn.fields)

      if (res === undefined) {
        this.emit('error', pgn, 'no class')
        cb && cb('no class', undefined)
        return
      }

      if (unknownPGN) {
        res.description = 'Unknown PGN'
      } else {
        res.description = pgnData.Description
      }
      res.pgn = pgn.pgn
      res.src = pgn.src
      res.dst = pgn.dst
      res.prio = pgn.prio
      const apgn = pgn as any
      if (apgn.canId !== undefined) {
        ;(res as any).canId = apgn.canId
      }
      if (apgn.time !== undefined) {
        ;(res as any).time = apgn.time
      }
      if (apgn.timer !== undefined) {
        ;(res as any).timer = apgn.timer
      }
      if (apgn.direction !== undefined) {
        ;(res as any).direction = apgn.direction
      }
      if (apgn.input !== undefined) {
        ;(res as any).input = apgn.input
      }

      // Stringify timestamp because SK Server needs it that way.
      const ts = _.get(pgn, 'timestamp', new Date())
      res.timestamp = _.isDate(ts) ? ts.toISOString() : ts
      this.emit('pgn', res)
      cb && cb(undefined, res)

      return res
    } catch (error) {
      this.emit('error', pgn, error)
      cb && cb(error, undefined)
      return
    }
  }

  setField(res: any, field: Field, value: any) {
    if (this.options.useCamelCompat) {
      res[field.Id] = value
      res[field.Name] = value
    } else if (this.options.useCamel) {
      res[field.Id] = value
    } else {
      res[field.Name] = value
    }
  }

  getField(res: any, field: Field) {
    if (this.options.useCamelCompat || this.options.useCamel) {
      return res[field.Id]
    } else {
      return res[field.Name]
    }
  }

  findNonMatchPgn(pgnList: Definition[]): Definition | undefined {
    return pgnList.find((f) => {
      return !f.Fields.find((f) => f.Match !== undefined)
    })
  }

  findMatchPgn(pgnList: Definition[]): Definition | undefined {
    return pgnList.find((f) => {
      return f.Fields.find((f) => f.Match !== undefined)
    })
  }

  parse(data: any, cb: FromPgnCallback | undefined = undefined) {
    if (_.isString(data)) {
      return this.parseString(data, cb)
    } else if (_.isBuffer(data)) {
      return this.parseBuffer(data, cb)
    } else {
      return this.parsePgnData(
        data.pgn,
        data.length,
        data.data,
        data.coalesced === true,
        cb,
        data.sourceString
      )
    }
  }

  parsePgnData(
    pgn: PGN,
    length: number,
    data: string[] | Buffer,
    coalesced: boolean,
    cb: FromPgnCallback | undefined,
    sourceString: string
  ) {
    try {
      let buffer = data
      if (!_.isBuffer(data)) {
        const array = new Int16Array(length)
        const strings = data as string[]
        strings.forEach((num, index) => {
          array[index] = parseInt(num, 16)
        })
        buffer = Buffer.from(array)
        if (sourceString === undefined && this.options.includeInputData) {
          //sourceString = strings.join(' ')
          sourceString = encodeCandump2({ pgn, data: buffer })
          /*
          sourceString = binToActisense(
            pgn as CanID,
            new Date().toISOString(),
            buffer,
            buffer.length
          )
            */
        }
      }

      const bv = new BitView(buffer as Buffer)
      const bs = new BitStream(bv)
      const res = this._parse(pgn, bs, length, coalesced, cb, sourceString)
      if (res) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch (error) {
      cb && cb(error, undefined)
      this.emit('error', pgn, error)
    }
  }

  isN2KOver0183(sentence: string) {
    return isN2KOver0183(sentence)
  }

  parseN2KOver0183(sentence: string, cb: FromPgnCallback) {
    return this.parseString(sentence, cb)
  }

  /*
  // Venus MQTT-N2K
  parseVenusMQTT(pgn_data: any, cb: FromPgnCallback) {
    try {
      const pgn = {
        pgn: pgn_data.pgn,
        timestamp: new Date().toISOString(),
        src: pgn_data.src,
        dst: pgn_data.dst,
        prio: pgn_data.prio,
        fields: {}
      }
      const bs = new BitStream(Buffer.from(pgn_data.data, 'base64'))
      delete pgn_data.data
      const res = this._parse(pgn, bs, 8, false, cb)
      if (res) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch (error) {
      cb && cb(error, undefined)
      this.emit('error', pgn_data, error)
    }
    }
    */

  //Yacht Devices NMEA2000 Wifi gateway
  parseYDGW02(pgn_data: any, cb: FromPgnCallback) {
    try {
      const { data, direction, error, ...pgn } = parseYDRAW(pgn_data)
      if (!error && direction === 'R') {
        const bs = new BitStream(data)
        delete pgn.format
        const res = this._parse(pgn, bs, data.length, false, cb, pgn_data)
        if (res) {
          debug('parsed ydgw02 pgn %j', pgn_data)
          return res
        }
      } else if (error) {
        cb && cb(error, undefined)
        this.emit('error', pgn_data, error)
      }
    } catch (error) {
      cb && cb(error, undefined)
      this.emit('error', pgn_data, error)
    }
    return undefined
  }

  //Actisense W2k-1
  parseActisenceN2KAscii(pgn_data: any, cb: FromPgnCallback) {
    try {
      const { data, error, ...pgn } = parseActisenseN2KASCII(pgn_data)
      if (!error) {
        const bs = new BitStream(data)
        delete pgn.format
        const res = this._parse(pgn, bs, data.length, false, cb, pgn_data)
        if (res) {
          debug('parsed n2k ascii pgn %j', pgn_data)
          return res
        }
      } else if (error) {
        cb && cb(error, undefined)
        this.emit('error', pgn_data, error)
      }
    } catch (error) {
      cb && cb(error, undefined)
      this.emit('error', pgn_data, error)
    }
    return undefined
  }

  parsePDGY(pgn_data: any, cb: FromPgnCallback) {
    if (pgn_data[0] != '!') {
      return
    }
    try {
      const { coalesced, data, error, len, ...pgn } = parsePDGY(pgn_data)
      if (error) {
        cb && cb(error, undefined)
        this.emit('error', pgn, error)
        return
      }

      const bs = new BitStream(data)
      delete pgn.format
      delete pgn.type
      delete pgn.prefix
      const res = this._parse(
        pgn,
        bs,
        len || data.length,
        coalesced,
        cb,
        pgn_data
      )
      if (res) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch (error) {
      cb && cb(error, undefined)
      this.emit('error', pgn_data, error)
    }
  }

  parseString(pgn_data: string, cb: FromPgnCallback | undefined = undefined) {
    try {
      const { coalesced, data, error, len, ...pgn } = parseN2kString(
        pgn_data,
        this.options
      )
      if (error) {
        cb && cb(error, undefined)
        this.emit('error', pgn, error)
        return
      }

      const bs = new BitStream(data)
      delete pgn.format
      delete pgn.type
      delete pgn.prefix
      const res = this._parse(
        pgn,
        bs,
        len || data.length,
        coalesced,
        cb,
        pgn_data
      )
      if (res) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch (error) {
      cb && cb(error, undefined)
      this.emit('error', pgn_data, error)
    }
  }

  parseBuffer(pgn_data: any, cb: FromPgnCallback | undefined) {
    try {
      const bv = new BitView(pgn_data)
      const bs = new BitStream(bv)

      const pgn: any = {}

      // This might be good to move to canId.js ?
      pgn.prio = bs.readUint8()
      pgn.pgn = bs.readUint8() + 256 * (bs.readUint8() + 256 * bs.readUint8())
      pgn.dst = bs.readUint8()
      pgn.src = bs.readUint8()
      pgn.timestamp = new Date().toISOString()

      //const timestamp  =  FIXME?? use timestamp?
      bs.readUint32()
      const len = bs.readUint8()
      const res = this._parse(pgn, bs, len, true, cb)
      if (res) {
        debug('parsed pgn %j', pgn)
      }
      return res
    } catch (error) {
      const err = new Error(
        `error reading pgn ${JSON.stringify(pgn_data)} ${error}`
      )
      cb && cb(err, undefined)
      this.emit('error', pgn_data, error)
      console.error(err)
      return
    }
  }
}

export function getField(pgn_number: number, index: number, data: any) {
  let pgnList = getPgn(pgn_number)
  if (pgnList) {
    pgnList = pgnList.filter(
      (pgn: any) => pgn.Fallback === undefined || pgn.Fallback === false
    )

    let pgn = pgnList[0]
    const dataList = data.list ? data.list : data.fields.list

    if (pgnList.length > 1) {
      let idx = 0
      while (idx < pgn.Fields.length) {
        const field = pgn.Fields[idx]
        const hasMatch = !_.isUndefined(field.Match)
        if (hasMatch && dataList.length > 0) {
          const param = dataList.find((f: any) => {
            const param = f.parameter !== undefined ? f.parameter : f.Parameter
            return param === idx + 1
          })

          if (param) {
            const value = param.value !== undefined ? param.value : param.Value

            pgnList = pgnList.filter((f) => {
              return (
                f.Fields[idx].Match == value ||
                f.Fields[idx].Description == value
              )
            })
            if (pgnList.length == 0) {
              throw new Error('unable to read: ' + JSON.stringify(data))
              return
            } else {
              pgn = pgnList[0]
            }
          }
        }
        idx++
      }
    }

    if (index >= 0 && index < pgn.Fields.length) {
      return pgn.Fields[index]
    }

    const RepeatingFields = pgn.RepeatingFieldSet1Size
      ? pgn.RepeatingFieldSet1Size
      : 0
    if (RepeatingFields) {
      const startOfRepeatingFields = pgn.Fields.length - RepeatingFields
      index =
        startOfRepeatingFields +
        ((index - startOfRepeatingFields) % RepeatingFields)
      return pgn.Fields[index]
    }
  }
  return null
}

function pad2(x: number) {
  const s = x.toString()
  return s.length === 1 ? '0' + x : x
}

function lookup(field: Field, value: number) {
  let name
  if (field.LookupEnumeration) {
    name = getEnumerationName(field.LookupEnumeration, value)
  } else {
    name = getFieldTypeEnumerationName(field.LookupFieldTypeEnumeration, value)
  }

  return name ? name : value
}

function readField(
  definition: Definition,
  options: any,
  runPostProcessor: boolean,
  pgn: PGN,
  field: Field,
  bs: BitStream,
  fields: Field[] | undefined = undefined
): [any, Field | undefined] {
  let value
  let refField: Field | undefined = undefined

  const reader = fieldTypeReaders[field.FieldType]
  if (reader) {
    value = reader(pgn, field, bs)
  } else {
    if (
      field.FieldType !== FieldType.Binary &&
      field.BitLength !== undefined &&
      bs.bitsLeft < field.BitLength
    ) {
      //no more data
      bs.readBits(bs.bitsLeft, false)
      return [null, undefined]
    }
    ;[value, refField] = readValue(definition, options, pgn, field, bs, fields)
  }

  if (refField === undefined) {
    return [convertField(field, value, runPostProcessor, options), undefined]
  } else {
    return [value, refField]
  }
}

function convertField(
  field: Field,
  value: any,
  runPostProcessor: boolean,
  options: any
): any {
  if (value != null && value !== undefined) {
    const type = field.FieldType //hack, missing type
    const postProcessor = fieldTypePostProcessors[type]
    if (postProcessor) {
      if (runPostProcessor) {
        value = postProcessor(field, value)
      }
    } else {
      if (field.Offset) {
        value += field.Offset
      }
      let max
      if (typeof field.RangeMax !== 'undefined' && field.Resolution) {
        max = field.RangeMax / field.Resolution
      }
      if (
        options.checkForInvalidFields !== false &&
        max !== undefined &&
        field.FieldType !== 'LOOKUP' &&
        field.FieldType !== 'DYNAMIC_FIELD_KEY' &&
        field.FieldType !== 'PGN' &&
        field.BitLength !== undefined &&
        field.BitLength > 1 &&
        max - value < 0
      ) {
        //console.log(`Bad field ${field.Name} ${max - value}`)
        value = null
      }
      if (field.Resolution && typeof value === 'number') {
        let resolution = field.Resolution

        if (_.isString(resolution)) {
          resolution = Number.parseFloat(resolution)
        }

        value = value * resolution

        let precision = 0
        for (let r = resolution; r > 0.0 && r < 1.0; r = r * 10.0) {
          precision++
        }

        value = Number.parseFloat(value.toFixed(precision))
      }

      if (
        (field.FieldType === 'LOOKUP' ||
          field.FieldType === 'DYNAMIC_FIELD_KEY') &&
        runPostProcessor &&
        (_.isUndefined(options.resolveEnums) || options.resolveEnums)
      ) {
        if (field.Id === 'timeStamp' && value < 60) {
          value = value.toString()
        } else {
          value = lookup(field, value)
        }
      }

      /*
      if ( field.Name === 'Industry Code' && _.isNumber(value) && runPostProcessor ) {
        const name = getIndustryName(value)
        if ( name ) {
          value = name
        }
        }
      */

      if (field.Unit === 'kWh') {
        value *= 3.6e6 // 1 kWh = 3.6 MJ.
      } else if (field.Unit === 'Ah') {
        value *= 3600.0 // 1 Ah = 3600 C.
      }
    }
  }
  return value
}

function readValue(
  definition: Definition,
  options: any,
  pgn: PGN,
  field: Field,
  bs: BitStream,
  fields: Field[] | undefined,
  bitLength: number | undefined = undefined
): [any, Field | undefined] {
  if (field.FieldType == 'VARIABLE') {
    return readVariableLengthField(definition, options, pgn, field, bs)
  } else {
    let value
    if (bitLength === undefined) {
      if (
        field.BitLengthVariable &&
        field.FieldType === 'DYNAMIC_FIELD_VALUE'
      ) {
        bitLength = lookupKeyBitLength(pgn.fields, fields as Field[])
      } else {
        bitLength = field.BitLength
      }

      if (bitLength === undefined) {
        //FIXME?? error? mesg? should never happen
        return [null, undefined]
      }
    }
    try {
      if (
        field.FieldType === FieldType.Binary &&
        definition.Fallback === true
      ) {
        bitLength = bs.bitsLeft < bitLength ? bs.bitsLeft : bitLength
        const data = bs.readArrayBuffer(Math.floor(bitLength / 8))
        return [byteString(Buffer.from(data), ' '), undefined]
      } else if (bitLength === 8) {
        if (field.Signed) {
          value = bs.readInt8()
          value = value === 0x7f ? null : value
        } else {
          value = bs.readUint8()
          value = value === 0xff ? null : value
        }
      } else if (bitLength == 16) {
        if (field.Signed) {
          value = bs.readInt16()
          value = value === 0x7fff ? null : value
        } else {
          value = bs.readUint16()
          value = value === 0xffff ? null : value
        }
      } else if (bitLength == 24) {
        const b1 = bs.readUint8()
        const b2 = bs.readUint8()
        const b3 = bs.readUint8()

        //debug(`24 bit ${b1.toString(16)} ${b2.toString(16)} ${b3.toString(16)}`)
        value = (b3 << 16) + (b2 << 8) + b1
        //debug(`value ${value.toString(16)}`)
      } else if (bitLength == 32) {
        if (field.Signed) {
          value = bs.readInt32()
          value = value === 0x7fffffff ? null : value
        } else {
          value = bs.readUint32()
          value = value === 0xffffffff ? null : value
        }
      } else if (bitLength == 48) {
        const a = bs.readUint32()
        const b = bs.readUint16()

        if (field.Signed) {
          value = a == 0xffffffff && b == 0x7fff ? null : new Int64LE(b, a)
        } else {
          value = a == 0xffffffff && b == 0xffff ? null : new Int64LE(b, a)
        }
      } else if (bitLength == 64) {
        const x = bs.readUint32()
        const y = bs.readUint32()

        if (field.Signed) {
          value =
            (x === 0xffffffff || x === 0xfffffffe) && y == 0x7fffffff
              ? null
              : new Int64LE(y, x)
        } else {
          value =
            (x === 0xffffffff || x === 0xfffffffe) && y == 0xffffffff
              ? null
              : new Uint64LE(y, x)
        }
      } else if (bitLength <= 64) {
        value = bs.readBits(bitLength, field.Signed)
        if (bitLength > 1 && isMax(bitLength, value, field.Signed as boolean)) {
          value = null
        }
      } else {
        if (bs.bitsLeft < bitLength) {
          bitLength = bs.bitsLeft
          if (bitLength === undefined) {
            return [null, undefined]
          }
        }

        value = bs.readArrayBuffer(bitLength / 8) //, field.Signed)
        const arr: string[] = []
        value = new Uint32Array(value)
          .reduce(function (acc, i) {
            acc.push(i.toString(16))
            return acc
          }, arr)
          .map((x) => (x.length === 1 ? '0' + x : x))
          .join(' ')

        return [value, undefined]
      }
    } catch (error) {
      debug(
        `Error reading field ${field.Name} of type ${field.FieldType} with bit length ${bitLength} from PGN ${pgn.pgn}: ${error}`
      )
      return [null, undefined]
    }

    if (
      value != null &&
      typeof value !== 'undefined' &&
      typeof value !== 'number'
    ) {
      value = Number(value)
    }

    return [value, undefined]
  }
}

function isMax(numBits: number, value: number, signed: boolean) {
  if (signed) {
    numBits--
  }

  while (numBits--) {
    if ((value & 1) == 0) {
      return false
    }
    value = value >> 1
  }
  return signed ? (value & 1) == 0 : true
}

function readVariableLengthField(
  definition: Definition,
  options: any,
  pgn: PGN,
  field: Field,
  bs: BitStream
): [any, Field | undefined] {
  /* PGN 126208 contains variable field length.
   * The field length can be derived from the PGN mentioned earlier in the message,
   * plus the field number.
   */

  /*
   * This is rather hacky. We know that the 'data' pointer points to the n-th variable field
   * length and thus that the field number is exactly one byte earlier.
   */

  try {
    const refField = getField(
      (pgn.fields as any).pgn || (pgn.fields as any).PGN,
      bs.view.buffer[bs.byteIndex - 1] - 1,
      pgn
    )

    if (refField) {
      const [res] = readField(definition, options, true, pgn, refField, bs)

      if (refField.BitLength !== undefined) {
        const bits = (refField.BitLength + 7) & ~7 // Round # of bits in field refField up to complete bytes: 1->8, 7->8, 8->8 etc.
        if (bits > refField.BitLength) {
          bs.readBits(bits - refField.BitLength, false)
        }
      }

      return [res, refField]
    }
  } catch (error) {
    debug(error)
  }
  return [null, undefined]
}

fieldTypeReaders[
  'STRING_LAU'
  //'ASCII or UNICODE string starting with length and control byte'
] = (pgn, field, bs) => {
  if (bs.bitsLeft >= 16) {
    const len = bs.readUint8() - 2
    const control = bs.readUint8()
    let nameLen = len

    if (field.Name === 'AtoN Name' && len > 20) {
      nameLen = 20
    } else if (len <= 0) {
      return null
    }

    const buf = Buffer.alloc(len)
    let idx = 0
    for (; idx < len && bs.bitsLeft >= 8; idx++) {
      const c = bs.readUint8()
      buf.writeUInt8(c, idx)
    }

    if (buf[buf.length - 1] === 0) {
      nameLen = nameLen - 1
    }

    return buf
      .toString(
        control == 0 ? 'utf8' : 'ascii',
        0,
        idx < nameLen ? idx : nameLen
      )
      .trim()
  } else {
    return null
  }
}

fieldTypeReaders[
  'STRING_LZ'
  //'ASCII string starting with length byte'
] = (pgn, field, bs) => {
  const len = bs.readUint8()

  const buf = Buffer.alloc(len)
  let idx = 0
  for (; idx < len && bs.bitsLeft >= 8; idx++) {
    const c = bs.readUint8()
    buf.writeUInt8(c, idx)
  }

  return buf.toString('utf-8', 0, idx)
}

fieldTypeReaders['String with start/stop byte'] = (pgn, field, bs) => {
  const first = bs.readUint8()
  if (first == 0xff) {
    // no name, stop reading
    return ''
  } else if (first == 0x02) {
    const buf = Buffer.alloc(255)
    let c
    let idx = 0
    while ((c = bs.readUint8()) != 0x01) {
      buf.writeUInt8(c, idx++)
    }
    return buf.toString('ascii', 0, idx)
  } else if (first > 0x02) {
    let len = first
    const second = bs.readUint8()
    const buf = Buffer.alloc(len)
    let idx = 0
    if (second == 0x01) {
      len -= 2
    } else {
      buf.writeUInt8(second)
      idx = 1
    }
    for (; idx < len; idx++) {
      const c = bs.readUint8()
      buf.writeUInt8(c, idx)
    }
    return buf.toString('ascii', 0, idx)
  }
}

fieldTypeReaders['STRING_FIX'] = (pgn, field, bs) => {
  let len = (field.BitLength as number) / 8
  const buf = Buffer.alloc(len)

  for (let i = 0; i < len && bs.bitsLeft >= 8; i++) {
    buf.writeUInt8(bs.readUint8(), i)
  }

  let lastbyte = buf[len - 1]
  while (
    len > 0 &&
    (lastbyte == 0xff || lastbyte == 32 || lastbyte == 0 || lastbyte == 64)
  ) {
    len--
    lastbyte = buf[len - 1]
  }

  //look for a zero byte, some proprietary Raymarine pgns do this
  let zero = 0
  while (zero < len) {
    if (buf[zero] == 0) {
      len = zero
      break
    }
    zero++
  }
  len = zero
  return len > 0 ? buf.toString('ascii', 0, len) : undefined
}

fieldTypeReaders['BITLOOKUP'] = (pgn, field, bs) => {
  const value: any[] = []
  for (let i = 0; i < (field.BitLength as number); i++) {
    if (bs.readBits(1, false)) {
      value.push(getBitEnumerationName(field.LookupBitEnumeration as string, i))
    }
  }
  return value
}

function lookupKeyBitLength(data: any, fields: Field[]): number | undefined {
  const field = fields.find((field) => field.Name === 'Key')

  if (field) {
    let val: any = data['Key'] || data['key']
    if (typeof val === 'string') {
      val = getFieldTypeEnumerationValue(field.LookupFieldTypeEnumeration, val)
    }
    return getFieldTypeEnumerationBits(field.LookupFieldTypeEnumeration, val)
  }
}

fieldTypePostProcessors['DATE'] = (field, value) => {
  if (value >= 0xfffd) {
    value = undefined
  } else {
    const date = new Date(value * 86400 * 1000)
    //const date = moment.unix(0).add(value+1, 'days').utc().toDate()
    value = `${date.getUTCFullYear()}.${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`
  }
  return value
}

fieldTypePostProcessors['TIME'] = (field, value) => {
  if (value >= 0xfffffffd) {
    value = undefined
  } else {
    let seconds = value * (field.Resolution as number)
    let minutes = seconds / 60
    seconds = seconds % 60
    const hours = Math.floor(minutes / 60)
    minutes = Math.floor(minutes % 60)

    value = `${pad2(hours)}:${pad2(minutes)}:${pad2(Math.floor(seconds))}`

    if (seconds % 1 > 0) {
      value = value + (seconds % 1).toFixed(5).substring(1)
    }
  }
  return value
}

fieldTypePostProcessors['DURATION'] = fieldTypePostProcessors['TIME']

fieldTypePostProcessors['Pressure'] = (field, value) => {
  if (field.Unit) {
    switch (field.Unit[0]) {
      case 'h':
      case 'H':
        value *= 100
        break
      case 'k':
      case 'K':
        value *= 1000
        break
      case 'd':
        value /= 10
        break
    }
  }
  return value
}

fieldTypePostProcessors[RES_BINARY] = (field, value) => {
  return value.toString()
}

class PGN_Uknown extends PGN {
  constructor(fields: any) {
    super({})
    this.fields = fields
  }

  getDefinition(): Definition {
    return {
      PGN: this.pgn,
      Id: 'unknown',
      Description: 'Unknown PGN',
      Type: Type.Single,
      Complete: false,
      Priority: 3,
      Fields: []
    }
  }
}
