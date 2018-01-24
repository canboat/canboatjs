

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

const Transform = require('stream').Transform
const SerialPort = require('serialport')
const isArray = require('lodash').isArray

function SerialStream (options) {
  if (!(this instanceof SerialStream)) {
    return new SerialStream(options)
  }

  Transform.call(this, options)

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

  this.serial = new SerialPort(this.options.device, {
    baudRate: this.options.baudrate || 115200
  })

  this.serial.on(
    'open',
    function () {
      //send startup sequence
    }
  )

    this.serial.on('data', (data) => {
    readData(this, data)
  })
  
  this.serial.on('error', function (x) {
    console.log(x)
  })
  this.serial.on('close', this.start.bind(this))

  var that = this
  const stdOutEvent = this.options.toStdout
  if (stdOutEvent) {
    ;(isArray(stdOutEvent) ? stdOutEvent : [stdOutEvent]).forEach(event => {
      console.log(event)
      that.options.app.on(event, d => that.serial.write(d + '\r\n'))
    })
  }
}

function readData(that, data) {
  for ( var i = 0; i < data.length; i++ ) {
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
        that.push(that.buffer.slice(2, that.bufferOffset))
      }
      that.bufferOffset = 0
      that.stat = MSG_START;
    }
    else if (c == STX)
    {
      that.bufferOffset = 0
      that.stat = MSG_MESSAGE;
    }
    else if ((c == DLE) || ((c == ESC) && isFile) || that.noEscape)
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


SerialStream.prototype.end = function () {
  this.serial.close()
}

SerialStream.prototype._transform = function (chunk, encoding, done) {
  this.push(chunk)
  done()
}

module.exports = SerialStream
