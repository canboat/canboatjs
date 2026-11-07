/**
 * Filter devices by manufacturer (#588): keep the messages of some
 * manufacturers' devices (allowManufacturers), or drop those of some
 * (denyManufacturers). A message goes by the manufacturer of the device that
 * sent it, so every PGN from an address is kept or dropped alike.
 *
 * The device's manufacturer comes from its ISO Address Claim (PGN 60928),
 * which always decides. Before an address has claimed, the manufacturer code
 * of its first proprietary PGN is taken provisionally: that code says whose
 * message format it is, not who built the sender, so as soon as the address
 * sends a proprietary PGN with another code (a B&G display sending Simrad
 * PGNs, a gateway controlling another make's devices) it is no longer used,
 * and the address waits for its claim.
 *
 * Nothing from an address is passed on until its manufacturer is known.
 * Network management PGNs always are: canboatjs's own device must hear every
 * address claim and request to keep its address. So are pseudo PGNs, which
 * a gateway sends about itself, not a device on the bus.
 *
 * Copyright 2025 Signal K contributors
 * Licensed under the Apache License, Version 2.0
 */

import { ManufacturerCodeValues } from '@canboat/ts-pgns'
import { NETWORK_MANAGEMENT_PGNS } from './excludePgns'

const ADDRESS_CLAIM = 60928
const NULL_ADDRESS = 254
const MANUFACTURER_CODE_MAX = 0x7ff
// Above the 18 bits of a CAN PGN: messages a gateway makes up about itself.
const PSEUDO_PGN_MIN = 0x40000

/**
 * A manufacturer name as it is compared: lower case, letters and digits,
 * with '&' read as 'and' (B & G).
 */
const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '')

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]
      row[j] = Math.min(
        row[j] + 1,
        row[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      diagonal = above
    }
  }
  return row[b.length]
}

/**
 * How far a name is from a prefix of `name` about as long, or from all of
 * it, whichever is nearer.
 */
function prefixDistance(wanted: string, name: string): number {
  let best = editDistance(wanted, name)
  for (let k = wanted.length - 2; k <= wanted.length + 2; k++) {
    if (k > 0 && k < name.length) {
      best = Math.min(best, editDistance(wanted, name.slice(0, k)))
    }
  }
  return best
}

const describe = (names: [string, number][]) =>
  names.map(([name, code]) => `${name} (${code})`).join(', ')

/**
 * The manufacturer code a name or number stands for. A number is taken as
 * the code. A name is looked up in canboat's MANUFACTURER_CODE lookup,
 * ignoring case, spaces and punctuation: an exact match wins, otherwise a
 * unique prefix is enough. Throws, naming the candidates, when a name
 * matches no manufacturer or more than one.
 */
export function resolveManufacturer(
  value: string | number,
  lookup: Record<string, number> = ManufacturerCodeValues as Record<
    string,
    number
  >
): number {
  const text = String(value).trim()
  if (/^\d+$/.test(text)) {
    const code = Number(text)
    if (code > MANUFACTURER_CODE_MAX) {
      throw new Error(
        `manufacturer code ${text} is out of range (0-${MANUFACTURER_CODE_MAX})`
      )
    }
    return code
  }
  const wanted = normalize(text)
  if (wanted === '') {
    throw new Error(`'${text}' is not a manufacturer`)
  }
  const entries = Object.entries(lookup)
  const exact = entries.filter(([name]) => normalize(name) === wanted)
  const matches =
    exact.length > 0
      ? exact
      : entries.filter(([name]) => normalize(name).startsWith(wanted))
  const codes = new Set(matches.map(([, code]) => code))
  if (codes.size === 1) {
    return matches[0][1]
  }
  if (codes.size > 1) {
    throw new Error(`'${text}' matches ${describe(matches)}: be more specific`)
  }
  const distances = entries.map(([name, code]): [string, number, number] => [
    name,
    code,
    // A typo in a prefix ('vicron' for Victron Energy) counts too.
    wanted.length >= 4
      ? prefixDistance(wanted, normalize(name))
      : editDistance(wanted, normalize(name))
  ])
  // The nearest names, if any is near at all.
  const nearest = Math.min(...distances.map(([, , distance]) => distance))
  const near =
    nearest > 2
      ? []
      : distances
          .filter(([, , distance]) => distance === nearest)
          .slice(0, 3)
          .map(([name, code]): [string, number] => [name, code])
  throw new Error(
    `unknown manufacturer '${text}'` +
      (near.length > 0 ? `; did you mean ${describe(near)}?` : '')
  )
}

/**
 * The entries of an allowManufacturers or denyManufacturers option: an
 * array, or a comma separated string, of names and codes; an array's
 * entries may be comma separated too (one --manufacturer-allow a,b). A few
 * manufacturer names hold a comma ("Tohatsu Co, JP"): comma separated
 * parts that together are exactly such a name stay together.
 */
function manufacturerEntries(
  option: unknown,
  lookup: Record<string, number>
): string[] {
  const list: unknown[] = Array.isArray(option)
    ? option
    : typeof option === 'string' || typeof option === 'number'
      ? [option]
      : []
  const names = new Set(Object.keys(lookup).map(normalize))
  const entries: string[] = []
  for (const item of list) {
    const parts = String(item).split(',')
    let i = 0
    while (i < parts.length) {
      let end = i + 1
      for (let k = parts.length; k > i + 1; k--) {
        if (names.has(normalize(parts.slice(i, k).join(',')))) {
          end = k
          break
        }
      }
      entries.push(parts.slice(i, end).join(',').trim())
      i = end
    }
  }
  return entries.filter((entry) => entry !== '')
}

