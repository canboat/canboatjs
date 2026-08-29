import { Parser } from './fromPgn'
import { Quirk, correctedGpsDate, GPS_ROLLOVER_DAYS } from './quirks'

/** Days since 1970-01-01 for a date, so expectations read as dates. */
function day(iso: string): number {
  return Math.round(Date.parse(iso + 'T00:00:00Z') / (86400 * 1000))
}

/**
 * A canboat PLAIN line for PGN 126992 System Time with the given
 * source (low nibble of byte 2) and raw date.
 */
function systemTimeString(source: number, date: number): string {
  const bytes = [
    0x36,
    0xf0 | source,
    date & 0xff,
    date >> 8,
    0x10,
    0x6d,
    0xff,
    0x19
  ]
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join(',')
  return `2026-08-29-12:00:00.000,3,126992,12,255,8,${hex}`
}

function parseDate(input: string, quirks: string[]): string {
  const parser = new Parser({ quirks })
  const pgn: any = parser.parseString(input)
  return pgn.fields.date
}

describe('GPS week rollover', () => {
  // The parser takes its reference day from the clock, so pin the
  // clock rather than write expectations that expire.
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['performance'] })
    jest.setSystemTime(new Date('2026-08-29T12:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  test('a receiver an epoch behind is corrected', () => {
    // The example from SignalK/n2k-signalk#271: the string arithmetic
    // there lands on 2022-07-03, a day short.
    expect(correctedGpsDate(day('2002-11-18'), day('2022-07-04'))).toBe(
      day('2022-07-04')
    )
  })

  test('a receiver two epochs behind is corrected', () => {
    // Never handled the 1999 rollover either.
    const reference = day('2026-08-29')
    expect(correctedGpsDate(reference - 2 * GPS_ROLLOVER_DAYS, reference)).toBe(
      reference
    )
  })

  test('a current date is left alone', () => {
    const reference = day('2026-08-29')
    expect(correctedGpsDate(reference, reference)).toBe(reference)
    expect(correctedGpsDate(reference - 30, reference)).toBe(reference - 30)
  })

  test('a merely old date is left alone', () => {
    // Under half an epoch back is not a rollover artefact, so it must
    // not be snapped forward.
    const reference = day('2026-08-29')
    expect(correctedGpsDate(day('2017-08-29'), reference)).toBe(
      day('2017-08-29')
    )
  })

  test('the sentinel range is never entered', () => {
    const late = 0xfffc - 100
    expect(correctedGpsDate(late, 0xffff)).toBe(late)
  })

  test('the quirk is off unless asked for', () => {
    const rolled = day('2026-08-29') - GPS_ROLLOVER_DAYS
    expect(parseDate(systemTimeString(0, rolled), [])).toBe('2007.01.13')
  })

  test('system time is corrected for a GPS source', () => {
    const rolled = day('2026-08-29') - GPS_ROLLOVER_DAYS
    expect(parseDate(systemTimeString(0, rolled), [Quirk.GpsRollover])).toBe(
      '2026.08.29'
    )
  })

  test('system time from a local clock is left alone', () => {
    // Source 5 = Local Crystal clock: not a GNSS receiver.
    const rolled = day('2026-08-29') - GPS_ROLLOVER_DAYS
    expect(parseDate(systemTimeString(5, rolled), [Quirk.GpsRollover])).toBe(
      '2007.01.13'
    )
  })
})
