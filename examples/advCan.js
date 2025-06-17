/**
 * CMC Marine N2K Device
 */

// Import canboatjs library
const canboatjs = require("@canboat/canboatjs");
const parser = new canboatjs.FromPgn();

const slmp = require("./slmp_client.js");
const slmp_ = require("./slmp_const.js");

const plc_addr = "192.168.3.252";
const plc_port = "5005";
const plc_udp = true;
let slmp_cli = new slmp.SLMP_Client(plc_addr,plc_port,options={is_udp:plc_udp});
slmp_cli.connect();

// Device configuration
const can_device = "can1"
const preferred_address = 48
const handle_iso_requests = true
const transmit_pgns = []
const receive_pgns = []
let cli;

// Pruduct description : TO BE EXPLAINED
const address_claim = {
  "Unique Number": Math.floor(Math.random() * Math.floor(2097151)),
  "Manufacturer Code": 1850,
  "Device Function": 130,
  "Device Class": "Steering and Control surfaces",
  "Device Instance Lower": 0,
  "Device Instance Upper": 0,
  "System Instance": 0,
  "Industry Group": "Marine"
}
const product_info = {
  "NMEA 2000 Version": 1.301,
  "Product Code": 11497,
  "Model ID": "Steering Controller",
  "Software Version Code": "SW0250RevAH (RSCP V1 L1)",
  "Model Version": "Optimus",
  "Model Serial Code": "SP0562400038",
  "Certification Level": 1,
  "Load Equivalency": 0 
}

var transmission_gear = 0;
var unknown_source;

var rudder = {
  position: 0,
  angle_order: 0,
  limit: Math.PI*0.2,
  speed: 0.002,
  symulate: true,
  source: undefined,
  difference: 0
};
var auto = {
  position: 0,
  angle_order: 0,
  last_angle_order: 0,
  control: false
};
var helm = {
  diff: {
    max: 0.1,  // max radians at which the resistance goes up to 100
    pow: 1,  // exponential power of the curve of the difference
    res: 0  // exponential power of the curve of the difference
  },
  zero: {
    max: 0.01,  // exponential power of the curve of the limit
    pow: 0.01,  // exponential power of the curve of the limit
    res: 100,  // max resistance reached at the rudder wheel limit
    counter: 30,
    speed: {
      min: 0.0,
      max: 1.0
    }
  },
  zero_counter: 0,
  limit: {
    max: 1,  // exponential power of the curve of the limit
    pow: 1,  // exponential power of the curve of the limit
    res: 70  // max resistance reached at the rudder wheel limit
  },
  ctrl: {
    max: 0.05,
    res: 80  // fixed resistance when not in control
  },
  control_resistance: 70,
  turns: 4,
  resistance: 0,
  angle_order: 0,
  position: 0,
  last_angle_order: 0,
  diff_angle_order: 0,
  old_angle_order: 0,
  control: false,
  init: false,
  sync: false,
  source: undefined
};

function setControl(type) {
  let auto_control = type === "auto";
  let helm_control = type === "helm";
  if (helm.control && !helm_control)
    helm.last_angle_order = helm.angle_order;
  if (auto.control && !auto_control)
    auto.last_angle_order = auto.angle_order;
  auto.control = auto_control;
  helm.control = helm_control;
}

var print = 0;

let messageCb = (jsonData) => { 
  if (jsonData.pgn == 127245) {
    let source = cli.candevice.devices[jsonData.src];
    if (source !== undefined && source.addressClaim !== undefined || jsonData.src == 17) {
      if (jsonData.src == 17) {
        helm.diff_angle_order = helm.angle_order;
        helm.old_angle_order = helm.angle_order;
        helm.angle_order = jsonData.fields["Angle Order"] ? jsonData.fields["Angle Order"] : helm.angle_order;
        helm.diff_angle_order = helm.angle_order - helm.diff_angle_order;
        helm.source = jsonData;
      }
      else if (source.addressClaim.fields["Manufacturer Code"] == "Garmin") {
        auto.angle_order = jsonData.fields["Angle Order"] ? jsonData.fields["Angle Order"] : auto.angle_order;
        auto.source = jsonData;
      } else unknown_source = jsonData;
      if (!helm.control && (Math.abs(helm.last_angle_order-helm.angle_order) > helm.ctrl.max))
        setControl("helm");
      if (auto.control)
        rudder.angle_order = auto.angle_order;
      else if (helm.control)
        rudder.angle_order = helm.angle_order * rudder.limit;
    }
    helm.position = rudder.position / rudder.limit;
  }
  if ([60928,0x1ee00,0x1f011].includes(jsonData.pgn)) {
    console.log(jsonData);
  }
  if ( jsonData.pgn == 65366 ) {
    for ( key of ["Sync flag", "Input A", "Input B", "Communication fault", "Hardware fault", "Sensor fault"] ) {
      if ( jsonData.fields[key] === "Yes" ) {
        console.log(jsonData);
        break;
      }
    }
  }
  if ( print > 0 && [65360,65365,65366].includes(jsonData.pgn) ) {
    console.log(jsonData);
    print--;
  }
}

let messageCb3 = (jsonData) => {
  auto.angle_order = jsonData.fields["Angle Order"] ? jsonData.fields["Angle Order"] : auto.angle_order;
  auto.source = jsonData;
  rudder.angle_order = auto.angle_order;
}

