import { Parser } from './fromPgn'
import {
  Quirk,
  correctedGpsDate,
  GPS_ROLLOVER_DAYS,
  parseDevice,
  parseQuirks,
  parseTarget
} from './quirks'

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

  test('a stale reference still corrects', () => {
    // Clockless host: reference stuck at the 2026 floor while the real
    // date is 2030 and the receiver is an epoch behind it.
    const realToday = day('2030-06-01')
    expect(
      correctedGpsDate(realToday - GPS_ROLLOVER_DAYS, day('2026-01-01'))
    ).toBe(realToday)
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

  test('a missing or malformed quirks option is not a quirks list', () => {
    // `quirks: null` used to reach indexOf() and throw.
    const rolled = day('2026-08-29') - GPS_ROLLOVER_DAYS
    const line = systemTimeString(0, rolled)
    for (const options of [{}, { quirks: null }, { quirks: undefined }]) {
      const pgn: any = new Parser(options as any).parseString(line)
      expect(pgn.fields.date).toBe('2007.01.13')
    }
  })

  test('system time from a local clock is left alone', () => {
    // Source 5 = Local Crystal clock: not a GNSS receiver.
    const rolled = day('2026-08-29') - GPS_ROLLOVER_DAYS
    expect(parseDate(systemTimeString(5, rolled), [Quirk.GpsRollover])).toBe(
      '2007.01.13'
    )
  })
})

// The tests below are ports of canboat's engine/quirk.rs and cli/quirk.rs
// tests, so both implementations are held to the same cases.

/**
 * The NAME of the DSC VHF from canboat/canboatjs#463: Raymarine (1851),
 * unique number 491603, function 190 Radiotelephone, class 70
 * Communication, marine industry group, arbitrary-address capable.
 */
const VHF_NAME =
  491603n |
  (1851n << 21n) |
  (190n << 40n) |
  (70n << 49n) |
  (4n << 60n) |
  (1n << 63n)

const hex = (bytes: number[]) =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join(',')

/** A PGN 60928 ISO Address Claim of `name` from `src`. */
function claimString(src: number, name: bigint): string {
  const b = Buffer.alloc(8)
  b.writeBigUInt64LE(name)
  return `2026-08-27-11:03:58.000,6,60928,${src},255,8,${hex([...b])}`
}

/**
 * The real PGN 129808 DSC Call Information from canboat's
 * samples/pgn129808.raw, sent by the VHF at `src` with Date of Receipt
 * 2007.01.11 -- 1024 weeks before the day it was captured.
 */
function dscCallString(src = 4): string {
  return (
    `2026-08-27-11:03:58.994,4,129808,${src},255,62,` +
    '74,6c,00,16,29,02,28,64,7e,39,30,30,30,31,36,ff,ff,ff,ff,ff,ff,02,01,' +
    'ff,ff,ff,7f,ff,ff,ff,7f,ff,ff,ff,ff,ff,ff,ff,ff,ff,7f,fc,ff,ff,ff,ff,' +
    'ff,ff,ff,ff,ff,ff,ff,ff,40,f2,b5,17,d4,34,00,00'
  )
}

/** PGN 129794 AIS Class A Static from `src` with ETA date `date`. */
function aisStaticString(src: number, date: number): string {
  const data = new Array(76).fill(0xff)
  data[0] = 0x05 // Message ID 5, repeat indicator 0
  const mmsi = Buffer.alloc(4)
  mmsi.writeUInt32LE(244660000)
  data.splice(1, 4, ...mmsi)
  data[45] = date & 0xff
  data[46] = date >> 8
  return `2026-08-27-11:03:58.000,6,129794,${src},255,76,${hex(data)}`
}

/** System Time from `src`, unlike systemTimeString which is fixed at 12. */
function systemTimeFrom(src: number, source: number, date: number): string {
  return systemTimeString(source, date).replace(
    ',126992,12,',
    `,126992,${src},`
  )
}

