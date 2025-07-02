#!/usr/bin/env node

import { EventEmitter } from 'node:events'
import minimist from 'minimist'
import readline from 'readline'
import { serial } from '../index'
import { Transform } from 'stream'
import { printVersion } from './utils'

const argv = minimist(process.argv.slice(2), {
  boolean: ['disable-output'],
  alias: { h: 'help' }
})

printVersion(argv)

if (argv['help']) {
  console.error(`Usage: ${process.argv[0]} [options] device_path

Options:
  --disable-output don't output pgns
  -h, --help       output usage information`)
  process.exit(1)
}

if (argv['_'].length === 0) {
  console.error('Please specify a device')
  process.exit(1)
}

const app = new EventEmitter()

const actisense = new (serial as any)({
  app: app,
  device: argv['_'][0],
  plainText: true,
  disableSetTransmitPGNs: true,
  outputOnly: argv['disable-output']
})
const toStringTr = new Transform({
  objectMode: true,

  transform(chunk: any, encoding: string, callback: any) {
    this.push(chunk + '\n')
    callback()
  }
})

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false
})

rl.on('line', (line) => {
  app.emit('nmea2000out', line)
})

actisense.pipe(toStringTr).pipe(process.stdout)
