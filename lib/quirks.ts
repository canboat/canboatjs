/**
 * Copyright 2026 Scott Bender (scott@scottbender.net)
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

/**
 * Opt-in corrections for known device misbehaviour, applied while
 * decoding. The same names and syntax as canboat's own `--quirk` flag,
 * and the same behaviour: this is a port of canboat's
 * crates/canboat/src/engine/quirk.rs and cli/quirk.rs.
 *
 * Every quirk is off by default: each one will happily "correct" data
 * that was never wrong, which is what happens when you replay an old
 * capture. Switch one on by name:
 *
 *     new Parser({ quirks: ['gps-rollover'] })
 *     new Parser({ quirks: ['gps-rollover=4,1851:491603'] })
 *
 * ## GPS week rollover
 *
 * The GPS week number is 10 bits counted from the 1980-01-06 epoch, so
 * it wraps every 1024 weeks (7168 days): 1999-08-22, 2019-04-07, and
 * next on 2038-11-21. A receiver resolves the wrap by carrying a base
 * week from its firmware build date; one that was never updated keeps
 * using a base that is now one (or, for a receiver that also missed
 * 1999, two) epochs stale and reports dates that far in the past. Only
 * the week number wraps, so the time of day is unaffected and the
 * correction is a whole number of epochs.
 *
 * With no device list (`gps-rollover`), only dates that a GNSS receiver
 * produced are touched: PGN 129029, 129033, and 126992 when its Source
 * is GPS. Those are the only DATE fields whose origin the PGN itself
 * tells us.
 *
 * Any other device that takes its clock from the bus -- a DSC VHF
 * stamping PGN 129808 Date of Receipt, a converter relaying System Time
 * -- repeats the wrong date, and nothing in *those* PGNs says where the
 * clock came from. So the quirk also takes a list of devices
 * (`gps-rollover=4,1851:491603`, or `gps-rollover=all`): every DATE field
 * in every PGN from a listed device is corrected, on top of the GNSS
 * rule, except the ones a device does not stamp from its own clock --
 * the AIS reports 129793 / 129794, which relay another station's
 * transmission, and 127258 Age of Service, which is the date of the
 * variation model.
 */

import { PGN } from '@canboat/ts-pgns'

export enum Quirk {
  /**
   * Correct GNSS dates from a receiver that never learned about the GPS
   * 1024-week rollover and reports one or two epochs in the past. Takes
   * an optional device list: `gps-rollover=<device>[,<device>...]` or
   * `gps-rollover=all`.
   */
  GpsRollover = 'gps-rollover'
}

/** One GPS rollover epoch: 1024 weeks, in days. */
export const GPS_ROLLOVER_DAYS = 7168

/**
 * Largest day count that is still a date rather than a sentinel
 * (0xfffd..0xffff are Unknown / Out of range / Reserved) -- 2149-06-03.
 */
const MAX_DATE_DAY = 0xfffc

/**
 * Floor for the reference day. A boat computer without an RTC comes up
 * believing it is 1970 and gets its clock *from* the GPS we are
 * correcting, so the system clock alone is not a usable reference.
 * 2026-01-01; snapping to the nearest epoch tolerates a reference that
 * is off by up to ~9.8 years, so this only needs revisiting long after
 * the 2038 rollover.
 */
const MIN_REFERENCE_DAY = 20454

/** The highest source address a device can claim. */
const MAX_DEVICE_ADDRESS = 251

const MS_PER_DAY = 86400 * 1000

/**
 * A device whose every date is stamped from a rolled-over clock: a
 * source address (0-251), the Manufacturer Code and Unique Number from
 * its ISO Address Claim, or its full 64-bit ISO NAME.
 */
export type Device =
  | { address: number }
  | { manufacturer: number; unique: number }
  | { name: bigint }

/**
 * Which dates the GPS rollover quirk corrects: only GNSS receiver dates
 * (`gps-rollover`), those plus every date from the listed devices, or
 * every date on the bus (`gps-rollover=all`).
 */
export type Target = 'gnss' | 'all' | Device[]

/** Rust's `str::parse::<uN>()`: an optional '+', then decimal digits. */
const parseUnsigned = (s: string, radix: 10 | 16): bigint | undefined => {
  const digits = s.startsWith('+') ? s.substring(1) : s
  const re = radix === 10 ? /^[0-9]+$/ : /^[0-9a-fA-F]+$/
  if (!re.test(digits)) {
    return undefined
  }
  return BigInt(radix === 10 ? digits : '0x' + digits)
}

/**
 * `4` -- a source address; `1851:491603` -- manufacturer code and unique
 * number; `0x00d6c8531b0bc7a3` -- a NAME in hex.
 */
