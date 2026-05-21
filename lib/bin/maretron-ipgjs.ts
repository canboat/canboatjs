#!/usr/bin/env node

/**
 * Stream Maretron IPG100 binary frames as canboat plain CSV.
 *
 * Connects, completes the CONNECT handshake, sends SET_MODE\tBINARY\0 on
 * receipt of CONNECTED, and writes one CSV line per inbound 0xA5 frame to
 * stdout in the format canboat's `analyzer` accepts:
 *
 *   YYYY-MM-DD-HH:MM:SS.mmm,<prio>,<pgn>,<src>,<dst>,<len>,<hex>,<hex>,...
 *
 * Control text frames (handshake replies, license-pool announces) go to
 * stderr, so stdout can be piped directly into `analyzerjs`:
 *
 *   maretron-ipgjs ipg100-ip | analyzerjs -json -nv
 *
 * Outbound traffic: each line on stdin is sent to the bus. canboat plain
 * CSV is interpreted as a string; a line that starts with `{` is parsed
 * as a JSON PGN object (matching cansendjs's convention).
 *
 *   cat commands.txt | maretron-ipgjs ipg100-ip
 *
 * stdin is not consumed until the CONNECT handshake completes; the kernel
 * pipe buffer applies backpressure to the producer so nothing is dropped.
 */

import { EventEmitter } from 'node:events'
import readline from 'readline'
import minimist from 'minimist'
import { printVersion } from './utils'
import { createDebug } from '../utilities'
import { MaretronIPG } from '../index'
import { IPG_PORT } from '../maretron-ipg'

const debug = createDebug('canboatjs:maretron-ipg-cli')

const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' },
  string: ['port', 'password'],
  boolean: ['help', 'version'],
  default: {
    port: String(IPG_PORT),
    password: ''
  }
})

printVersion(argv)

if (argv['help'] || argv['_'].length === 0) {
  console.error(`Usage: ${process.argv[1]?.split('/').pop() ?? 'maretron-ipgjs'} [options] host

Streams N2K traffic from a Maretron IPG100 as canboat plain CSV on
stdout. Control/status text frames go to stderr. Lines read on stdin
are sent to the bus after the CONNECT handshake completes (canboat
plain CSV or a single-line JSON PGN object).

Options:
  --port <n>          TCP port (default 6543)
  --password <str>    CONNECT password (default empty)
  --version           print version and exit
  -h, --help          show this help

Examples:
  maretron-ipgjs ipg100-ip | analyzerjs -json -nv
  cat commands.txt | maretron-ipgjs ipg100-ip > frames.log 2> control.log
  echo '2026-05-15-10:00:00.000,6,59904,0,255,3,00,ee,01' | maretron-ipgjs ipg100-ip`)
  process.exit(argv['help'] ? 0 : 1)
}

const host = argv['_'][0]
const port = Number(argv['port'])
if (!Number.isFinite(port) || port <= 0 || port > 65535) {
  console.error(`Invalid --port value: ${argv['port']}`)
  process.exit(1)
}

debug(`connecting to ${host}:${port}`)

// An app-like EventEmitter — the driver listens on `nmea2000out` /
// `nmea2000JsonOut`, so emitting those events here is how we send.
const app = new EventEmitter()

const stream: any = new (MaretronIPG as any)({
  app,
  host,
  port,
  password: argv['password'],
  reconnect: true,
  // The CLI passes `app` only for event wiring (nmea2000out / JsonOut
  // from stdin), not as a SignalK provider. Re-assert the standalone
  // fail-fast policy explicitly so a typo'd hostname exits 1 instead
  // of looping forever.
  failFastOnInitialConnect: true
})

let stdinAttached = false

function attachStdin(): void {
  if (stdinAttached) return
  stdinAttached = true

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  })

  rl.on('line', (line) => {
    if (line.length === 0) return
    // Mirrors cansendjs convention: JSON-line PGN objects or canboat CSV.
    if (line[0] === '{') {
      try {
        const obj = JSON.parse(line)
        app.emit('nmea2000JsonOut', obj)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`-- bad JSON on stdin: ${message}`)
      }
    } else {
      app.emit('nmea2000out', line)
    }
  })

  rl.on('close', () => {
    debug('stdin closed')
  })

  console.error('-- stdin ready (canboat CSV or JSON, one per line)')
}

stream.on('connected', (info: { serial?: string }) => {
  console.error(`-- connected (serial=${info?.serial ?? '?'})`)
  // Attach stdin only now. Until this point the kernel pipe buffer holds
  // input from any upstream `cat`/echo, applying backpressure rather than
  // discarding lines — so the very first line in commands.txt still gets
  // sent. Reconnects don't re-attach (the rl is already live).
  attachStdin()
})

stream.on('version', (version: string, product: string) => {
  console.error(`-- ${product} ${version}`)
})

stream.on('instance', (busAddress: number, instance: number) => {
  console.error(`-- IPG bus address=${busAddress}, client instance=${instance}`)
})

stream.on('authfail', () => {
  console.error('-- authentication failed (NO)')
  process.exit(2)
})

// Driver pushes canboat plain CSV strings on the readable side — drain
// them to stdout with newline terminators so `analyzer` can parse the
// output directly.
stream.on('data', (line: string) => {
  process.stdout.write(line + '\n')
})

stream.on('error', () => {
  // The driver only emits a stream-level 'error' on a fatal initial-connect
  // failure. By the time we get here, the driver has already written the
  // underlying socket error to stderr via setProviderError. In-session
  // socket errors don't reach this handler — they take the setProviderError
  // path and are followed by an automatic reconnect.
  process.exit(1)
})

process.on('SIGINT', () => {
  console.error('-- SIGINT, closing')
  stream.end()
  process.exit(0)
})
