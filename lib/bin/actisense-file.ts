#!/usr/bin/env node

import { EventEmitter } from 'node:events'
import minimist from 'minimist'
import { serial } from '../index'
import { Transform } from 'stream'
import fs from 'fs'

var device

const argv = minimist(process.argv.slice(2), {
  alias: { h: 'help' }
})

if ( argv['help'] ) {
  console.error(`Usage: ${process.argv[0]} file

Options:
  -h, --help       output usage information`)
  process.exit(1)
}

if ( argv['_'].length === 0 ) {
  console.error('Please specify a file')
  process.exit(1)
}

const app = new EventEmitter();

const actisense = new (serial as any)({ app:app, plainText:true, disableSetTransmitPGNs: true,  fromFile: true })

const toStringTr = new Transform({
  objectMode: true,

  transform(chunk:any, encoding:string, callback:any) {
    this.push(chunk + "\n");
    callback();
  }
});

actisense.pipe(toStringTr).pipe(process.stdout)

const filestream = fs.createReadStream(argv['_'][0])
filestream.on('error', err => {
  console.error(err.message)
})
filestream.on('end', () => {
  process.exit(0)
})
filestream.pipe(actisense)
