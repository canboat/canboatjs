#!/usr/bin/env node

import { Transform } from 'stream'
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'

if (process.argv.length < 3) {
  console.error('Please specify a device')
  console.error('usage: ikonvert-serial [device] [baud,default:230400]')
  process.exit(1)
}

const device = process.argv[2]

const baud = process.argv.length > 3 ? Number(process.argv[3]) : 230400

const serial = new SerialPort({
  path: device,
  baudRate: baud
})

const toStringTr = new Transform({
  objectMode: true,

  transform(line, encoding, callback) {
    //this.push(JSON.stringify(chunk) + "\n");
    console.log(line)

    if (line.startsWith('$PDGY,000000,,,,,')) {
      serial.write('$PDGY,N2NET_INIT,ALL\r\n')
    }

    callback()
  }
})

serial.on('open', function () {
  const parser = new ReadlineParser()
  serial.pipe(parser).pipe(toStringTr)
})

serial.on('error', (x: any) => {
  console.log(x)
})
