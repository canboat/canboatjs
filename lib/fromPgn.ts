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
  Type,
  getEnumerationName,
  getBitEnumerationName,
  getFieldTypeEnumerationName,
  getFieldTypeEnumeration,
  findFallBackPGN
} from '@canboat/ts-pgns'
import { createDebug, byteString, isPGNProprietary } from './utilities'
import { EventEmitter } from 'events'
import pkg from '../package.json'
import _ from 'lodash'
import { getPgn, getCustomPgn, addCustomPgns } from './pgns'
import { BitStream, BitView } from 'bit-buffer'
import { Int64LE, Uint64LE } from 'int64-buffer'
import {
  encodeCandump2,
  CAN_FRAME_MAX_LEN,
  RAW_FRAME_FORMATS
} from './stringMsg'
import { rdsG0Char } from './charsets'
import { Reassembler, PGN_ISO_TP_CM, PGN_ISO_TP_DT } from './reassembly'
import { parseQuirks, Quirks } from './quirks'
import {
  roundToDecimals,
  scaleOf,
  siConversion,
  timeDecimalsFor
} from './units'

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
/**
 * Context a post-processor needs beyond the field itself: the PGN being
 * decoded (for the fields already read) and the parser options (for the
 * `quirks` list).
 */
export type PostProcessorContext = { pgn: PGN; options: any }
export type PostProcessor = (
  field: Field,
  value: any,
  context?: PostProcessorContext
) => any
type FieldTypeReader = (pgn: PGN, field: Field, bs: BitStream) => any

/**
 * The quirks each parser was configured with, keyed by its options object,
 * which is what the field readers and post-processors are handed.
 */
const parsedQuirks = new WeakMap<object, Quirks>()
const quirksOf = (options: any): Quirks | undefined =>
  options ? parsedQuirks.get(options) : undefined

const fieldTypeReaders: {
  [key: string]: FieldTypeReader
} = {}

const fieldTypePostProcessors: {
  [key: string]: PostProcessor
} = {}

const FORMAT_PLAIN = 0
const FORMAT_COALESCED = 1
const RES_BINARY = 'Binary data'

export type ByteMapping = {
  bytes: number[]
  value?: number | string | null
  bits?: string
}

export type RepeatingByteMapping = {
  [key: string]: ByteMapping
}

export type ByteMap = {
  [key: string]: ByteMapping | RepeatingByteMapping[]
}

export class Parser extends EventEmitter {
  options: any
  name: string
  version: string
  author: string
  license: string
  format: number
  devices: { [key: number]: { [key: number]: any } }
  private reassembler: Reassembler
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

    if (this.options.includeRawData === undefined) {
      this.options.includeRawData = false
    }

    if (this.options.includeByteMapping === undefined) {
      this.options.includeByteMapping = false
    }

    // Device quirks, off unless asked for by name (see ./quirks). A bad
    // quirk string is refused here, as canboat refuses the --quirk flag.
    if (this.options.quirks === undefined) {
      this.options.quirks = []
    }
    // Say which option is wrong: a host such as Signal K shows this message
    // as the connection's error, where a bare "'vhf' is not a device" would
    // not say what it is about.
    try {
      parsedQuirks.set(this.options, parseQuirks(this.options.quirks))
    } catch (e: any) {
      throw new Error(`Invalid quirks option: ${e.message}`)
    }

    this.name = pkg.name
    this.version = pkg.version
    this.author = pkg.author
    this.license = pkg.license
    this.format = this.options.format === undefined ? -1 : this.options.format
    this.devices = {}
    this.reassembler = new Reassembler()
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

  private getPGNDefinitionList(pgn: PGN): Definition[] | undefined {
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

    if (pgn.pgn === 59392) {
      // I don't think I need this anymore??
      pgnList = pgnList.filter(
        (pgn: any) => pgn.Fallback === undefined || pgn.Fallback === false
      )
    }

    return pgnList
  }

  private readPacket(
    pgn: PGN,
    pgnData: Definition,
    bs: BitStream,
    len: number,
    coalesced: boolean,
    cb: FromPgnCallback | undefined,
    sourceString: string | undefined = undefined,
    rawFrame = false
  ): BitStream | undefined {
    // A raw frame is one CAN frame by definition, so it neither learns nor
    // obeys the coalesced format: a stream that once carried a whole
    // message would otherwise decode every later frame as a message.
    if (
      coalesced ||
      len > 0x8 ||
      (!rawFrame && this.format == FORMAT_COALESCED && !this.mixedFormat)
    ) {
      this.format = FORMAT_COALESCED
      if (sourceString && this.options.includeInputData) {
        pgn.input = [sourceString]
      }
      return bs
    } else if (pgnData.Type === 'Fast') {
      // One frame of a fast-packet message: slot it in by its index, as
      // canboat does, so frames that arrive out of order still assemble.
      this.format = FORMAT_PLAIN
      const res = this.reassembler.push(
        {
          pgn: pgn.pgn,
          src: pgn.src!,
          dst: pgn.dst!,
          prio: pgn.prio!,
          timestamp: pgn.timestamp,
          data: Buffer.from(
            bs.view.buffer.subarray(0, Math.min(len, bs.view.buffer.length))
          ),
          input: sourceString ? [sourceString] : undefined
        },
        'Fast'
      )
      if (res.kind === 'error') {
        debug(`PGN ${pgn.pgn} from ${pgn.src}: ${res.message}`)
        cb && cb(`Could not parse ${JSON.stringify(pgn)}`, undefined)
        return
      }
      if (res.kind !== 'complete') {
        trace(`${pgn.pgn} not complete`)
        return
      }
      trace(`${pgn.pgn} done`)
      if (this.options.includeInputData) {
        pgn.input = res.frame.input
      }
      return new BitStream(new BitView(res.frame.data))
    } else if (sourceString && this.options.includeInputData) {
      pgn.input = [sourceString]
    }
    return bs
  }