describe('GPS rollover device syntax', () => {
  test('device syntax', () => {
    expect(parseDevice('4')).toEqual({ address: 4 })
    expect(parseDevice(' 251 ')).toEqual({ address: 251 })
    expect(parseDevice('1851:491603')).toEqual({
      manufacturer: 1851,
      unique: 491603
    })
    expect(parseDevice('0x' + VHF_NAME.toString(16).padStart(16, '0'))).toEqual(
      { name: VHF_NAME }
    )
    expect(parseDevice('0XFF')).toEqual({ name: 0xffn })
  })

  test('device syntax rejects what is not a device', () => {
    for (const bad of [
      '',
      '252',
      '255',
      '300',
      '-1',
      '4.5',
      'vhf',
      '0x',
      '0xnope',
      '0x0',
      '0x0000000000000000',
      '1851',
      '2048:1',
      '1851:2097152',
      '1851:',
      ':5'
    ]) {
      expect(() => parseDevice(bad)).toThrow()
    }
  })

  test('target syntax', () => {
    expect(parseTarget(undefined)).toBe('gnss')
    expect(parseTarget('all')).toBe('all')
    expect(parseTarget('ALL')).toBe('all')
    expect(parseTarget('4, 1851:491603,0x10')).toEqual([
      { address: 4 },
      { manufacturer: 1851, unique: 491603 },
      { name: 0x10n }
    ])
    for (const bad of ['', '4,', 'all,4', '4,all']) {
      expect(() => parseTarget(bad)).toThrow()
    }
  })

  test('parses the flag forms', () => {
    expect(parseQuirks(['gps-rollover']).gpsRollover?.target).toBe('gnss')
    expect(parseQuirks(['gps-rollover=all']).gpsRollover?.target).toBe('all')
    expect(
      parseQuirks(['gps-rollover=4,1851:491603']).gpsRollover?.target
    ).toEqual([{ address: 4 }, { manufacturer: 1851, unique: 491603 }])
    expect(() => parseQuirks(['gps-rollover='])).toThrow()
    expect(() => parseQuirks(['gps-rollover=vhf'])).toThrow()
    expect(() => parseQuirks(['wmm'])).toThrow(/unknown quirk 'wmm'/)
  })

  test('a bad quirk is refused when the parser is made', () => {
    expect(() => new Parser({ quirks: ['gps-rollover=vhf'] })).toThrow()
  })
})

describe('GPS rollover by device', () => {
  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['performance'] })
    jest.setSystemTime(new Date('2026-08-29T12:00:00Z'))
  })
  afterAll(() => {
    jest.useRealTimers()
  })

  const rolled = '2007.01.11'
  const corrected = '2026.08.27'

  function dateOfReceipt(parser: Parser, line = dscCallString()): string {
    const pgn: any = parser.parseString(line)
    return pgn.fields.dateOfReceipt
  }

  test('a listed device has every date corrected', () => {
    // Nothing in 129808 says where the clock came from, so the GNSS rule
    // leaves it alone...
    expect(dateOfReceipt(new Parser({ quirks: ['gps-rollover'] }))).toBe(rolled)
    // ...but naming the VHF, by address or by NAME, corrects it.
    expect(dateOfReceipt(new Parser({ quirks: ['gps-rollover=4'] }))).toBe(
      corrected
    )
    const byProduct = new Parser({ quirks: ['gps-rollover=1851:491603'] })
    byProduct.parseString(claimString(4, VHF_NAME))
    expect(dateOfReceipt(byProduct)).toBe(corrected)
    expect(dateOfReceipt(new Parser({ quirks: ['gps-rollover=all'] }))).toBe(
      corrected
    )
    // A System Time from a listed device is corrected whatever its
    // Source says (5 = local crystal clock).
    const pgn: any = new Parser({ quirks: ['gps-rollover=4'] }).parseString(
      systemTimeFrom(4, 5, day('2007-01-11'))
    )
    expect(pgn.fields.date).toBe(corrected)
  })

  test('a NAME is only matched once the claim was seen', () => {
    const parser = new Parser({ quirks: ['gps-rollover=1851:491603'] })
    // No claim yet: the frame is from an unknown device.
    expect(dateOfReceipt(parser)).toBe(rolled)
    // Some other device at that address.
    parser.parseString(claimString(4, VHF_NAME ^ 1n))
    expect(dateOfReceipt(parser)).toBe(rolled)
  })

  test('an unlisted device still gets the GNSS rule', () => {
    const parser = new Parser({ quirks: ['gps-rollover=4'] })
    const reported = day('2007-01-13')
    let pgn: any = parser.parseString(systemTimeFrom(115, 0, reported))
    expect(pgn.fields.date).toBe('2026.08.29')
    pgn = parser.parseString(systemTimeFrom(115, 5, reported))
    expect(pgn.fields.date).toBe('2007.01.13')
  })

  test('relayed AIS dates are never corrected', () => {
    // A VHF with a built-in AIS receiver: its 129794 ETA is the other
    // vessel's, so it stays even though the VHF is listed.
    const eta = day('2007-01-11')
    for (const q of ['gps-rollover=4', 'gps-rollover=all', 'gps-rollover']) {
      const pgn: any = new Parser({ quirks: [q] }).parseString(
        aisStaticString(4, eta)
      )
      expect(pgn.fields.etaDate).toBe(rolled)
    }
  })

  test('the parser learns names from address claims', () => {
    const parser = new Parser({ quirks: ['gps-rollover=1851:491603'] })
    // Before the claim: not ours.
    expect(dateOfReceipt(parser)).toBe(rolled)
    parser.parseString(claimString(4, VHF_NAME))
    expect(dateOfReceipt(parser)).toBe(corrected)
    // The VHF moves to address 9: the old address stops matching at once
    // -- before whoever takes address 4 has claimed it -- and the new one
    // starts.
    parser.parseString(claimString(9, VHF_NAME))
    expect(dateOfReceipt(parser, dscCallString(4))).toBe(rolled)
    expect(dateOfReceipt(parser, dscCallString(9))).toBe(corrected)
  })
})
