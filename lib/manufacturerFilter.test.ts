// Filtering devices by manufacturer (#588).

import { Parser as FromPgn } from './fromPgn'
import {
  ManufacturerFilter,
  parseManufacturers,
  resolveManufacturer
} from './manufacturerFilter'

const VICTRON = 358
const GARMIN = 229
const BG = 381
const SIMRAD = 1857
const FUSION = 419

const hex = (bytes: number[]) =>
  bytes.map((b) => b.toString(16).padStart(2, '0')).join(',')

// An ISO Address Claim from src for a device of this manufacturer.
function claim(src: number, code: number, unique = 1234) {
  const low = ((code << 21) | unique) >>> 0
  const name = [
    low & 0xff,
    (low >> 8) & 0xff,
    (low >> 16) & 0xff,
    (low >> 24) & 0xff,
    0x00,
    0x82,
    0x78,
    0xc0
  ]
  return `2026-11-07T00:00:00.000Z,6,60928,${src},255,8,${hex(name)}`
}

// The first two bytes of a proprietary message: the manufacturer code and
// the marine industry.
const proprietary = (code: number) => [
  code & 0xff,
  ((code >> 8) & 0x07) | 0x18 | 0x80
]

// A single-frame proprietary PGN (65305, B&G/Simrad).
const single = (src: number, code: number) =>
  `2026-11-07T00:00:00.000Z,7,65305,${src},255,8,${hex([...proprietary(code), 1, 2, 3, 4, 5, 6])}`

// The two frames of a 10-byte fast-packet proprietary PGN (130820).
const fast = (src: number, code: number) => [
  `2026-11-07T00:00:00.000Z,7,130820,${src},255,8,${hex([0x20, 10, ...proprietary(code), 1, 2, 3, 4])}`,
  `2026-11-07T00:00:00.000Z,7,130820,${src},255,8,${hex([0x21, 5, 6, 7, 8, 0xff, 0xff, 0xff])}`
]

const heading = (src: number) =>
  `2026-11-07T00:00:00.000Z,2,127250,${src},255,8,00,10,6e,01,00,ff,7f,fd`

const isoRequest = (src: number) =>
  `2026-11-07T00:00:00.000Z,6,59904,${src},255,3,00,ee,00`

// The sources of the messages the parser passes on.
function run(options: object, lines: string[]) {
  const parser = new FromPgn({ format: 0, ...options })
  const passed: [number, number][] = []
  for (const line of lines) {
    const pgn = parser.parseString(line)
    if (pgn) {
      passed.push([pgn.pgn, pgn.src!])
    }
  }
  return passed
}

describe('resolveManufacturer', () => {
  test('takes a code', () => {
    expect(resolveManufacturer(358)).toBe(VICTRON)
    expect(resolveManufacturer('358')).toBe(VICTRON)
  })

  test('ignores case, spaces and punctuation', () => {
    expect(resolveManufacturer('Victron Energy')).toBe(VICTRON)
    expect(resolveManufacturer('victronenergy')).toBe(VICTRON)
    expect(resolveManufacturer('b&g')).toBe(BG)
    expect(resolveManufacturer('B & G')).toBe(BG)
    expect(resolveManufacturer('b and g')).toBe(BG)
  })

  test('takes a unique prefix', () => {
    expect(resolveManufacturer('victron')).toBe(VICTRON)
  })

  test('refuses a prefix of several manufacturers, naming them', () => {
    expect(() => resolveManufacturer('sim')).toThrow(
      "'sim' matches Simarine (513), Simrad (1857): be more specific"
    )
  })

  test('refuses an unknown name, suggesting near ones', () => {
    expect(() => resolveManufacturer('vicron energy')).toThrow(
      "unknown manufacturer 'vicron energy'; did you mean Victron Energy (358)?"
    )
    expect(() => resolveManufacturer('vicron')).toThrow(
      "unknown manufacturer 'vicron'; did you mean Victron Energy (358)?"
    )
    expect(() => resolveManufacturer('zzzzzz')).toThrow(
      "unknown manufacturer 'zzzzzz'"
    )
  })

  test('refuses a code wider than 11 bits', () => {
    expect(() => resolveManufacturer(2048)).toThrow('out of range')
  })
})

describe('parseManufacturers', () => {
  test('takes an array, or a comma separated string', () => {
    expect(parseManufacturers(['victron', 229])).toEqual([VICTRON, GARMIN])
    expect(parseManufacturers('Victron Energy, garmin')).toEqual([
      VICTRON,
      GARMIN
    ])
  })

  test('splits comma separated array entries, as one CLI flag gives them', () => {
    expect(parseManufacturers(['garmin,victron', 'furuno'])).toEqual([
      GARMIN,
      VICTRON,
      1855
    ])
  })

  test('keeps a name that holds a comma together', () => {
    const tohatsu = resolveManufacturer('Tohatsu Co, JP')
    expect(parseManufacturers('Tohatsu Co, JP, garmin')).toEqual([
      tohatsu,
      GARMIN
    ])
    expect(parseManufacturers(['garmin', 'Tohatsu Co, JP'])).toEqual([
      GARMIN,
      tohatsu
    ])
  })

  test('nothing to filter', () => {
    for (const option of [undefined, null, '', [], ['']]) {
      expect(parseManufacturers(option)).toEqual([])
    }
  })
})

