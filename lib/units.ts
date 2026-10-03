/*
 * canboat.json keeps the units NMEA 2000 or common practice uses (%, L,
 * rpm, kWh, ...). Decoded values are SI, as canboat gives them with -si
 * and by default in Rust: siUnits and fixupUnit in canboat's
 * analyzer/fieldtype.c, convert_unit in crates/canboat/src/engine/units.rs.
 */

export type SiConversion = {
  /** The SI unit the value is given in. */
  unit: string
  /** A value in the database unit times mul / div is the SI value. */
  mul: number
  div: number
}

const SI_UNITS: Record<string, SiConversion> = {
  kWh: { unit: 'J', mul: 3.6e6, div: 1 },
  Ah: { unit: 'C', mul: 3600, div: 1 },
  '%': { unit: 'ratio', mul: 1, div: 100 },
  ppm: { unit: 'ratio', mul: 1, div: 1e6 },
  ppt: { unit: 'ratio', mul: 1, div: 1000 },
  L: { unit: 'm3', mul: 1, div: 1000 },
  'L/h': { unit: 'm3/s', mul: 1, div: 3.6e6 },
  'km/h': { unit: 'm/s', mul: 1, div: 3.6 },
  'kg/h': { unit: 'kg/s', mul: 1, div: 3600 },
  'g/cm3': { unit: 'kg/m3', mul: 1000, div: 1 },
  cP: { unit: 'Pa.s', mul: 1, div: 1000 },
  'Pa/hr': { unit: 'Pa/s', mul: 1, div: 3600 },
  rpm: { unit: 'Hz', mul: 1, div: 60 },
  'semi-circle': { unit: 'rad', mul: Math.PI, div: 1 },
  'semi-circle/s': { unit: 'rad/s', mul: Math.PI, div: 1 }
}

const DEG_TO_RAD: SiConversion = { unit: 'rad', mul: Math.PI, div: 180 }

/**
 * How a value in `unit` becomes SI, or undefined when it already is.
 * Degrees become radians only for an angle: latitude and longitude stay
 * in degrees, as in canboat.
 */
export function siConversion(
  unit: string | undefined,
  physicalQuantity?: string
): SiConversion | undefined {
  if (unit === undefined) {
    return undefined
  }
  if (unit === 'deg') {
    return physicalQuantity === 'ANGLE' ? DEG_TO_RAD : undefined
  }
  return SI_UNITS[unit]
}

/**
 * The number of decimals a value with this resolution is given with:
 * one per factor of ten below 1, as canboat counts them.
 */
export function precisionOf(resolution: number | undefined): number {
  let precision = 0
  for (let r = resolution ?? 1; r > 0.0 && r < 1.0; r = r * 10.0) {
    precision++
  }
  return precision
}

/**
 * A value rounded to as many decimals as its resolution has. A value
 * exactly halfway rounds to even, as canboat's printf does (13.3125 rpm/60
 * is 13.312), where toFixed would round it up.
 */
export function roundToResolution(
  value: number,
  resolution: number | undefined
): number {
  const precision = precisionOf(resolution)
  const rounded = value.toFixed(precision)
  // A tie only when the double itself is exactly halfway: its exact
  // decimal expansion (toFixed gives the double's own digits) is a 5 and
  // then nothing at the decimal after the last one kept. Scaling by
  // 10^precision first would round to a false half.
  const digits = Math.min(100, precision + 40)
  const exact = Math.abs(value).toFixed(digits)
  const tail = exact.slice(exact.length - (digits - precision))
  if (/^50*$/.test(tail)) {
    const kept = exact.slice(0, exact.length - (digits - precision))
    const lastDigit = Number(kept.replace('.', '').slice(-1))
    if (lastDigit % 2 === 0) {
      // toFixed rounded away from the even digit: keep the even one.
      return Number.parseFloat((value < 0 ? '-' : '') + kept)
    }
  }
  return Number.parseFloat(rounded)
}
