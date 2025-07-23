/**
 * CMC Marine N2K Client
 */

// Import canboatjs library
const {toPgn} = require('./toPgn');
const {Parser} = require('./fromPgn');
const parser = new Parser();
const _ = require("lodash");
const socketcan = require("socketcan");
const EventEmitter = require("events");
const CanDevice = require("./candevice");
const canutils = require("./utilities");
const canid = require("./canId");

//---------------------------------------------------------------------------------------------
// n2k client

const GLOBAL_PGNS = [ 60928, 59904, 126996, 126464 ];

class N2K_Client extends EventEmitter {

    constructor(options) {
        super();
        this.options = options;
        this.debug = false;
        this.channel = undefined;
        this.candevice = undefined;
        this.pgn_ids = {};
        this.options.transmitPGNs = _.union(GLOBAL_PGNS,this.options.transmitPGNs);
        this.options.receivePGNs = _.union(GLOBAL_PGNS,this.options.receivePGNs);
        for (let pgn of this.options.transmitPGNs)
            this.pgn_ids[pgn] = 0;
    }
    connect() {
        this.channel = socketcan.createRawChannel(this.options.canDevice,true);
        if (this.options.receiveFilter && this.options.receivePGNs.length > 0)
            this.channel.setRxFilters(this.options.receivePGNs.map((pgn)=>({id:(pgn<<8), mask: ((pgn>>8)<240 ? 0x3FF0000 : 0x3FFFF00)})));
        this.channel.addListener("onMessage", (msg) => { this.onData(msg); })
                    .addListener("onStopped", () => { this.onStop(); })
                    .start();
        this.candevice = new CanDevice(this, this.options);
        this.candevice.on("nmea2000OutAvailable",() => { this.emit("connect"); });
    }
    start() { return this.connect(); }

    close() {
        if ( this.channel ) {
            let channel = this.channel;
            delete this.channel;
            delete this.candevice;
            try { channel.stop() } catch ( error ) { }
        }
    }
    stop() { return this.close(); }

    send(msg) {
        if (!this.candevice) return;
        if (!(this.candevice.cansend || msg.pgn in GLOBAL_PGNS)) return;
        if (_.isUndefined(msg.src) || !(msg.pgn === 59904 || msg.forceSrc)) msg.src = this.candevice.address;
        if (_.isUndefined(msg.prio)) msg.prio = 3;
        if (_.isUndefined(msg.dst)) msg.dst = 255;
        const buffer = toPgn(msg);
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

    getSources(src,sources) {
        const device = this.candevice.getDeviceFromSrc(src);
        if (!device.updated)
            return device.sources;
        device.sources = [];
        device.fields = Object.assign({sourceAddress: src},device.addressClaim.fields,device.productInformation.fields);
        let match;
        for (const source of sources) {
            match = true;
            for (const [key,value] of source.fields) {
                if (device.fields[key]===value) continue;
                match = false;
                break;
            }
            if (match)
                device.sources.push(source.source);
        }
        device.updated = false;
        return device.sources;
    }

    // callbacks

    onStop() {
        if ( this.channel ) { // stopped by us?
            delete this.channel;
            delete this.candevice;
            setTimeout(() => { this.connect() }, 2000)
        }
    }
    onData(msg) {
        if (this.candevice && !this.channel.ready) {
            this.candevice.start();
            this.channel.ready = true;
        }
        if (this.options.debug) this.emit("debug",msg);
        let pgn = canid.parseCanId(msg.id);
        if (this.candevice && this.candevice.cansend && pgn.src == this.candevice.address)
            return;
        pgn.timestamp = new Date(msg.ts_sec*1000 + msg.ts_usec/1000).toISOString();
        let data = parser.parse(
            {pgn, length: msg.data.length, data: msg.data},
            (err) => { if(err) this.emit("error",err); });
        if (data && (data.dst===255 || data.dst===this.candevice.address)) {
            if(this.options.handleISOrequests)
                this.candevice.n2kMessage(data);
            this.emit("data",data);
        }
    }
}

//---------------------------------------------------------------------------------------------
// EXPORTS

module.exports = N2K_Client;
