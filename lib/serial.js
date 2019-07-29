/**
 * Copyright 2018 Scott Bender (scott@scottbender.net)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const debug = require('debug')('signalk:canbusjs')
const Transform = require('stream').Transform
const SerialPort = require('serialport')
const isArray = require('lodash').isArray
const BitStream = require('bit-buffer').BitStream
const BitView = require('bit-buffer').BitView
const { toPgn } = require('./toPgn')
const { encodeActisense } = require('./stringMsg')
const _ = require('lodash')

/* ASCII characters used to mark packet start/stop */

const STX = 0x02  /* Start packet */
const ETX = 0x03  /* End packet */
const DLE = 0x10  /* Start pto encode a STX or ETX send DLE+STX or DLE+ETX */
const ESC = 0x1B  /* Escape */

/* Actisense message structure is:

   DLE STX <command> <len> [<data> ...]  <checksum> DLE ETX

   <command> is a byte from the list below.
   In <data> any DLE characters are double escaped (DLE DLE).
   <len> encodes the unescaped length.
   <checksum> is such that the sum of all unescaped data bytes plus the command
              byte plus the length adds up to zero, modulo 256.
*/

const N2K_MSG_RECEIVED = 0x93  /* Receive standard N2K message */
const N2K_MSG_SEND     = 0x94  /* Send N2K message */
const NGT_MSG_RECEIVED = 0xA0  /* Receive NGT specific message */
const NGT_MSG_SEND     = 0xA1  /* Send NGT message */

const MSG_START = 1
const MSG_ESCAPE = 2
const MSG_MESSAGE = 3

const NGT_STARTUP_MSG = new Uint8Array([0x11, 0x02, 0x00])

function SerialStream (options) {
  if (!(this instanceof SerialStream)) {
    return new SerialStream(options)
  }

  Transform.call(this, {
    objectMode: true
  })

  this.reconnect = options.reconnect || true
  this.serial = null
  this.options = options
  this.start()
}

require('util').inherits(SerialStream, Transform)

SerialStream.prototype.start = function () {
  if (this.serial !== null) {
    this.serial.unpipe(this)
    this.serial.removeAllListeners()
    this.serial = null
  }

  if (this.reconnect === false) {
    return
  }

  this.buffer = new Buffer(500)
  this.bufferOffset = 0
  this.isFile = false
  this.state = MSG_START

  if ( !this.options.fromFile ) {
    this.serial = new SerialPort(this.options.device, {
      baudRate: this.options.baudrate || 115200
    })

    const setProviderStatus = this.options.app && this.options.app.setProviderStatus
          ? (msg) => {
            this.options.app.setProviderStatus(this.options.providerId, msg)
          }
          : () => {}
    const setProviderError = this.options.app && this.options.app.setProviderError
        ? (msg) => {
          this.options.app.setProviderError(this.options.providerId, msg)
        }
        : () => {}
    var that = this
    this.serial.on(
      'open',
      function () {
        try {
          setProviderStatus(`Connected to ${that.options.device}`)
          var buf = composeMessage(NGT_MSG_SEND, new Buffer(NGT_STARTUP_MSG), NGT_STARTUP_MSG.length)
          that.serial.write(buf)
          debug('sent startup message')
        } catch ( err ) {
          setProviderError(err.message)
          console.error(err)
          console.error(err.stack)
        }
      }
    )

    this.serial.on('data', (data) => {
      try {
        readData(this, data)
      } catch ( err ) {
        setProviderError(err.message)
        console.error(err)
      }
    })

    if ( this.options.app ) {
      this.options.app.on('nmea2000out', msg => {
        //debug(`sending ${msg}`)
        var buf = parseInput(msg)
        buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
        that.serial.write(buf)
      })

      this.options.app.on('nmea2000JsonOut', msg => {
        var data = toPgn(msg)
        var actisense = encodeActisense({ pgn: msg.pgn, data, dst: msg.dst})
        var buf = parseInput(actisense)
        buf = composeMessage(N2K_MSG_SEND, buf, buf.length)
        that.serial.write(buf)
      })

      this.options.app.emit('nmea2000OutAvailable')
    }

    this.serial.on('error', function (x) {
      setProviderError(x.message)
      console.log(x)
    })
    this.serial.on('close', () => {
      setProviderError('Closed, reconnecting...')
      this.start.bind(this)
    })
  }
}

SerialStream.prototype.sendPGNString = (pgm) => {
  var buf = parseInput(pgn)
  this.serial.write(buf)
}

function readData(that, data) {
  for ( var i = 0; i < data.length; i++ ) {
    //console.log(data[i])
    read1Byte(that, data[i])
  }
}