/**
 * The codes of an allowManufacturers or denyManufacturers option: an array,
 * or a comma separated string, of names and codes.
 */
export function parseManufacturers(
  option: unknown,
  lookup: Record<string, number> = ManufacturerCodeValues as Record<
    string,
    number
  >
): number[] {
  const codes: number[] = []
  for (const entry of manufacturerEntries(option, lookup)) {
    const code = resolveManufacturer(entry, lookup)
    if (!codes.includes(code)) {
      codes.push(code)
    }
  }
  return codes
}

/** A proprietary PGN carries its manufacturer code in its first 11 bits. */
function isProprietarySingle(pgn: number) {
  return pgn === 61184 || (pgn >= 65280 && pgn <= 65535)
}
function isProprietaryFast(pgn: number) {
  return pgn === 126720 || (pgn >= 130816 && pgn <= 131071)
}

interface AddressState {
  // From an Address Claim: the 8 bytes of the NAME, as hex.
  name?: string
  code?: number
  provisional?: boolean
  // A proprietary PGN with another code than the provisional one came in:
  // proprietary PGNs no longer tell this address's manufacturer.
  proprietaryUntrusted?: boolean
}

export class ManufacturerFilter {
  private readonly allow?: Set<number>
  private readonly deny?: Set<number>
  private readonly addresses = new Map<number, AddressState>()

  constructor(allow: number[] | undefined, deny: number[] | undefined) {
    if (allow && allow.length > 0 && deny && deny.length > 0) {
      throw new Error('give allowManufacturers or denyManufacturers, not both')
    }
    if (allow && allow.length > 0) {
      this.allow = new Set(allow)
    } else if (deny && deny.length > 0) {
      this.deny = new Set(deny)
    }
  }

  /**
   * A filter for FromPgn's options, or undefined when they ask for none.
   * Throws when an option names no manufacturer, or both are given.
   */
  static fromOptions(options: {
    allowManufacturers?: unknown
    denyManufacturers?: unknown
  }): ManufacturerFilter | undefined {
    let allow: number[]
    let deny: number[]
    try {
      allow = parseManufacturers(options.allowManufacturers)
    } catch (e: any) {
      throw new Error(`Invalid allowManufacturers option: ${e.message}`)
    }
    try {
      deny = parseManufacturers(options.denyManufacturers)
    } catch (e: any) {
      throw new Error(`Invalid denyManufacturers option: ${e.message}`)
    }
    if (allow.length === 0 && deny.length === 0) {
      return undefined
    }
    return new ManufacturerFilter(allow, deny)
  }

  /** The manufacturer code known for an address, if any. */
  manufacturerOf(src: number): number | undefined {
    return this.addresses.get(src)?.code
  }

  /**
   * Learn what a message says about its sender's manufacturer, and whether
   * to pass it on. `data` is the message's bytes; for a frame of a fast
   * packet (`fastFrame`), the CAN frame's, with its sequence byte first.
   */
  passes(pgn: number, src: number, data: Uint8Array, fastFrame: boolean) {
    if (pgn === ADDRESS_CLAIM) {
      this.noteClaim(src, data)
    } else if (isProprietarySingle(pgn)) {
      this.noteProprietary(src, data, 0)
    } else if (isProprietaryFast(pgn)) {
      if (!fastFrame) {
        this.noteProprietary(src, data, 0)
      } else if ((data[0] & 0x1f) === 0) {
        // The first frame: a sequence byte, the length, then the message.
        this.noteProprietary(src, data, 2)
      }
    }
    // Network management, and a gateway's own pseudo PGNs (262384, from
    // no device on the bus), always pass.
    if (NETWORK_MANAGEMENT_PGNS.includes(pgn) || pgn >= PSEUDO_PGN_MIN) {
      return true
    }
    const code = this.addresses.get(src)?.code
    if (code === undefined) {
      return false
    }
    return this.allow ? this.allow.has(code) : !this.deny!.has(code)
  }

  private noteClaim(src: number, data: Uint8Array) {
    if (data.length < 8) {
      return
    }
    const name = Buffer.from(data.subarray(0, 8)).toString('hex')
    // The device's NAME now speaks for this address only: it moved, or
    // could not claim one (from the null address).
    for (const [address, state] of this.addresses) {
      if (address !== src && state.name === name) {
        this.addresses.delete(address)
      }
    }
    if (src === NULL_ADDRESS) {
      return
    }
    const low = data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)
    this.addresses.set(src, { name, code: low >>> 21 })
  }

  private noteProprietary(src: number, data: Uint8Array, at: number) {
    if (src === NULL_ADDRESS || data.length < at + 2) {
      return
    }
    const code = data[at] | ((data[at + 1] & 0x07) << 8)
    const state = this.addresses.get(src)
    if (state === undefined) {
      this.addresses.set(src, { code, provisional: true })
    } else if (state.provisional && state.code !== code) {
      this.addresses.set(src, { proprietaryUntrusted: true })
    }
  }
}