export function parseDevice(input: string): Device {
  const s = input.trim()
  if (s.length === 0) {
    throw new Error('empty device')
  }
  if (s.startsWith('0x') || s.startsWith('0X')) {
    const name = parseUnsigned(s.substring(2), 16)
    if (name === undefined || name > 0xffffffffffffffffn) {
      throw new Error(`'${s}' is not a hexadecimal ISO NAME`)
    }
    // Zero is what the decoder stores for "no claim seen yet", and no
    // real device claims it.
    if (name === 0n) {
      throw new Error(`'${s}' is not a device's ISO NAME`)
    }
    return { name }
  }
  const colon = s.indexOf(':')
  if (colon !== -1) {
    const m = s.substring(0, colon)
    const u = s.substring(colon + 1)
    const manufacturer = parseUnsigned(m.trim(), 10)
    if (manufacturer === undefined || manufacturer >= 1n << 11n) {
      throw new Error(`'${m}' is not a manufacturer code (0-2047)`)
    }
    const unique = parseUnsigned(u.trim(), 10)
    if (unique === undefined || unique >= 1n << 21n) {
      throw new Error(`'${u}' is not a unique number (0-2097151)`)
    }
    return { manufacturer: Number(manufacturer), unique: Number(unique) }
  }
  const address = parseUnsigned(s, 10)
  if (address === undefined) {
    throw new Error(
      `'${s}' is not a device: use a source address, <manufacturer>:<unique ` +
        `number>, 0x<hex NAME>, or all`
    )
  }
  if (address > BigInt(MAX_DEVICE_ADDRESS)) {
    throw new Error(
      `'${s}' is not a source address (0-${MAX_DEVICE_ADDRESS}); to name a ` +
        `device by its NAME use <manufacturer>:<unique number> or 0x<hex NAME>`
    )
  }
  return { address: Number(address) }
}

/**
 * Parse the part after `gps-rollover=`: `undefined` for the bare flag,
 * otherwise `all` or a comma-separated list of devices.
 */
export function parseTarget(args: string | undefined): Target {
  if (args === undefined) {
    return 'gnss'
  }
  if (args.trim().toLowerCase() === 'all') {
    return 'all'
  }
  return args.split(',').map((d) => {
    if (d.trim().toLowerCase() === 'all') {
      throw new Error("'all' cannot be combined with a device list")
    }
    return parseDevice(d)
  })
}

/** Does `device` name the one sending from `src`, whose NAME is `name`? */
function deviceMatches(
  device: Device,
  src: number,
  name: bigint | undefined
): boolean {
  if ('address' in device) {
    return device.address === src
  }
  if ('name' in device) {
    return name === device.name
  }
  return (
    name !== undefined &&
    Number(name & 0x1fffffn) === device.unique &&
    Number((name >> 21n) & 0x7ffn) === device.manufacturer
  )
}

/** Is the device at `src` (NAME `name`) one `target` covers in full? */
function targetLists(
  target: Target,
  src: number,
  name: bigint | undefined
): boolean {
  if (target === 'gnss') {
    return false
  }
  if (target === 'all') {
    return true
  }
  return target.some((d) => deviceMatches(d, src, name))
}

/** Today as days since 1970-01-01. */
function today(): number {
  return Math.max(Math.floor(Date.now() / MS_PER_DAY), 0)
}

/**
 * Snap a date (days since 1970-01-01) to the GPS rollover epoch nearest
 * `reference`. Snapping to the nearest epoch is what the receiver's own
 * base-week logic does, so it covers the doubly-stale case and the 2038
 * rollover without a code change.
 *
 * Returns the date unchanged when it is already within half an epoch of
 * the reference, and when the correction would run into the sentinels.
 * Working in whole days on the raw field keeps this exact.
 */
export function correctedGpsDate(
  days: number,
  reference: number = Math.max(today(), MIN_REFERENCE_DAY)
): number {
  const behind = Math.max(reference - days, 0)
  const epochs = Math.floor(
    (behind + GPS_ROLLOVER_DAYS / 2) / GPS_ROLLOVER_DAYS
  )
  if (epochs === 0) {
    return days
  }
  const corrected = days + epochs * GPS_ROLLOVER_DAYS
  return corrected > MAX_DATE_DAY ? days : corrected
}

/** The GPS rollover quirk's live configuration for one parser. */
export class GpsRollover {
  /** Days since 1970-01-01 to snap towards. */
  readonly referenceDay: number
  readonly target: Target
  /**
   * ISO NAME per source address, learned from PGN 60928 as it goes by;
   * 0 means no claim seen yet. The NAME is the whole 8-byte payload, so
   * this needs no field decode.
   */
  private names: bigint[] = new Array(256).fill(0n)

