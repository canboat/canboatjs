#!/usr/bin/env node

import { parseN2kString } from '../stringMsg'
import { toPgn } from '../toPgn'
import { getPlainPGNs, binToActisense } from '../utilities'
import { encodeCanId } from '../canId'
import readline from 'readline'
import minimist from 'minimist'
import { printVersion } from './utils'

const argv = minimist(process.argv.slice(2), {
  boolean: ['test', 'log-output'],
  string: ['src'],
  alias: { h: 'help' }
})

printVersion(argv)

if (argv['help']) {
  console.error(`Usage: ${process.argv[0]} [options] candevice

Options:
  --src <src>    use src for all messages
  --log-output   log messages sent
  --test         don't connect or send any data
  -h, --help     output usage information`)
  process.exit(1)
}

if (argv['_'].length === 0) {
  console.error('Please specify a device')
  process.exit(1)
}

const canDevice = argv['_'][0]
const srcArg = argv.src
const logOut = argv['log-output']
const test = argv.test

let channel: any

if (!test) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const socketcan = require('socketcan')
  channel = socketcan.createRawChannel(canDevice)

  channel.addListener('onStopped', (msg: any) => {
    console.error(`socketcan stopped ${msg}`)
  })

  channel.start()
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
})

rl.on('line', function (line) {
  if (line.length === 0) {
    return
  }

  const msg = line[0] === '{' ? JSON.parse(line) : line

  if (typeof msg !== 'string') {
    if (msg.prio === undefined) {
      msg.prio = 3
    }
    if (msg.dst === undefined) {
      msg.dst = 255
    }
    if (srcArg !== undefined) {
      msg.src = srcArg
    }
    if (msg.src === undefined) {
      msg.src = 100
    }
  }

  let pgn: any, canid: number, buffer: Buffer | undefined
  if (typeof msg === 'object') {
    canid = encodeCanId(msg)
    buffer = toPgn(msg)
    if (buffer === undefined) {
      console.error('invalid input: %s', line)
      return
    }
    pgn = msg
  } else {
    pgn = parseN2kString(msg)

    if (isNaN(pgn.prio) || isNaN(pgn.pgn) || isNaN(pgn.dst) || isNaN(pgn.src)) {
      console.error('invalid input: ' + line)
      return
    }

    if (srcArg !== undefined) {
      pgn.src = srcArg
    }

    canid = encodeCanId(pgn)
    buffer = pgn.data
  }

  const timestamp = new Date().toISOString()

  if (buffer == undefined) {
    console.error('unable to encode: %s', line)
    return
  } else {
    if (buffer.length > 8 || pgn.pgn == 126720) {
      const pgns = getPlainPGNs(buffer)
      pgns.forEach((pbuffer) => {
        if (!test) {
          channel.send({ id: canid, ext: true, data: pbuffer })
        }
        if (logOut) {
          console.log(binToActisense(pgn, timestamp, pbuffer, pbuffer.length))
        }
      })
    } else {
      if (!test) {
        channel.send({ id: canid, ext: true, data: buffer })
      }
      if (logOut) {
        console.log(binToActisense(pgn, timestamp, buffer, buffer.length))
      }
    }
  }
})
