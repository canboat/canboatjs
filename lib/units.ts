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
 * Decimals a scaled number with this resolution is given with
 * (canboat#969): a resolution that is a whole number of 10^-p steps gives
 * p decimals (0.01 -> 2, 0.004 -> 3); any other one, a binary fraction or
 * a step an SI conversion divided by 60 or 3.6e6, gets two more, so a
 * value is off by under 1 % of a step. canboat's decimalsForResolution.
 */
export function decimalsFor(resolution: number | undefined): number {
  if (resolution === undefined || !(resolution > 0) || !isFinite(resolution)) {
    return 0
  }
  let precision = 0
  let r = resolution
  while (r < 1.0) {
    precision++
    r *= 10.0
  }
  return Math.abs(r - Math.round(r)) <= 1e-9 * r ? precision : precision + 2
}

/**
 * Decimals for a TIME or DURATION's seconds: one per factor of ten in its
 * resolution, as canboat's fieldPrintTime takes them from the units per
 * second.
 */
export function timeDecimalsFor(resolution: number | undefined): number {
  let precision = 0
  for (let r = resolution ?? 1; r > 0.0 && r < 1.0; r = r * 10.0) {
    precision++
  }
  return precision
}

export type Scale = {
  /** The resolution, in SI. */
  resolution: number
  /** Decimals a value is given with. */
  decimals: number
}

const scales = new WeakMap<object, Scale>()

/**
 * A field's (or a dynamic key entry's) resolution in SI and its decimals,
 * worked out once per definition rather than per value. Latitude and
 * longitude get the 7 decimals canboat gives them.
 */
export function scaleOf(field: {
  Resolution?: number | string
  Unit?: string
  PhysicalQuantity?: string
}): Scale {
  let scale = scales.get(field)
  if (scale === undefined) {
    let resolution = Number(field.Resolution ?? 1)
    const si = siConversion(field.Unit, field.PhysicalQuantity)
    if (si !== undefined) {
      resolution = (resolution * si.mul) / si.div
    }
    const latlon =
      field.PhysicalQuantity === 'GEOGRAPHICAL_LATITUDE' ||
      field.PhysicalQuantity === 'GEOGRAPHICAL_LONGITUDE'
    scale = { resolution, decimals: latlon ? 7 : decimalsFor(resolution) }
    scales.set(field, scale)
  }
  return scale
}

/**
 * A value rounded to `decimals`. A value exactly halfway rounds to even,
 * as canboat's printf does (13.3125 to 3 decimals is 13.312), where
 * toFixed would round it up.
 */
export function roundToDecimals(value: number, decimals: number): number {
  const rounded = value.toFixed(decimals)
  // A tie only when the double itself is exactly halfway: its exact
  // decimal expansion (toFixed gives the double's own digits) is a 5 and
  // then nothing at the decimal after the last one kept. Scaling by
  // 10^decimals first would round to a false half.
  const digits = Math.min(100, decimals + 40)
  const exact = Math.abs(value).toFixed(digits)
  const tail = exact.slice(exact.length - (digits - decimals))
  if (/^50*$/.test(tail)) {
    const kept = exact.slice(0, exact.length - (digits - decimals))
    const lastDigit = Number(kept.replace('.', '').slice(-1))
    if (lastDigit % 2 === 0) {
      // toFixed rounded away from the even digit: keep the even one.
      return Number.parseFloat((value < 0 ? '-' : '') + kept)
    }
  }
  return Number.parseFloat(rounded)
}
