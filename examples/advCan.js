/**
 * CMC Marine N2K Device
 */

// Import canboatjs library
const canboatjs = require("../index");

// Pruduct description
const address_claim = {
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

let messageCb = (jsonData) => {
  console.log(jsonData);
  // process
}

let cli = new canboatjs.N2K_Client({
  canDevice: "can0",
  preferredAddress: 48,
  transmitPGNs: [],
  disableDefaultTransmitPGNs: false,
  receivePGNs: [],
  disableDefaultReceivePGNs: false,
  addressClaim: address_claim,
  productInfo: product_info,
  disableNAKs: true,
  handleISOrequests: true,
  debug: true
});

cli.on("data", messageCb);
cli.start();
