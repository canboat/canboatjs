/**
 * excludePgns: PGNs to drop as early as the input allows, before anything
 * decodes them. On SocketCAN the kernel drops them (canSocket.ts), on every
 * input FromPgn drops them before reassembly and decoding (fromPgn.ts).
 *
 * It is a deny-list, like Signal K's connection filters: a PGN nobody knows
 * yet still comes through, so it can be recorded and worked out later.
 *
 * Copyright 2025 Signal K contributors
 * Licensed under the Apache License, Version 2.0
 */

// NMEA 2000 PGNs use the data page but not the extended data page.
const PGN_MAX = 0x1ffff

// Network management, which excludePgns leaves alone. canboatjs's own
// device (n2kDevice.ts) claims an address and answers requests with them,
// long messages arrive through the transport protocol, and Signal K's device
// list and discovery read the heartbeat and device information. They are
// rare, so dropping them would save nothing and break these.
export const NETWORK_MANAGEMENT_PGNS = [
  59392, // ISO Acknowledgement
  59904, // ISO Request
  60160, // ISO Transport Protocol, Data Transfer
  60416, // ISO Transport Protocol, Connection Management
  60928, // ISO Address Claim
  65240, // ISO Commanded Address
  126208, // NMEA Group Function
  126464, // PGN List
  126993, // Heartbeat
  126996, // Product Information
  126998 // Configuration Information
]

/**
 * The PGNs of an excludePgns option, as an array or a comma or space
 * separated string, that can be dropped: whole numbers that are PGNs,
 * without the network management PGNs, each once. Everything else is
 * returned in `ignored`, with the reason.
 */
export function parseExcludePgns(option: unknown): {
  pgns: number[]
  ignored: string[]
} {
  const entries = Array.isArray(option)
    ? option
    : typeof option === 'string' || typeof option === 'number'
      ? String(option).split(/[\s,]+/)
      : []
  const pgns: number[] = []
  const ignored: string[] = []
  for (const entry of entries) {
    const text = String(entry).trim()
    if (text === '') {
      continue
    }
    const pgn = Number(text)
    if (!Number.isInteger(pgn) || pgn < 0 || pgn > PGN_MAX) {
      ignored.push(`${text} (not a PGN)`)
    } else if (((pgn >> 8) & 0xff) < 240 && (pgn & 0xff) !== 0) {
      // A PDU1 PGN with a destination address added (59905 for 59904): no
      // message has that PGN, and a kernel filter for it would drop the
      // PGN ending in 00, which may be a network management one.
      ignored.push(`${text} (PDU1 PGN with a destination, use ${pgn & ~0xff})`)
    } else if (NETWORK_MANAGEMENT_PGNS.includes(pgn)) {
      ignored.push(`${text} (network management)`)
    } else if (!pgns.includes(pgn)) {
      pgns.push(pgn)
    }
  }
  return { pgns, ignored }
}
