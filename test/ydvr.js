const moment = require("moment");
const chai = require("chai");
chai.Should();
chai.use(require("chai-things"));
chai.use(require("chai-json-equal"));
chai.use(require("chai-string"));
const fs = require("fs");
const path = require("path");
const YdvrStream = require('../lib/ydvr.js');

describe("Read Yacht Devices Voyage Recorder files", function () {
  it("Reads 00090013.DAT", function (done) {
    const filestream = fs.createReadStream(path.join(__dirname, "data", "00090013.DAT"));
    const serial = YdvrStream();

    let firstMessage;
    let lastMessage;
    filestream.pipe(serial).on("data", msg => {
      if (firstMessage == null) {
        firstMessage = msg;
      }
      lastMessage = msg;
    });

    filestream.on("end", () => {
      chai.expect(serial.messageCount).eq(179450);
      chai.expect(serial.errorCount).eq(0);
      chai.expect(serial.timerResetCount).eq(10);
      chai.expect(firstMessage.pgn).eq(127245);
      chai.expect(firstMessage.time).eq('00:00:18.962');
      chai.expect(lastMessage.pgn).eq(130824);
      chai.expect(lastMessage.time).eq('00:00:06.174');
      done();
    })
    filestream.on("error", (err) => {
      done(err);
    })
  });
});
