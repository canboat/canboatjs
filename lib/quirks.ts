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
 * decoding. The same names canboat uses for its own `--quirk` flag.
 *
 * Every quirk is off by default: each one will happily "correct" data
 * that was never wrong, which is what happens when you replay an old
 * capture. Switch one on by name:
 *
 *     new Parser({ quirks: [Quirk.GpsRollover] })
 */

import { PGN } from '@canboat/ts-pgns'

export enum Quirk {
  /**
   * Correct GNSS dates from a receiver that never learned about the GPS
   * 1024-week rollover and reports one or two epochs in the past.
   */
  GpsRollover = 'gps-rollover'
}

/** One GPS rollover epoch: 1024 weeks, in days. */
export const GPS_ROLLOVER_DAYS = 7168

/**
 * Largest day count that is still a date rather than a sentinel
 * (0xfffd..0xffff are Unknown / Out of range / Reserved) — 2149-06-03.
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

const MS_PER_DAY = 86400 * 1000

/** PGNs whose date comes from a GNSS receiver on our own bus. */
const PGN_GNSS_POSITION_DATA = 129029
const PGN_TIME_AND_DATE = 129033
const PGN_SYSTEM_TIME = 126992

export function isEnabled(options: any, quirk: Quirk): boolean {
  return options?.quirks !== undefined && options.quirks.indexOf(quirk) !== -1
}

/** Today as days since 1970-01-01, floored at MIN_REFERENCE_DAY. */
function referenceDay(): number {
  return Math.max(Math.floor(Date.now() / MS_PER_DAY), MIN_REFERENCE_DAY)
}

/**
 * Snap a date (days since 1970-01-01) to the GPS rollover epoch nearest
 * `reference`.
 *
 * The GPS week number is 10 bits counted from the 1980-01-06 epoch, so
 * it wraps every 1024 weeks: 1999-08-22, 2019-04-07, and next on
 * 2038-11-21. A receiver resolves the wrap by carrying a base week from
 * its firmware build date; one that was never updated keeps a base that
 * is one — or, if it also missed 1999, two — epochs stale. Snapping to
 * the nearest epoch is what the receiver's own base-week logic does, so
 * it covers the doubly-stale case and the 2038 rollover without a code
 * change.
 *
 * Returns the date unchanged when it is already within half an epoch of
 * the reference, and when the correction would run into the sentinels.
 * Working in whole days on the raw field keeps this exact — going via a
 * formatted date string and local-time day arithmetic loses a day
 * across a DST boundary.
 */
export function correctedGpsDate(
  days: number,
  reference: number = referenceDay()
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

/**
 * Apply the GPS rollover quirk to one DATE field, if it is on and this
 * is a date a GNSS receiver produced.
 *
 * Only 129029 GNSS Position Data, 129033 Time & Date and 126992 System
 * Time when its source is GPS are corrected. The AIS reports carry
 * another station's clock, and the remaining DATE fields in the
 * database (Maretron counters, route database entries, station data)
 * are not receiver clocks at all.
 */
export function correctDate(pgn: PGN, days: number, options: any): number {
  if (!isEnabled(options, Quirk.GpsRollover)) {
    return days
  }

  switch (pgn?.pgn) {
    case PGN_GNSS_POSITION_DATA:
    case PGN_TIME_AND_DATE:
      break

    case PGN_SYSTEM_TIME: {
      // GLONASS counts weeks from its own epoch; radio station and the
      // local cesium/rubidium/crystal clocks do not roll over at all.
      // The Source field precedes the Date, so it is already decoded —
      // as a name when enums are resolved, as its value when not.
      const fields = pgn.fields as any
      const source =
        fields?.source !== undefined ? fields.source : fields?.Source
      if (source !== 'GPS' && source !== 0) {
        return days
      }
      break
    }

    default:
      return days
  }

  return correctedGpsDate(days)
}
