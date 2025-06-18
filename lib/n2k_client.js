/**
 * CMC Marine N2K Device
 */

// Import canboatjs library
const canboatjs = require("@canboat/canboatjs");
const parser = new canboatjs.FromPgn();
const _ = require("lodash");
const socketcan = require("socketcan");
const EventEmitter = require("events");
const CanDevice = require("@canboat/canboatjs/lib/candevice.js");
const canutils = require("@canboat/canboatjs/lib/utilities.js");
const canid = require("@canboat/canboatjs/lib/canId.js");

//---------------------------------------------------------------------------------------------
// n2k client

class N2K_Client extends EventEmitter {

    constructor(options) {
        super();
        this.options = options;
        this.debug = false;
        this.channel = undefined;
        this.candevice = undefined;
        this.pgn_ids = {};
        for (let pgn of this.options.transmitPGNs)
            this.pgn_ids[pgn] = 0;
    }
    connect() {
        this.channel = socketcan.createRawChannel(this.options.canDevice,true);
        this.channel.addListener("onMessage", (msg) => { this.onData(msg); });
        this.channel.addListener("onStopped", (msg) => { this.onStop(msg); });
        this.channel.start();
        this.candevice = new CanDevice(this, this.options);
        this.candevice.start();
        this.emit("connect");
    }
    start() { return this.connect() }
    
    close() {
        if ( this.channel ) {
            let channel = this.channel
            delete this.channel
            channel.stop()
        }
    }
    stop() { return this.close() }

    send(msg) {
        if (!this.candevice) return;
        if (!(this.candevice.cansend || msg.pgn in [59904,60928,126996])) return;
        if (_.isUndefined(msg.src) || !(msg.pgn === 59904 || msg.forceSrc)) msg.src = this.candevice.address;
        if (_.isUndefined(msg.prio)) msg.prio = 3;
        if (_.isUndefined(msg.dst)) msg.dst = 255;
        const buffer = canboatjs.toPgn(msg);
        const can_id = canid.encodeCanId(msg);
        if (buffer.length>8 || msg.pgn === 126720) {
            if (this.pgn_ids[msg.pgn] === undefined ) this.pgn_ids[msg.pgn] = 0;
            canutils.getPlainPGNs(buffer,this.pgn_ids[msg.pgn]).forEach(buff => {
                this.channel.send({id:can_id, ext:true, data:buff})
            });
            this.pgn_ids[msg.pgn] = (this.pgn_ids[msg.pgn]+1) % 8;
        } else
            this.channel.send({id:can_id, ext:true, data:buffer});
    }
    sendPGN(msg) { return this.send(msg); }

    // callbacks

    onStop(msg) {
        if ( this.channel ) { // stoped by us?
            delete this.channel 
            setTimeout(() => { this.connect() }, 2000)
        }
    }

    onData(msg) {
        if (this.options.debug) this.emit("debug",msg);
        let pgn = canid.parseCanId(msg.id);
        if (this.candevice && this.candevice.cansend && pgn.src == this.candevice.address)
            return;
        pgn.timestamp = new Date(msg.ts_sec*1000 + msg.ts_usec/1000).toISOString();
        let data = parser.parse(
            {pgn, length: msg.data.length, data: msg.data},
            (err) => { if(err) this.emit("error",err); });
        if (data) {
            if(this.options.handleISOrequests)
                this.candevice.n2kMessage(data);
            this.emit("data",data);
        }
    }

}

//---------------------------------------------------------------------------------------------
// EXPORTS

module.exports = N2K_Client;
