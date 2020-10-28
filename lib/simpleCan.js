const CanDevice = require('./candevice')
const debug = require('debug')('canboatjs:simpleCan')
const { encodeCanId, parseCanId } = require('./canId')
const { toActisenseSerialFormat, parseActisense } = require('./stringMsg')
const { toPgn } = require('./toPgn')
const { getPlainPGNs } = require('./utilities')
const _ = require('lodash')

function SimpleCan (options, messageCb) {
  this.options = options
  this.messageCb = messageCb
  this.plainText = false
  this.socketcan = require('socketcan')
}

SimpleCan.prototype.start = function () {
  const canDevice = this.options.canDevice || 'can0'
  
  this.channel = this.socketcan.createRawChannel(canDevice);
  if ( this.messageCb ) {
    this.channel.addListener('onMessage', (msg) => {
      var pgn = parseCanId(msg.id)
      
      if ( this.candevice && this.candevice.cansend && pgn.src == this.candevice.address ) {
        return
      }
      
      pgn.timestamp = new Date().toISOString()
      if ( this.plainText ) {
        messageCb(binToActisense(pgn, msg.data, msg.data.length))
      } else {
        messageCb({ pgn, length: msg.data.length, data: msg.data })
      }
    })
  }
  this.channel.start()
  this.candevice = new CanDevice(this,
                                 {...this.options,
                                  disableDefaultTransmitPGNs: true,
                                  disableNAKs: true
                                 },
)
  this.candevice.start()
}

SimpleCan.prototype.sendPGN = function (msg) {
  if ( this.candevice ) {
    if ( !this.candevice.cansend && msg.pgn !== 59904 && msg.pgn !== 60928 && msg.pgn !== 126996 ) {
      debug('ignoring %j', msg)
      return
    }

    debug('sending %j', msg)

    let src = msg.pgn === 59904 || msg.forceSrc ? msg.src : this.candevice.address
    if ( _.isString(msg) ) {
      var split = msg.split(',')
      split[3] = src
      msg = split.join(',')
    } else {
      msg.src = src
      if ( _.isUndefined(msg.prio) ) {
        msg.prio = 3
      }
      if ( _.isUndefined(msg.dst) ) {
        msg.dst = 255
      }
    }

    var canid
    var buffer
    
    var pgn
    if ( _.isObject(msg) ) {
      canid = encodeCanId(msg)
      buffer = toPgn(msg)
      pgn = msg
    } else {
      pgn = parseActisense(msg)
      canid = encodeCanId(pgn)
      buffer = pgn.data
    }
    
    if ( debug.enabled ) {
      var str = toActisenseSerialFormat(pgn.pgn, buffer, pgn.dst, pgn.src)
      debug(str)
    }
    
    //seems as though 126720 should always be encoded this way
    if ( buffer.length > 8 || pgn.pgn == 126720 ) {
      var pgns = getPlainPGNs(buffer)
      pgns.forEach(pbuffer => {
        this.channel.send({id: canid, ext:true, data: pbuffer})
      })
    } else {
      this.channel.send({id: canid, ext:true, data: buffer})
    }
  }
}

function binToActisense(pgn, data, length) {
  return (
    pgn.timestamp +
      `,${pgn.prio},${pgn.pgn},${pgn.src},${pgn.dst},${length},` +
      new Uint32Array(data)
      .reduce(function(acc, i) {
        acc.push(i.toString(16));
        return acc;
      }, [])
      .map(x => (x.length === 1 ? "0" + x : x))
      .join(",")
  );
}

module.exports = SimpleCan