describe('FromPgn with allowManufacturers or denyManufacturers', () => {
  test('refuses both', () => {
    expect(
      () =>
        new FromPgn({
          allowManufacturers: ['victron'],
          denyManufacturers: ['garmin']
        })
    ).toThrow('not both')
  })

  test('refuses a name it cannot resolve, naming the option', () => {
    expect(() => new FromPgn({ denyManufacturers: 'vicron' })).toThrow(
      "Invalid denyManufacturers option: unknown manufacturer 'vicron'"
    )
  })

  test('without either, passes everything', () => {
    expect(run({}, [heading(10)])).toEqual([[127250, 10]])
  })

  test('passes nothing from an address before its manufacturer is known', () => {
    expect(
      run({ denyManufacturers: 'garmin' }, [
        heading(10),
        claim(10, VICTRON),
        heading(10)
      ])
    ).toEqual([
      [60928, 10],
      [127250, 10]
    ])
  })

  test('keeps only allowed manufacturers', () => {
    expect(
      run({ allowManufacturers: 'victron' }, [
        claim(10, VICTRON),
        claim(11, GARMIN),
        heading(10),
        heading(11)
      ])
    ).toEqual([
      [60928, 10],
      [60928, 11],
      [127250, 10]
    ])
  })

  test('drops denied manufacturers', () => {
    expect(
      run({ denyManufacturers: 'garmin' }, [
        claim(10, VICTRON),
        claim(11, GARMIN),
        heading(10),
        heading(11)
      ])
    ).toEqual([
      [60928, 10],
      [60928, 11],
      [127250, 10]
    ])
  })

  test('always passes network management, for its own device', () => {
    expect(
      run({ allowManufacturers: 'victron' }, [
        isoRequest(12),
        claim(11, GARMIN)
      ])
    ).toEqual([
      [59904, 12],
      [60928, 11]
    ])
  })

  test('takes a single-frame proprietary PGN as a provisional claim', () => {
    expect(
      run({ allowManufacturers: 'simrad' }, [single(20, SIMRAD), heading(20)])
    ).toEqual([
      [65305, 20],
      [127250, 20]
    ])
  })

  test('takes a fast-packet proprietary PGN as a provisional claim', () => {
    expect(
      run({ allowManufacturers: 'fusion' }, [...fast(30, FUSION), heading(30)])
    ).toEqual([
      [130820, 30],
      [127250, 30]
    ])
  })

  test('stops trusting proprietary PGNs once one names another manufacturer', () => {
    // A B&G display that sends Simrad PGNs, or a gateway that controls
    // another make's devices: wait for the Address Claim.
    expect(
      run({ allowManufacturers: 'simrad' }, [
        single(20, SIMRAD),
        heading(20),
        ...fast(20, FUSION),
        heading(20),
        single(20, SIMRAD),
        heading(20),
        claim(20, SIMRAD),
        heading(20)
      ])
    ).toEqual([
      [65305, 20],
      [127250, 20],
      [60928, 20],
      [127250, 20]
    ])
  })

  test('lets the Address Claim override a provisional manufacturer', () => {
    expect(
      run({ allowManufacturers: 'simrad' }, [
        single(20, SIMRAD),
        claim(20, BG),
        heading(20),
        single(20, SIMRAD)
      ])
    ).toEqual([
      [65305, 20],
      [60928, 20]
    ])
  })

  test('reads the message, not the header, of a buffer', () => {
    // parseBuffer's input: prio, PGN (3 bytes), dst, src, a timestamp
    // (4 bytes), the length, then the data.
    const buffer = (line: string) => {
      const [, prio, pgn, src, dst, len, ...bytes] = line.split(',')
      const n = Number(pgn)
      return Buffer.from([
        Number(prio),
        n & 0xff,
        (n >> 8) & 0xff,
        n >> 16,
        Number(dst),
        Number(src),
        0,
        0,
        0,
        0,
        Number(len),
        ...bytes.map((b) => parseInt(b, 16))
      ])
    }
    const parser = new FromPgn({ allowManufacturers: 'victron' })
    const passed = [
      claim(10, VICTRON),
      heading(10),
      claim(11, GARMIN),
      heading(11)
    ]
      .map((line) => parser.parse(buffer(line)))
      .filter((pgn) => pgn)
      .map((pgn: any) => [pgn.pgn, pgn.src])
    expect(passed).toEqual([
      [60928, 10],
      [127250, 10],
      [60928, 11]
    ])
  })

  test('follows a device to its new address', () => {
    const filter = new ManufacturerFilter([VICTRON], undefined)
    const feed = (line: string) => {
      const [, , pgn, src, , , ...bytes] = line.split(',')
      filter.passes(
        Number(pgn),
        Number(src),
        Uint8Array.from(bytes.map((b) => parseInt(b, 16))),
        false
      )
    }
    feed(claim(10, VICTRON))
    expect(filter.manufacturerOf(10)).toBe(VICTRON)
    // The same NAME claims address 15: 10 no longer has it.
    feed(claim(15, VICTRON))
    expect(filter.manufacturerOf(15)).toBe(VICTRON)
    expect(filter.manufacturerOf(10)).toBeUndefined()
    // Another device takes address 15 over.
    feed(claim(15, GARMIN, 99))
    expect(filter.manufacturerOf(15)).toBe(GARMIN)
  })

  test('forgets an address whose device could not claim one', () => {
    const filter = new ManufacturerFilter([VICTRON], undefined)
    const bytes = (line: string) =>
      Uint8Array.from(
        line
          .split(',')
          .slice(6)
          .map((b) => parseInt(b, 16))
      )
    filter.passes(60928, 10, bytes(claim(10, VICTRON)), false)
    filter.passes(60928, 254, bytes(claim(254, VICTRON)), false)
    expect(filter.manufacturerOf(10)).toBeUndefined()
    expect(filter.manufacturerOf(254)).toBeUndefined()
  })
})