function read1Byte(that, c)
{
  var startEscape = false;
  var noEscape = false;

  //debug("received byte %02x state=%d offset=%d\n", c, state, head - buf);

  if (that.stat == MSG_START)
  {
    if ((c == ESC) && that.isFile)
    {
      noEscape = true;
    }
  }

  if (that.stat == MSG_ESCAPE)
  {
    if (c == ETX)
    {
      if ( that.buffer[0] == N2K_MSG_RECEIVED ) {
        processN2KMessage(that, that.buffer, that.bufferOffset)
        //that.push(that.buffer.slice(2, that.bufferOffset))
      } else if ( that.buffer[0] == NGT_MSG_RECEIVED) {
        processNTGMessage(that.buffer.slice(2, that.bufferOffset))
      }
      that.bufferOffset = 0
      that.stat = MSG_START;
    }
    else if (c == STX)
    {
      that.bufferOffset = 0
      that.stat = MSG_MESSAGE;
    }
    else if ((c == DLE) || ((c == ESC) && that.isFile) || that.noEscape)
    {
      that.buffer.writeUInt8(c, that.bufferOffset)
      that.bufferOffset++
      that.stat = MSG_MESSAGE;
    }
    else
    {
      console.error("DLE followed by unexpected char , ignore message");
      that.stat = MSG_START;
    }
  }
  else if (that.stat == MSG_MESSAGE)
  {
    if (c == DLE)
    {
      that.stat = MSG_ESCAPE;
    }
    else if (that.isFile && (c == ESC) && !noEscape)
    {
      that.stat = MSG_ESCAPE;
    }
    else
    {
      that.buffer.writeUInt8(c, that.bufferOffset)
      that.bufferOffset++
    }
  }
  else
  {
    if (c == DLE)
    {
      that.stat = MSG_ESCAPE;
    }
  }
}

function processNTGMessage(buffer)
{
  /*
  if (buffer.length < 12)
  {
    debug(`Ignore short msg len = ${buffer.length}`);
    return;
  }

  sprintf(line, "%s,%u,%u,%u,%u,%u", now(dateStr), 0, 0x40000 + msg[0], 0, 0, (unsigned int) msgLen - 1);
  p = line + strlen(line);
  for (i = 1; i < msgLen && p < line + sizeof(line) - 5; i++)
  {
    sprintf(p, ",%02x", msg[i]);
    p += 3;
  }
  *p++ = 0;

  puts(line);
  */
}

function addUInt8(num, add) {
  if ( num +  add > 255 ) {
    num = add - (256-num)
  } else {
    num += add
  }
  return num
}

function processN2KMessage(that, buffer, len)
{

  var checksum = 0

  for ( var i = 0; i < len; i++ ) {
    checksum = addUInt8(checksum, buffer[i])
  }

  if ( checksum != 0 ) {
    debug('received message with invalid checksum')
    return
  }


  if ( that.options.plainText ) {
    that.push(binToActisense(buffer.slice(2, len)))
  } else {
    that.push(buffer.slice(2, len))
  }
}

function binToActisense(buffer) {
  var bv = new BitView(buffer);
  var bs = new BitStream(bv)

  var pgn = {}

  pgn.prio = bs.readUint8()
  pgn.pgn = bs.readUint8() + 256 * (bs.readUint8() + 256 * bs.readUint8());
  pgn.dst = bs.readUint8()
  pgn.src = bs.readUint8()
  pgn.timestamp = bs.readUint32()
  var len = bs.readUint8()
  return (
    new Date().toISOString() +
      `,${pgn.prio},${pgn.pgn},${pgn.src},${pgn.dst},${len},` +
      new Uint32Array(buffer.slice(11, 11+len))
      .reduce(function(acc, i) {
        acc.push(i.toString(16));
        return acc;
      }, [])
      .map(x => (x.length === 1 ? "0" + x : x))
      .join(",")
  );
}


function composeMessage(command, buffer, len)
{
  var outBuf = new Buffer(500);
  var out = new BitStream(outBuf)

  out.writeUint8(DLE)
  out.writeUint8(STX)
  out.writeUint8(command)

  var lenPos = out.byteIndex
  out.writeUint8(0) //length. will update later
  var crc = command;

  for (var i = 0; i < len; i++)
  {
    var c = buffer.readUInt8(i)
    if (c == DLE)
    {
      out.writeUint8(DLE);
    }
    out.writeUint8(c)
    crc = addUInt8(crc, c)
  }

  crc = addUInt8(crc, len)

  out.writeUint8(256-crc)
  out.writeUint8(DLE)
  out.writeUint8(ETX)

  out.view.buffer.writeUInt8(len, lenPos)

  //debug(`command ${out.view.buffer[2]} ${lenPos} ${len} ${out.view.buffer[lenPos]} ${out.view.buffer.length} ${out.byteIndex}`)


  return out.view.buffer.slice(0, out.byteIndex)
}

function parseInput(msg)
{
  var split = msg.split(',')
  var buffer = new Buffer(500)
  var bs = new BitStream(buffer)

  var prio = Number(split[1])
  var pgn = Number(split[2])
  var dst = Number(split[4])
  var bytes = Number(split[5])

  bs.writeUint8(prio)
  bs.writeUint8(pgn)
  bs.writeUint8(pgn >> 8)
  bs.writeUint8(pgn >> 16)
  bs.writeUint8(dst)

  /*
  bs.writeUint8(split[3])
  bs.writeUint32(0)
  */

  bs.writeUint8(bytes)

  for ( var i = 6; i < (bytes+6); i++ ) {
    bs.writeUint8(parseInt('0x' + split[i], 16))
  }

  return bs.view.buffer.slice(0, bs.byteIndex)
}

SerialStream.prototype.end = function () {
  this.serial.close()
}

SerialStream.prototype._transform = function (chunk, encoding, done) {
  debug(`got data ${typeof chunk}`)
  readData(this, chunk)
  done()
}

module.exports = SerialStream