  private readRepeatingFields(pgn: PGN, pgnData: Definition, bs: BitStream) {
    const RepeatingFields1 = pgnData.RepeatingFieldSet1Size ?? 0
    const RepeatingFields2 = pgnData.RepeatingFieldSet2Size ?? 0
    const totalRepeating = RepeatingFields1 + RepeatingFields2

    const fields = pgnData.Fields

    const set1Fields: Field[] = (fields as any).slice(
      fields.length - totalRepeating,
      fields.length - totalRepeating + RepeatingFields1
    )

    const fany = pgn.fields as any
    fany.list = []

    if (this.options.includeByteMapping) {
      ;(pgn as any).byteMapping['list'] = []
    }

    let count1

    if (pgnData.RepeatingFieldSet1CountField !== undefined) {
      const rfield = pgnData.Fields[pgnData.RepeatingFieldSet1CountField - 1]
      const dataKey = this.options.useCamel ? rfield.Id : rfield.Name
      count1 = (pgn.fields as any)[dataKey]
    } else {
      count1 = 2048
    }

    while (bs.bitsLeft > 0 && --count1 >= 0) {
      const group: { [key: string]: any } = {}
      let repeatingMap: RepeatingByteMapping
      if (this.options.includeByteMapping) {
        repeatingMap = {}
        ;(pgn as any).byteMapping['list'].push(repeatingMap)
      }

      set1Fields.forEach((field) => {
        if (bs.bitsLeft > 0) {
          const [value, refField, byteMapping] = readField(
            pgnData!,
            this.options,
            true,
            pgn,
            field,
            bs
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
          if (this.options.includeByteMapping && byteMapping) {
            repeatingMap[field.Id] = byteMapping
          }
        }
      })
      if (_.keys(group).length > 0) {
        fany.list.push(group)
      }
    }

    // Process RepeatingFieldSet2 if defined
    if (RepeatingFields2 > 0) {
      const set2Fields: Field[] = (fields as any).slice(
        fields.length - RepeatingFields2
      )

      fany.list2 = []

      if (this.options.includeByteMapping) {
        ;(pgn as any).byteMapping['list2'] = []
      }

      let count2

      if (pgnData.RepeatingFieldSet2CountField !== undefined) {
        const rfield = pgnData.Fields[pgnData.RepeatingFieldSet2CountField - 1]
        const dataKey = this.options.useCamel ? rfield.Id : rfield.Name
        count2 = (pgn.fields as any)[dataKey]
      } else {
        count2 = 2048
      }

      while (bs.bitsLeft > 0 && --count2 >= 0) {
        const group: { [key: string]: any } = {}
        let repeatingMap: RepeatingByteMapping
        if (this.options.includeByteMapping) {
          repeatingMap = {}
          ;(pgn as any).byteMapping['list2'].push(repeatingMap)
        }

        set2Fields.forEach((field) => {
          if (bs.bitsLeft > 0) {
            const [value, refField, byteMapping] = readField(
              pgnData!,
              this.options,
              true,
              pgn,
              field,
              bs
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
            if (this.options.includeByteMapping && byteMapping) {
              repeatingMap[field.Id] = byteMapping
            }
          }
        })
        if (_.keys(group).length > 0) {
          fany.list2.push(group)
        }
      }
    }
  }

  private readFields(
    pgn: PGN,
    pgnList: Definition[],
    startDef: Definition,
    bs: BitStream
  ): [boolean, Definition | undefined, BitStream] {
    let pgnData: Definition | undefined = startDef

    let RepeatingFields = pgnData.RepeatingFieldSet1Size ?? 0
    let totalRepeatingFields =
      RepeatingFields + (pgnData.RepeatingFieldSet2Size ?? 0)

    pgn.fields = {}

    if (this.options.includeByteMapping) {
      ;(pgn as any).byteMapping = {}
    }

    let fields = pgnData.Fields

    let unknownPGN = false
    let previousMatch: Definition | undefined
    let targetPgnForCondition: number | undefined
    for (let i = 0; i < fields.length - totalRepeatingFields; i++) {
      const field = fields[i]

      // Skip conditional proprietary fields when target PGN is not proprietary
      if (
        field.Condition === 'PGNIsProprietary' &&
        targetPgnForCondition !== undefined &&
        !isPGNProprietary(targetPgnForCondition)
      ) {
        continue
      }

      const hasMatch = field.Match !== undefined

      const [valueRes, _refField, byteMapping] = readField(
        pgnData!,
        this.options,
        !hasMatch,
        pgn,
        field,
        bs
      )
      let value = valueRes

      if (this.options.includeByteMapping) {
        ;(pgn as any).byteMapping[field.Id] = byteMapping
      }

      if (hasMatch) {
        if (field.BitLength === 8 && field.Match === 255) {
          value = 255
        }
        // A variant that ends before this field cannot describe a message
        // that has it (Airmar's 4-field catch-all against a filter command)
        pgnList = pgnList.filter(
          (f) =>
            f.Fields[i] !== undefined &&
            (f.Fields[i].Match == value || f.Fields[i].Match === undefined) &&
            f.Fallback !== true
        )
        if (pgnList.length == 0) {
          if (!this.options.returnNonMatches) {
            return [false, undefined, bs]
          } else {
            //this.emit('warning', pgn, `no conversion found for pgn`)
            trace('warning no conversion found for pgn %j', pgn)

            const setByteMapping = (data: Buffer) => {
              if (this.options.includeByteMapping) {
                const mapping: ByteMapping = {
                  bytes: Array.from(data)
                }
                ;(pgn as any).byteMapping.data = mapping
              }
            }

            pgnData = findFallBackPGN(pgn.pgn)

            if (pgnData === undefined) {
              unknownPGN = true
              fields = []
            } else {
              fields = pgnData.Fields
            }

            if (unknownPGN || i >= fields.length) {
              const data = bs.readArrayBuffer(Math.floor(bs.bitsLeft / 8))
              if (data.length > 0) {
                const buf = Buffer.from(data)
                ;(pgn.fields as any).data = byteString(buf, ' ')
                setByteMapping(buf)
              }
            }

            if (previousMatch) {
              ;(pgn as any).partialMatch = previousMatch.Id
            }

            const postProcessor = fieldTypePostProcessors[field.FieldType]
            if (postProcessor) {
              value = postProcessor(field, value, {
                pgn,
                options: this.options
              })
            } else if (
              field.FieldType === 'LOOKUP' &&
              (_.isUndefined(this.options.resolveEnums) ||
                this.options.resolveEnums)
            ) {
              value = lookup(field, value)
            }
          }
        } else {
          previousMatch = pgnData
          pgnData = pgnList[0]
          fields = pgnData.Fields
          //console.log(`using ${JSON.stringify(pgnData, null, 2)}`)
          const resolved = pgnData.Fields[i]
          if (resolved.Match !== undefined) {
            value = resolved.Description
            if (value == null) {
              value = resolved.Match
            }
          } else if (
            resolved.BitLength === field.BitLength &&
            Number(resolved.Resolution ?? 1) ===
              Number(field.Resolution ?? 1) &&
            Number(resolved.Offset ?? 0) === Number(field.Offset ?? 0) &&
            !!resolved.Signed === !!field.Signed
          ) {
            // Resolved to a non-match sibling: the field carries a real value
            // here, so keep what readField decoded and convert it as any
            // other field (post-processing, scaling to SI, lookup), which
            // hasMatch skipped. Only safe when the sibling occupies the same
            // bits on the same scale — the value was read against the match
            // field, so a differing width or resolution would make it a
            // misreading rather than a missing field.
            value = convertField(resolved, value, true, this.options, pgn)
          } else {
            // Sibling reads different bits: keep the pre-existing behaviour and
            // drop the value rather than report a misreading.
            value = undefined
          }
          RepeatingFields = pgnData.RepeatingFieldSet1Size ?? 0
          totalRepeatingFields =
            RepeatingFields + (pgnData.RepeatingFieldSet2Size ?? 0)
        }
      }

      if (value !== undefined && (value != null || this.options.returnNulls)) {
        this.setField(pgn.fields, field, value)
      }

      // Capture the target PGN value for conditional field checks
      if (field.FieldType === 'PGN' && typeof value === 'number') {
        targetPgnForCondition = value
      }
    }

    if (totalRepeatingFields > 0 && pgnData !== undefined) {
      this.readRepeatingFields(pgn, pgnData, bs)
    }

    return [unknownPGN, pgnData, bs]
  }

  private readPGN(
    pgn: PGN,
    pgnList: Definition[] | undefined,
    inBs: BitStream,
    len: number,
    coalesced: boolean,
    cb: FromPgnCallback | undefined,
    sourceString: string | undefined = undefined,
    rawFrame = false
  ): [boolean, Definition | undefined, BitStream | undefined] {
    let pgnData: Definition | undefined

    if (pgnList) {
      if (pgnList.length > 1) {
        pgnData = this.findMatchPgn(pgnList)

        if (pgnData === null) {
          pgnData = pgnList[0]
        }
      } else {
        pgnData = pgnList[0]
      }
    } else if (this.options.returnNonMatches) {
      pgnData = findFallBackPGN(pgn.pgn)
      if (pgnData) {
        pgnList = [pgnData]
      }
    }

    if (pgnList === undefined || pgnData === undefined) {
      if (this.options.includeInputData && sourceString) {
        pgn.input = [sourceString]
      }
      return [true, undefined, undefined]
    }

    const bs = this.readPacket(
      pgn,
      pgnData,
      inBs,
      len,
      coalesced,
      cb,
      sourceString,
      rawFrame
    )

    if (!bs) {
      return [false, undefined, undefined]
    }

    return this.readFields(pgn, pgnList, pgnData, bs)
  }

  private _parse(
    pgn: PGN,
    packetBs: BitStream,
    len: number,
    coalesced: boolean,
    cb: FromPgnCallback | undefined,
    sourceString: string | undefined = undefined,
    rawFrame = false
  ) {
    if (pgn.src === undefined) {
      throw new Error('invalid pgn, missing src: ' + JSON.stringify(pgn))
    }

    // More than 8 bytes in a raw CAN frame is a damaged line, e.g. two
    // partial lines glued together by a lost datagram. Decoding it as a
    // coalesced message would also flip the parser into the coalesced
    // format for good (#497).
    if (rawFrame && len > CAN_FRAME_MAX_LEN) {
      const error = new Error(
        `CAN frame for pgn ${pgn.pgn} from ${pgn.src} has ${len} data bytes`
      )
      cb && cb(error, undefined)
      this.emit('error', pgn, error)
      return
    }

    try {
      // ISO TP transport frames are plumbing for a longer message: hand
      // them to the reassembler and decode the PGN they carry once it is
      // complete, as canboat does.
      if (
        (pgn.pgn === PGN_ISO_TP_CM || pgn.pgn === PGN_ISO_TP_DT) &&
        !coalesced &&
        len <= 8
      ) {
        const res = this.reassembler.push(
          {
            pgn: pgn.pgn,
            src: pgn.src,
            dst: pgn.dst!,
            prio: pgn.prio!,
            timestamp: pgn.timestamp,
            data: Buffer.from(
              packetBs.view.buffer.subarray(
                0,
                Math.min(len, packetBs.view.buffer.length)
              )
            ),
            input: sourceString ? [sourceString] : undefined
          },
          'Single'
        )
        if (res.kind !== 'complete') {
          return
        }
        pgn.pgn = res.frame.pgn
        pgn.dst = res.frame.dst
        pgn.prio = res.frame.prio
        pgn.timestamp = res.frame.timestamp
        packetBs = new BitStream(new BitView(res.frame.data))
        len = res.frame.data.length
        coalesced = true
        if (this.options.includeInputData && res.frame.input) {
          ;(pgn as any).input = res.frame.input
          sourceString = undefined
        }
      }

      const pgnList = this.getPGNDefinitionList(pgn)

      const [unknownPGN, pgnData, bs] = this.readPGN(
        pgn,
        pgnList,
        packetBs,
        len,
        coalesced,
        cb,
        sourceString,
        rawFrame
      )

      if (unknownPGN == false && pgnData === undefined) {
        //not done reading yet (multi-frame)
        return
      }

      if (bs === undefined) {
        //not done reading yet (multi-frame)
        return
      }

      // The GPS rollover quirk keys devices by ISO NAME, which is the whole
      // PGN 60928 payload, so it learns those here as they go by.
      if (pgn.pgn === 60928 && pgnData !== undefined) {
        // Only the bytes received: a claim shorter than the 8-byte NAME
        // must fail the length check, not pick up the buffer's filler.
        quirksOf(this.options)?.gpsRollover?.noteAddressClaim(
          pgn.src,
          bs.view.buffer.subarray(0, Math.min(len, bs.view.buffer.length))
        )
      }

      let res
      if (unknownPGN || pgnData === undefined) {
        if (this.options.returnNonMatches !== true) {
          return
        }
        res = new PGN_Unknown(pgn.fields || [], unknownDef(pgn.pgn))
        res.description = 'Unknown PGN'
        ;(res as any).id = 'unknown'

        if (bs.bitsLeft > 0) {
          const data = bs.readArrayBuffer(Math.floor(bs.bitsLeft / 8))
          if (data.length > 0) {
            const buf = Buffer.from(data)
            ;(res.fields as any).data = byteString(buf, ' ')
            //setByteMapping(buf)
          }
        }
      } else {
        res =
          this.options.createPGNObjects === false
            ? pgn
            : createPGN(pgnData.Id, pgn.fields)

        if (res === undefined) {
          //this can happen in visual-analyer since there are no classe for new PGNs
          res = new PGN_Unknown(pgn.fields, pgnData)
        }

        res.description = pgnData.Description
        ;(res as any).id = pgnData.Id
      }

      res.pgn = pgn.pgn
      res.src = pgn.src
      res.dst = pgn.dst
      res.prio = pgn.prio

      const apgn = pgn as any
      /*
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
      */
      if (apgn.input !== undefined) {
        ;(res as any).input = apgn.input
      }

      if (apgn.partialMatch !== undefined) {
        ;(res as any).partialMatch = apgn.partialMatch
      }

      if (this.options.includeRawData) {
        ;(res as any).rawData = Array.from(
          bs.view.buffer.subarray(0, bs.length)
        )
      }
      if (this.options.includeByteMapping) {
        ;(res as any).byteMapping = (pgn as any).byteMapping
      }

      // Stringify timestamp because SK Server needs it that way.
      const ts = _.get(pgn, 'timestamp', new Date())
      if (_.isDate(ts) && Number.isFinite(ts.getTime())) {
        res.timestamp = ts.toISOString()
      } else if (typeof ts === 'string' && !isNaN(new Date(ts).getTime())) {
        res.timestamp = ts
      } else {
        // Non-ISO timestamps from formats like candump (e.g. "(1502979132.106111)")
        // would otherwise propagate downstream and produce "Invalid Date" in
        // consumers. Fall back to current time.
        res.timestamp = new Date().toISOString()
      }
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
      }

      if (sourceString === undefined && this.options.includeInputData) {
        sourceString = encodeCandump2({
          ...pgn,
          data: buffer,
          bus: this.options.canBus || 'can0'
        })[0]
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
      const { data, error, ...pgn } = parseYDRAW(pgn_data)
      if (!error) {
        const bs = new BitStream(data)
        delete pgn.format
        const res = this._parse(pgn, bs, data.length, false, cb, pgn_data, true)
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
    // skip format-banner lines emitted by canboat tools since canboat#573
    if (pgn_data.startsWith('#')) {
      return
    }
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
      const rawFrame = RAW_FRAME_FORMATS.has(pgn.format)
      delete pgn.format
      delete pgn.type
      delete pgn.prefix
      const res = this._parse(
        pgn,
        bs,
        len || data.length,
        coalesced,
        cb,
        pgn_data,
        rawFrame
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

    if (
      name === undefined &&
      field.BitLength !== undefined &&
      field.BitLength > 1 &&
      isMax(field.BitLength, value, field.Signed as boolean)
    ) {
      // if is max value and there is no enum, return null
      return null
    }
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
  bs: BitStream
): [any, Field | undefined, ByteMapping | undefined] {
  let value
  let refField: Field | undefined = undefined
  let bm: ByteMapping | undefined = undefined

  const start = bs.index

  if (field.FieldType === 'DYNAMIC_FIELD_VALUE') {
    value = readDynamicFieldValue(pgn, options, bs)
    if (options.includeByteMapping) {
      bm = {
        bytes: Array.from(
          bs.view.buffer.subarray(start / 8, Math.ceil(bs.index / 8))
        ),
        value: value
      }
    }
    return [value, undefined, bm]
  }

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

      if (options.includeByteMapping) {
        bm = {
          bytes: Array.from(
            bs.view.buffer.subarray(start / 8, Math.ceil(bs.index / 8))
          )
        }
      }

      return [null, undefined, bm]
    }
    ;[value, refField] = readValue(definition, options, pgn, field, bs)
    if (
      field.FieldType === 'DYNAMIC_FIELD_KEY' ||
      field.FieldType === 'DYNAMIC_FIELD_LENGTH'
    ) {
      noteDynamicField(pgn, field, value)
    }
  }

  if (options.includeByteMapping) {
    bm = {
      bytes: Array.from(
        bs.view.buffer.subarray(start / 8, Math.ceil(bs.index / 8))
      ),
      value: value
    }
  }

  if (refField === undefined) {
    return [
      convertField(field, value, runPostProcessor, options, pgn),
      undefined,
      bm
    ]
  } else {
    return [value, refField, bm]
  }
}

function convertField(
  field: Field,
  value: any,
  runPostProcessor: boolean,
  options: any,
  pgn: PGN
): any {
  if (value != null && value !== undefined) {
    const type = field.FieldType //hack, missing type
    const postProcessor = fieldTypePostProcessors[type]
    if (postProcessor) {
      if (runPostProcessor) {
        value = postProcessor(field, value, { pgn, options })
      }
    } else {
      // canboat's Offset is in the field's own units (after Resolution),
      // so compare the raw value against the raw equivalent of RangeMax.
      const offset = field.Offset ? Number(field.Offset) : 0
      const si = siConversion(field.Unit, (field as any).PhysicalQuantity)
      let max
      if (typeof field.RangeMax !== 'undefined' && field.Resolution) {
        max = (field.RangeMax - offset) / Number(field.Resolution)
      }
      // Below RangeMin is no reading either (a latitude of -111, #393).
      // RangeMin need not be a whole number of steps (-pi at 0.0001), so
      // the nearest raw value still counts as in range.
      let min
      if (typeof field.RangeMin !== 'undefined' && field.Resolution) {
        min = Math.round(
          (Number(field.RangeMin) - offset) / Number(field.Resolution)
        )
      }
      if (
        options.checkForInvalidFields !== false &&
        (max !== undefined || min !== undefined) &&
        field.FieldType !== 'LOOKUP' &&
        field.FieldType !== 'DYNAMIC_FIELD_KEY' &&
        field.FieldType !== 'PGN' &&
        field.BitLength !== undefined &&
        field.BitLength > 1 &&
        ((max !== undefined && max - value < 0) ||
          (min !== undefined && value - min < 0))
      ) {
        //console.log(`Bad field ${field.Name} ${max - value}`)
        value = null
      }
      if (typeof value === 'number' && (field.Resolution || si !== undefined)) {
        // In SI, as canboat's fixupUnit scales the resolution, with the
        // decimals canboat gives it; both worked out once per field. The
        // Offset is in the database's unit, so it is converted alike.
        const { resolution, decimals } = scaleOf(field as any)
        const siOffset = si !== undefined ? (offset * si.mul) / si.div : offset
        value = roundToDecimals(value * resolution + siOffset, decimals)
      } else if (offset && typeof value === 'number') {
        value += offset
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
    }
  }
  // Numeric fields must never emit NaN: downstream consumers (e.g. databases
  // doing BigInt(value * 1e9) for nanosecond conversion) will throw on NaN
  // but handle null. Treat NaN the same as an out-of-range / invalid value.
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null
  }
  return value
}

function readValue(
  definition: Definition,
  options: any,
  pgn: PGN,
  field: Field,
  bs: BitStream,
  bitLength: number | undefined = undefined
): [any, Field | undefined] {
  if (field.FieldType == 'VARIABLE') {
    return readVariableLengthField(definition, options, pgn, field, bs)
  } else if (field.FieldType === 'DECIMAL') {
    // DECIMAL: each byte holds two decimal digits (00-99). Emit as a digit
    // string to preserve leading zeros (e.g. coast-station identities).
    // All-0xFF (or any byte > 99) => not available. Used by PGN 129808 (DSC).
    const actualBitLength =
      bitLength === undefined ? field.BitLength : bitLength
    // Guard against truncated packets: this block runs outside the try/catch
    // that protects the other field types, so an underflow here would throw.
    if (actualBitLength === undefined || bs.bitsLeft < actualBitLength) {
      return [null, undefined]
    }
    const nbytes = Math.floor(actualBitLength / 8)
    let s = ''
    // Any byte > 99 (which includes 0xFF) marks the whole field as unavailable.
    // Use a latching flag that never resets, so a valid byte after an invalid
    // one cannot mask it (e.g. [0xFF, 0x12] must yield null, not "25518").
    let isValid = true
    for (let i = 0; i < nbytes; i++) {
      const b = bs.readUint8()
      if (b > 99) isValid = false
      s += String(b).padStart(2, '0')
    }
    // Consume any non-byte-aligned remainder so downstream fields stay aligned.
    const remainder = actualBitLength % 8
    if (remainder > 0) {
      bs.readBits(remainder, false)
    }
    return isValid ? [s, undefined] : [null, undefined]
  } else {
    let value
    if (bitLength === undefined) {
      bitLength = field.BitLength

      if (bitLength === undefined) {
        //FIXME?? error? mesg? should never happen
        return [null, undefined]
      }
    }
    // J1939 Excess-K notation: a Signed field with an Offset holds an
    // unsigned raw value, the offset making it signed (canboat's
    // extractNumber), so it is read unsigned at any width.
    const excessK = !!field.Signed && !!field.Offset
    const signed = !!field.Signed && !excessK
    try {
      if (
        field.FieldType === FieldType.Binary &&
        definition.Fallback === true
      ) {
        bitLength = bs.bitsLeft < bitLength ? bs.bitsLeft : bitLength
        const data = bs.readArrayBuffer(Math.floor(bitLength / 8))
        return [byteString(Buffer.from(data), ' '), undefined]
      } else if (bitLength === 8) {
        if (signed) {
          value = bs.readInt8()
          value = value === 0x7f ? null : value
        } else {
          value = bs.readUint8()
          value = value === 0xff ? null : value
        }
      } else if (bitLength == 16) {
        if (signed) {
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

        if (signed) {
          // Check if the sign bit (bit 23) is set
          if (value & 0x800000) {
            // Convert to signed 24-bit value by sign extending
            value = value - 0x1000000
          }
          value = value === 0x7fffff ? null : value
        } else {
          value = value === 0xffffff ? null : value
        }

        //debug(`value ${value.toString(16)}`)
      } else if (bitLength == 32) {
        if (signed) {
          value = bs.readInt32()
          value = value === 0x7fffffff ? null : value
        } else {
          value = bs.readUint32()
          value = value === 0xffffffff ? null : value
        }
      } else if (bitLength == 48) {
        const a = bs.readUint32()
        const b = bs.readUint16()

        if (signed) {
          value = a == 0xffffffff && b == 0x7fff ? null : new Int64LE(b, a)
        } else {
          value = a == 0xffffffff && b == 0xffff ? null : new Int64LE(b, a)
        }
      } else if (bitLength == 64) {
        const x = bs.readUint32()
        const y = bs.readUint32()

        if (signed) {
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
        value = bs.readBits(bitLength, signed)
        if (
          field.FieldType !== 'LOOKUP' &&
          bitLength > 1 &&
          isMax(bitLength, value, signed)
        ) {
          const fullRange =
            //field.FieldType !== 'LOOKUP' &&
            field.RangeMax !== undefined &&
            field.Resolution &&
            field.RangeMax / field.Resolution >= (1 << bitLength) - 1
          if (!fullRange) {
            value = null
          }
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

    // The values above an Excess-K field's range are its "not available",
    // "error" and reserved codes, as canboat has them: not readings, even
    // when the range is not otherwise checked. Up to 48 bits the raw value
    // is exact as a number; like canboat (range_max_sentinel), 64-bit
    // fields are not checked.
    if (excessK && value != null && field.RangeMax !== undefined) {
      const raw =
        typeof value === 'number'
          ? value
          : bitLength === 48
            ? Number(value.toString())
            : undefined
      if (
        raw !== undefined &&
        raw >
          Math.round(
            (Number(field.RangeMax) - Number(field.Offset)) /
              Number(field.Resolution ?? 1)
          )
      ) {
        value = null
      }
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

/*
 * The 8-bit string readers below follow canboat's Rust decoder
 * (crates/canboat/src/engine/decode.rs) exactly: the same charset decision,
 * the same padding bytes, the same trim order per field type, and an empty
 * result is "not available" (null).
 */

/**
 * The bytes canboat strips off the end of a string field: 0xff (the NMEA 2000
 * filler), NUL, '@' (badly converted AIS text) and ASCII whitespace -- the
 * whole C isspace() set, so Navico's newline-terminated 130847 text is trimmed
 * too. canboat's `is_string_padding`.
 */
const isStringPadding = (b: number): boolean =>
  b === 0xff ||
  b === 0x00 ||
  b === 0x40 ||
  b === 0x20 ||
  (b >= 0x09 && b <= 0x0d)

/** The length of `bytes` once its trailing padding run is dropped. */
const unpaddedLength = (bytes: Buffer, len: number = bytes.length): number => {
  while (len > 0 && isStringPadding(bytes[len - 1])) {
    len--
  }
  return len
}

/**
 * Strip trailing padding from decoded text. 0xff survives as U+00FF when the
 * bytes came through the Latin-1 path. canboat's `trim_string_padding`.
 */
const trimStringPadding = (s: string): string => {
  let end = s.length
  while (end > 0) {
    const c = s.charCodeAt(end - 1)
    if (c === 0xff || (c < 0x80 && isStringPadding(c))) {
      end--
    } else {
      break
    }
  }
  return s.substring(0, end)
}

/**
 * Decode a run of 8-bit string bytes into text.
 *
 * NMEA 2000 leaves the meaning of a byte >= 0x80 undefined in an 8-bit string
 * field, and devices disagree. Captured on one bus: a Fusion sends UTF-8
 * (`c5 ab` = U+016B) while a B&G sends Latin-1 (`e6` = U+00E6) -- in the same
 * field type, under the same STRING_LAU control byte. So well-formed UTF-8 is
 * taken as UTF-8, and anything else is read in the field's declared
 * `Encoding` (RDS_G0 for Fusion's RDS text), defaulting to Latin-1, which maps
 * every byte to a codepoint and so cannot fail. UTF-8 is tried first even
 * when the field declares a charset, so a device that starts sending UTF-8
 * (RDS2 does) keeps decoding with no database change. canboat's
 * `decode_text`; see canboat/canboat#864.
 *
 * `Buffer.toString('utf8')` substitutes U+FFFD for malformed input rather than
 * failing, so the check is a round-trip: re-encoding the result reproduces the
 * original bytes only if they were valid UTF-8 to begin with.
 */
const decodeText = (bytes: Buffer, encoding?: string): string => {
  const utf8 = bytes.toString('utf8')
  if (Buffer.compare(Buffer.from(utf8, 'utf8'), bytes) === 0) {
    return utf8
  }
  if (encoding === 'RDS_G0') {
    return Array.from(bytes, rdsG0Char).join('')
  }
  return bytes.toString('latin1')
}

/** The Encoding a field declares, which ts-pgns types may not know yet. */
const fieldEncoding = (field: Field): string | undefined =>
  (field as any).Encoding

/** Read up to `len` whole bytes, stopping early if the data runs out. */
const readBytes = (bs: BitStream, len: number): Buffer => {
  const buf = Buffer.alloc(len)
  let idx = 0
  for (; idx < len && bs.bitsLeft >= 8; idx++) {
    buf[idx] = bs.readUint8()
  }
  return buf.subarray(0, idx)
}

fieldTypeReaders[
  'STRING_LAU'
  //'ASCII or UNICODE string starting with length and control byte'
] = (pgn, field, bs) => {
  if (bs.bitsLeft < 16) {
    return null
  }
  const total = bs.readUint8()
  const control = bs.readUint8()
  if (total < 2) {
    return null
  }
  const body = readBytes(bs, total - 2)

  let s: string
  if (control === 0) {
    // UTF-16LE: pairs of bytes are little-endian code units; an odd trailing
    // byte is dropped and a lone surrogate becomes U+FFFD, as Rust's
    // from_utf16_lossy does. Not trimmed as bytes: the NUL high half of an
    // ASCII glyph is not padding.
    s = body.subarray(0, body.length & ~1).toString('utf16le')
    s = (s as any).toWellFormed ? (s as any).toWellFormed() : s
  } else {
    // 1 = ASCII / UTF-8. A control byte of 0xff marks an unset field whose
    // body is 0xff filler (the H5000 pilot in 126998): trim the padding off
    // the raw bytes first, so it collapses to nothing rather than to text.
    s = decodeText(body.subarray(0, unpaddedLength(body)), fieldEncoding(field))
  }
  const trimmed = trimStringPadding(s)
  return trimmed.length > 0 ? trimmed : null
}

fieldTypeReaders[
  'STRING_LZ'
  //'ASCII string starting with length byte'
] = (pgn, field, bs) => {
  if (bs.bitsLeft < 8) {
    return null
  }
  // A fixed-width field (BitLength) caps the content to its own bytes; a
  // variable one runs to the end of the data. The length byte counts the
  // content only.
  const region =
    field.BitLength !== undefined
      ? field.BitLength / 8
      : Math.floor(bs.bitsLeft / 8)
  const len = bs.readUint8()
  const content = readBytes(bs, Math.min(len, region - 1))
  if (field.BitLength !== undefined) {
    // Consume the rest of the fixed-width field.
    readBytes(bs, region - 1 - content.length)
  }
  const trimmed = trimStringPadding(decodeText(content, fieldEncoding(field)))
  return trimmed.length > 0 ? trimmed : null
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
    return decodeText(buf.subarray(0, idx))
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
    return decodeText(buf.subarray(0, idx))
  }
}

// An IEEE-754 single. NMEA 2000 sends a FLOAT that is not available as a
// NaN (canboat's decode_float).
fieldTypeReaders['FLOAT'] = (pgn, field, bs) => {
  if (bs.bitsLeft < 32) {
    bs.readBits(bs.bitsLeft, false)
    return null
  }
  const value = bs.readFloat32()
  return Number.isNaN(value) ? null : value
}

fieldTypeReaders['STRING_FIX'] = (pgn, field, bs) => {
  // The declared width is a maximum: Navico's 130821 sends however much text
  // it has, so read what is there.
  const raw = readBytes(bs, (field.BitLength as number) / 8)
  // Cut at the first NUL (a C string inside a fixed buffer, e.g. Raymarine
  // and Mastervolt), then trim the padding before it.
  const nul = raw.indexOf(0)
  const len = unpaddedLength(raw, nul === -1 ? raw.length : nul)
  if (len === 0) {
    return null
  }
  return decodeText(raw.subarray(0, len), fieldEncoding(field))
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

/*
 * DYNAMIC_FIELD_KEY / DYNAMIC_FIELD_LENGTH / DYNAMIC_FIELD_VALUE, as canboat
 * decodes them (decode_dynamic_field_key, decode_dynamic_field_length and
 * decode_dynamic_field_value in canboat's engine/decode.rs).
 *
 * The key resolves to an entry of the field's LookupFieldTypeEnumeration,
 * which gives the value its type, width, resolution and unit; the length,
 * when the PGN has one, gives its width in bytes on the wire and wins over
 * the entry's. Both are noted per message and taken by the value, so a
 * repeating set of key/length/value records decodes each record against its
 * own key.
 */

// The entry type as canboat.json carries it; ts-pgns' EnumFieldTypeValue
// declares only part of it.
type DynamicFieldType = {
  name: string
  value: number
  FieldType: string
  Bits: string
  Signed?: boolean
  Resolution?: number
  Unit?: string
  LookupEnumeration?: string
}

type DynamicFieldContext = {
  entry?: DynamicFieldType
  lengthBytes?: number
}

const dynamicFieldContexts = new WeakMap<PGN, DynamicFieldContext>()

const dynamicFieldTypes = new Map<string, Map<number, DynamicFieldType>>()

function dynamicFieldType(
  enumName: string,
  value: number
): DynamicFieldType | undefined {
  let entries = dynamicFieldTypes.get(enumName)
  if (entries === undefined) {
    entries = new Map()
    const values = getFieldTypeEnumeration(enumName)?.EnumFieldTypeValues ?? []
    for (const v of values as DynamicFieldType[]) {
      entries.set(v.value, v)
    }
    dynamicFieldTypes.set(enumName, entries)
  }
  return entries.get(value)
}

/** Note what a DYNAMIC_FIELD_KEY or DYNAMIC_FIELD_LENGTH tells the value. */
function noteDynamicField(pgn: PGN, field: Field, value: any) {
  let ctx = dynamicFieldContexts.get(pgn)
  if (ctx === undefined) {
    ctx = {}
    dynamicFieldContexts.set(pgn, ctx)
  }
  if (field.FieldType === 'DYNAMIC_FIELD_KEY') {
    ctx.entry =
      typeof value === 'number' && field.LookupFieldTypeEnumeration
        ? dynamicFieldType(field.LookupFieldTypeEnumeration, value)
        : undefined
    return
  }
  // A length that is a sentinel cannot size the value.
  const f = field as Field & {
    UnknownValue?: number
    OutOfRangeValue?: number
    ReservedValue?: number
    DynamicFieldLengthOverhead?: number
  }
  if (
    typeof value !== 'number' ||
    value === f.UnknownValue ||
    value === f.OutOfRangeValue ||
    value === f.ReservedValue
  ) {
    return
  }
  // The length may also count a per-record header between it and the
  // value (Navico 130822/130823: a class byte and a 16-bit data type).
  ctx.lengthBytes = value - (f.DynamicFieldLengthOverhead ?? 0)
}

/**
 * Read a DYNAMIC_FIELD_VALUE. Returns undefined when the field is left out:
 * an explicit length of zero, or a value the message ends in the middle of
 * (how a device ends a repeating list it could not fit).
 */
function readDynamicFieldValue(pgn: PGN, options: any, bs: BitStream): any {
  const { entry, lengthBytes } = dynamicFieldContexts.get(pgn) ?? {}
  dynamicFieldContexts.delete(pgn)

  if (lengthBytes === 0) {
    return undefined
  }
  const remaining = bs.bitsLeft
  let bits =
    lengthBytes !== undefined
      ? lengthBytes * 8
      : entry !== undefined
        ? Number(entry.Bits)
        : 0
  if (bits < 0) {
    // A length below the record's own header: the rest of the message.
    return readDynamicBinary(bs, remaining)
  }
  const end = bs.index + remaining
  if (Math.floor(end / 8) < Math.floor((bs.index + bits) / 8)) {
    bs.readBits(remaining % 8, false)
    bs.readArrayBuffer(Math.floor(remaining / 8))
    return undefined
  }
  if (bits > remaining) {
    // Ends inside the last, partly used byte: nothing to decode.
    bs.readBits(remaining, false)
    return null
  }
  if (entry === undefined) {
    // No type to decode against. Without a length either, the value is
    // the rest of the message (PGN 130845 with a key it does not know).
    if (bits === 0 && lengthBytes === undefined) {
      bits = remaining
    }
    return readDynamicBinary(bs, bits)
  }

  const type = entry.FieldType
  if (
    type.startsWith('NUMBER') ||
    type.startsWith('FIX') ||
    type.startsWith('UFIX')
  ) {
    const signed = entry.Signed === true || type.startsWith('FIX')
    const raw = readDynamicBits(bs, bits, signed)
    return isDynamicSentinel(raw, bits, signed)
      ? null
      : scaleDynamicNumber(raw, entry)
  }
  if (type === 'LOOKUP') {
    const raw = readDynamicBits(bs, bits, false)
    if (!entry.LookupEnumeration) {
      return readDynamicBinaryValue(raw, bits)
    }
    const name = getEnumerationName(entry.LookupEnumeration, raw)
    if (name === undefined) {
      // An unnamed value in the top of the range is not available, as for
      // any lookup (canboat's fieldPrintLookup).
      const band = bits > 2 ? 2 : 1
      if (bits > 1 && raw >= 2 ** bits - 1 - band) {
        return null
      }
      return raw
    }
    return _.isUndefined(options.resolveEnums) || options.resolveEnums
      ? name
      : raw
  }
  if (type === 'DURATION' || type === 'TIME') {
    const signed =
      entry.Signed === true ||
      entry.name === 'Race Timer' ||
      entry.name === 'Timezone offset'
    const raw = readDynamicBits(bs, bits, signed)
    if (isDynamicSentinel(raw, bits, signed)) {
      return null
    }
    // Seconds, as canboat gives a TIME or DURATION in JSON
    // (canboat/canboat#967): a Race Timer of -300000 ms is -300.
    return roundToDecimals(
      raw * (entry.Resolution ?? 1),
      timeDecimalsFor(entry.Resolution)
    )
  }
  if (type === 'DATE') {
    const raw = readDynamicBits(bs, bits, false)
    const date = new Date(raw * 86400 * 1000)
    return `${date.getUTCFullYear()}.${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`
  }
  if (type === 'ISO_NAME' && bits === 64) {
    const lo = readDynamicBits(bs, 32, false)
    const hi = readDynamicBits(bs, 32, false)
    // A NAME reserves its top two values.
    if (hi === 0xffffffff && lo >= 0xfffffffe) {
      return null
    }
    return hi * 2 ** 32 + lo
  }
  return readDynamicBinary(bs, bits)
}

/**
 * Whether a dynamic number or duration is one of the top-of-range values
 * a field of its width reserves (not available, out of range, reserved),
 * as canboat's dynamic_sentinel: an unstarted B&G Trip 2 Time
 * (0xffffffff) is not a time.
 */
function isDynamicSentinel(raw: number, bits: number, signed: boolean) {
  const reserved = bits >= 8 ? 3 : bits >= 4 ? 2 : bits >= 2 ? 1 : 0
  const max = 2 ** (signed ? bits - 1 : bits) - 1
  return raw > max - reserved
}

/** Read up to 32 bits, or the low 53 of a wider value, as a number. */
function readDynamicBits(bs: BitStream, bits: number, signed: boolean): number {
  if (bits <= 32) {
    return bits === 0 ? 0 : bs.readBits(bits, signed)
  }
  const lo = bs.readBits(32, false) >>> 0
  const hi = bs.readBits(bits - 32, signed)
  return hi * 2 ** 32 + lo
}

function readDynamicBinaryValue(raw: number, bits: number): string {
  const bytes: number[] = []
  for (let i = 0; i < Math.ceil(bits / 8); i++) {
    bytes.push(Math.floor(raw / 2 ** (8 * i)) & 0xff)
  }
  return byteString(Buffer.from(bytes), ' ')
}

function readDynamicBinary(bs: BitStream, bits: number): string | null {
  const bytes = Math.floor(bits / 8)
  const data = Buffer.from(bs.readArrayBuffer(bytes))
  if (bits % 8 > 0) {
    bs.readBits(bits % 8, false)
  }
  return bytes > 0 ? byteString(data, ' ') : null
}

function scaleDynamicNumber(raw: number, entry: DynamicFieldType): number {
  const resolution = entry.Resolution ?? 1
  if (resolution === 1 && entry.Unit === undefined) {
    return raw
  }
  // In SI, as for any other field. A key's entry names no physical
  // quantity, so its degrees stay degrees, as in canboat.
  const scale = scaleOf(entry)
  return roundToDecimals(raw * scale.resolution, scale.decimals)
}

fieldTypePostProcessors['DATE'] = (field, value, context) => {
  if (value >= 0xfffd) {
    value = undefined
  } else {
    // The wire value is a day count since 1970-01-01, so any quirk that
    // shifts the date does it here, in whole days, before the date is
    // ever formatted.
    if (context !== undefined) {
      const gpsRollover = quirksOf(context.options)?.gpsRollover
      if (gpsRollover) {
        value = gpsRollover.correctDate(context.pgn, value)
      }
    }
    const date = new Date(value * 86400 * 1000)
    //const date = moment.unix(0).add(value+1, 'days').utc().toDate()
    value = `${date.getUTCFullYear()}.${pad2(date.getUTCMonth() + 1)}.${pad2(date.getUTCDate())}`
  }
  return value
}

/**
 * A TIME (of day) or DURATION is a number of seconds, as canboat gives it
 * in JSON (canboat/canboat#967): System Time 09:10:20.2240 is 33020.224,
 * a Race Timer of -300000 ms is -300.
 */
fieldTypePostProcessors['TIME'] = (field, value) => {
  if (value >= 0xfffffffd) {
    return undefined
  }
  return roundToDecimals(
    value * (field.Resolution ?? 1),
    timeDecimalsFor(field.Resolution)
  )
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

/**
 * An MMSI is a 9-digit string, leading zeros kept (a coast station is
 * 00MIDxxxx), as canboat prints it. 0 is no station's MMSI -- its MID, 000,
 * is not assigned -- and devices send it for "none", so it is not
 * available, like the three reserved top values. canboat's decode_mmsi.
 */
// A FLOAT in SI, through its resolution and unit like a number, with the
// six significant digits canboat prints it with (%g) rather than rounded
// to a count of its resolution.
fieldTypePostProcessors['FLOAT'] = (field, value) => {
  let resolution = Number(field.Resolution ?? 1)
  const si = siConversion(field.Unit, (field as any).PhysicalQuantity)
  if (si !== undefined) {
    resolution = (resolution * si.mul) / si.div
  }
  return Number.parseFloat((value * resolution).toPrecision(6))
}

fieldTypePostProcessors['MMSI'] = (field, value) => {
  if (value === 0 || value >= 0xfffffffd) {
    return null
  }
  return value.toString().padStart(9, '0')
}

const unknownDef = (pgn: number) => {
  return {
    PGN: pgn,
    Id: 'unknown',
    Description: 'Unknown PGN',
    Type: Type.Single,
    Complete: false,
    Priority: 3,
    Fields: []
  }
}

class PGN_Unknown extends PGN {
  private definition: Definition
  constructor(fields: any, definition: Definition) {
    super({})
    this.fields = fields
    this.definition = definition
  }

  getDefinition(): Definition {
    return this.definition
  }
}