  /**
   * The reference day comes from the system clock (floored at
   * 2026-01-01) when the quirk is switched on, unless given.
   */
  constructor(
    target: Target,
    referenceDay: number = Math.max(today(), MIN_REFERENCE_DAY)
  ) {
    this.target = target
    this.referenceDay = referenceDay
  }

  /** Remember the ISO NAME a PGN 60928 frame from `src` just claimed. */
  noteAddressClaim(src: number, payload: Uint8Array) {
    if (payload.length < 8 || src < 0 || src > 255) {
      return
    }
    const name = Buffer.from(
      payload.buffer,
      payload.byteOffset,
      8
    ).readBigUInt64LE(0)
    // A NAME lives at one address. If this device just moved, its old
    // slot must not keep matching whoever sends from there next before
    // that device's own claim goes by.
    for (let i = 0; i < this.names.length; i++) {
      if (this.names[i] === name) {
        this.names[i] = 0n
      }
    }
    this.names[src] = name
  }

  /** The NAME claimed from `src`, if a claim has been seen. */
  nameOf(src: number): bigint | undefined {
    const n = this.names[src]
    return n === undefined || n === 0n ? undefined : n
  }

  /**
   * Is `src` a device this quirk was told to correct in full -- listed
   * by address, or by a NAME whose claim has been seen, or covered by
   * `all`?
   */
  deviceListed(src: number): boolean {
    return targetLists(this.target, src, this.nameOf(src))
  }

  /**
   * The corrected value of a DATE field (`days` since 1970-01-01) in
   * `pgn`, whose fields before this one are already decoded.
   */
  correctDate(pgn: PGN, days: number): number {
    const src = pgn.src ?? -1
    const correct = targetLists(this.target, src, this.nameOf(src))
      ? // Everything this device stamps from its own clock -- which is
        // every date except the ones it merely relays.
        ![129793, 129794, 127258].includes(pgn.pgn)
      : isGnssReceiverDate(pgn)
    return correct ? correctedGpsDate(days, this.referenceDay) : days
  }
}

/**
 * PGN 126992 System Time `Source` value for GPS. GLONASS (1) counts
 * weeks from its own epoch and the remaining sources -- radio station,
 * local cesium / rubidium / crystal -- do not roll over at all.
 */
const SYSTEM_TIME_SOURCE_GPS = 0

/**
 * The dates the PGN itself tells us came from a GNSS receiver: 129029
 * GNSS Position Data, 129033 Time & Date, and 126992 System Time when
 * its Source is GPS. The Source field precedes the Date, so it is
 * already decoded -- as a name when enums are resolved, as its value
 * when not.
 */
function isGnssReceiverDate(pgn: PGN): boolean {
  switch (pgn.pgn) {
    case 129029:
    case 129033:
      return true
    case 126992: {
      const fields = pgn.fields as any
      const source =
        fields?.source !== undefined ? fields.source : fields?.Source
      return source === 'GPS' || source === SYSTEM_TIME_SOURCE_GPS
    }
    default:
      return false
  }
}

/** The decode-time quirks a parser was asked for. */
export type Quirks = { gpsRollover?: GpsRollover }

/**
 * Parse the `quirks` option: a list of `gps-rollover` or
 * `gps-rollover=<devices>` strings, as canboat's `--quirk` takes them (a
 * single string is taken as a list of one; null or undefined is none).
 * Throws on an unknown quirk or a malformed device list, as canboat
 * refuses the flag. A later `gps-rollover` replaces an earlier one.
 */
export function parseQuirks(quirks: unknown): Quirks {
  const res: Quirks = {}
  // No quirks; a single string is a one-quirk list. Anything else is
  // refused rather than silently ignored.
  if (quirks === undefined || quirks === null) {
    return res
  }
  if (typeof quirks === 'string') {
    quirks = [quirks]
  }
  if (!Array.isArray(quirks)) {
    throw new Error(
      `quirks must be a list of quirk strings, not ${typeof quirks}`
    )
  }
  for (const q of quirks) {
    const s = String(q)
    const eq = s.indexOf('=')
    const name = (eq === -1 ? s : s.substring(0, eq)).trim()
    const args = eq === -1 ? undefined : s.substring(eq + 1)
    if (name === Quirk.GpsRollover) {
      res.gpsRollover = new GpsRollover(parseTarget(args))
    } else {
      throw new Error(
        `unknown quirk '${name}'; the decode-time quirks are: gps-rollover`
      )
    }
  }
  return res
}
