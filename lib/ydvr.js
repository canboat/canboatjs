const BitStream = require('bit-buffer').BitStream;
const Transform = require('stream').Transform;
const FromPgn = require('./fromPgn').Parser
const parseCanId = require('./canId').parseCanId;

// https://www.yachtd.com/downloads/ydvr04.pdf Appendix D
var sequencePgns = new Set([
  65240,
  126208,
  126464,
  126720,
  126983,
  126984,
  126985,
  126986,
  126987,
  126988,
  126996,
  126998,
  127233,
  127237,
  127489,
  127496,
  127497,
  127498,
  127503,
  127504,
  127506,
  127507,
  127509,
  127510,
  127511,
  127512,
  127513,
  127514,
  128275,
  128520,
  129029,
  129038,
  129039,
  129040,
  129041,
  129044,
  129045,
  129284,
  129285,
  129301,
  129302,
  129538,
  129540,
  129541,
  129542,
  129545,
  129547,
  129549,
  129551,
  129556,
  129792,
  129793,
  129794,
  129795,
  129796,
  129797,
  129798,
  129799,
  129800,
  129801,
  129802,
  129803,
  129804,
  129805,
  129806,
  129807,
  129808,
  129809,
  129810,
  130052,
  130053,
  130054,
  130060,
  130061,
  130064,
  130065,
  130066,
  130067,
  130068,
  130069,
  130070,
  130071,
  130072,
  130073,
  130074,
  130320,
  130321,
  130322,
  130323,
  130324,
  130567,
  130577,
  130578,
  130816,
]);

function YdvrStream() {
  if (!(this instanceof YdvrStream)) {
    return new YdvrStream();
  }

  this.parser = new FromPgn();

  this.parser.on('error', (pgn, error) => {
    console.error(`Error parsing ${pgn.pgn} ${error}`);
    console.error(error.stack);
  });

  this.parser.on('warning', (pgn, error) => {
    //console.error(`Warning parsing ${pgn.pgn} ${error}`)
  });

  // this.parser.on('pgn', (pgn) => {
  //   console.log(JSON.stringify(pgn));
  // });

  Transform.call(this, {
    objectMode: true,
  });
}

require('util').inherits(YdvrStream, Transform);

YdvrStream.prototype.end = function () {
  // console.log('end');
};

YdvrStream.prototype.parseNextRecord = function () {
  if (this.bs.bitsLeft < 6 * 8) {
    return false;
  }

  var time = this.bs.readUint16();
  let timeAbsolute;
  if (this.lastTime != null && time < this.lastTime) {
    this.timeOffset = (this.timeOffset || 0) + 60000;
    timeAbsolute = time + this.timeOffset;
  } else {
    timeAbsolute = time;
  }
  this.lastTime = time;

  var identifier = this.bs.readUint32();
  if (identifier === 0xffffffff) {
    // service record
    var srData = this.bs.readArrayBuffer(8);
  } else {
    const pgn = parseCanId(identifier);

    var bodyLen;
    if (pgn.pgn == 59904) {
      bodyLen = 3;
    } else if (sequencePgns.has(pgn.pgn)) {
      var seq = this.bs.readUint8();
      bodyLen = this.bs.readUint8();
    } else {
      bodyLen = 8;
    }
    var body = this.bs.readArrayBuffer(bodyLen);

    const parsed = this.parser.parsePgnData(
      { ...pgn, time: new Date(time).toISOString().slice(11, 23) },
      bodyLen,
      Buffer.from(body),
      false,
      undefined
    );
    if (parsed) {
      this.push(parsed);
    }
  }

  return true;
}

YdvrStream.prototype._transform = function (chunk, encoding, done) {
  if (this.bs == null) {
    this.bs = new BitStream(chunk);
  } else {
    var remainingBuffer = this.bs.view.buffer.subarray(this.bs.byteIndex);
    this.bs = new BitStream(Buffer.concat([remainingBuffer, chunk]));
  }
  while (true) {
    var startIndex = this.bs.byteIndex
    let parsed = false;
    try {
      parsed = this.parseNextRecord();
    } catch (ex) { }
    if (!parsed) {
      this.bs.byteIndex = startIndex;
      break;
    }
  }
  done();
};

module.exports = YdvrStream