let messageCb2 = (data) => { 
  let jsonData = parser.parse(data, (err) => { if ( err ) console.error(err) })
  if (jsonData) {
    if (answer_reqs) { cli.candevice.n2kMessage(jsonData); }
    let source = cli.candevice.devices[jsonData.src];
    if (source !== undefined && source.addressClaim !== undefined) {
      if (source.addressClaim.fields["Manufacturer Code"] == "Furuno" &&
          source.addressClaim.fields["Device Function"] == 145 &&
          source.addressClaim.fields["Device Class"] == "Navigation") {
        console.log("==================================================================")
        console.log(data);
        console.log("------------------------------------------------------------------")
        console.log(jsonData);
      }
    }
  }
}

/*
let SimpleSLMP = new slmp_client.SLMP_Client(plc_addr,plc_port,options={is_udp:plc_udp});
SimpleSLMP.connect();

async function slmp_loop_100() {
  data = new Float32Array([rudder.angle_order*180/Math.PI]);
  await SimpleSLMP.batchWrite("D6000",data);
  let response = await SimpleSLMP.batchRead("D6000",4);
  rudder.angle_order = response.readFloatLE(0) * Math.PI / 180;
  position = response.readFloatLE(4) * Math.PI / 180;
};

var int_slmp;
SimpleSLMP.on("ready",()=> {int_slmp = setInterval(() => {
  slmp_loop_100();
}, 50);})
*/

cli = new canboatjs.N2K_Client(can_device,preferred_address,handle_iso_requests,address_claim,product_info,transmit_pgns, receive_pgns,false);
cli.on("data", messageCb3);
cli.start();

/*
async function main_loop_20() {
  rudder.difference = rudder.angle_order - rudder.position;
  if (rudder.symulate)
    rudder.position = rudder.position + Math.min(rudder.speed, Math.abs(rudder.difference)) * Math.sign(rudder.difference);
  if (helm.control) {
    helm.resistance = 0;
    if (helm.diff_angle_order * helm.angle_order >= 0.0)
      helm.resistance += Math.pow(Math.min(Math.abs(helm.angle_order) / helm.limit.max, 1), helm.limit.pow) * helm.limit.res;
    if (helm.diff_angle_order * (helm.angle_order - helm.position) >= 0.0)
      helm.resistance += Math.pow(Math.min(Math.abs(helm.angle_order - helm.position) / helm.diff.max, 1), helm.diff.pow) * helm.diff.res;
    if (Math.abs(helm.diff_angle_order) >= helm.zero.speed.min &&
        Math.abs(helm.diff_angle_order) <= helm.zero.speed.max &&
        Math.abs(helm.old_angle_order / helm.zero.max) >= 1.0) {
      if (((1 + helm.diff_angle_order/helm.angle_order)) < 0.0) {
        console.log(`zero trigger based on speed : ${helm.diff_angle_order} and ${helm.angle_order}`);
        helm.zero_counter = helm.zero.counter;
      } if (Math.abs(helm.angle_order / helm.zero.max) < 1.0) {
        console.log(`zero trigger based on position : ${helm.angle_order}, ${helm.old_angle_order} and ${helm.zero.max}`);
        helm.zero_counter = helm.zero.counter;
      }
    }
    if (helm.zero_counter-- > 0)
      helm.resistance += helm.zero.res;
    helm.resistance = Math.min(Math.max(helm.resistance,0),100);
  } else helm.resistance = helm.ctrl.res;
  cli.send( {
    prio: 6, dst: 255, pgn: 65465,
    fields: {
      "Manufacturer Code": "Teleflex Marine (SeaStar Solutions)", "Industry Code": "Global",
      "Sync request": helm.control && !helm.sync,
      "Spare": 0,
      "Reinstance request": helm.init,
      "Turns": helm.turns,
      "Resistance": helm.resistance
    }
  } );
  if (helm.control && !helm.sync)
    console.log("sent a sync request to helm");
  helm.sync = helm.control;
  helm.init = false;
}
*/

async function main_loop_100() {
  rudder.difference = rudder.angle_order - rudder.position;
  rudder.position = rudder.position + Math.min(rudder.speed, Math.abs(rudder.difference)) * Math.sign(rudder.difference);
  cli.send( {
    prio: 2, dst: 255, pgn: 127245,
    fields: { Instance: 0, "Angle Order": rudder.angle_order, Position: rudder.position }
  } );
  let data = new Float32Array([rudder.angle_order*180.0/Math.PI,rudder.position*180.0/Math.PI]);
  slmp_cli.batchWrite(slmp_.encode_device("D6000"),data);
}

async function main_loop_1000() {
  cli.send( { prio: 2, dst: 255, pgn: 127237, fields: { Override: "No", "Rudder Limit": 0.6108 } } );
  cli.send( { prio: 6, dst: 255, pgn: 65345, fields: { "Manufacturer Code": 1850 } } );
  cli.send( { prio: 6, dst: 255, pgn: 65409, fields: { "Manufacturer Code": 1850 } } );
  cli.send( { prio: 6, dst: 255, pgn: 0x1f205, fields: { "Instance": 0, "Transmission Gear": transmission_gear }});
}

var int_main = setInterval(() => {
  main_loop_100();
}, 50);


/*
var int_20 = setInterval(() => {
  main_loop_20();
}, 10);
*/

var int_1000 = setInterval(() => {
  main_loop_1000();
}, 1000);

