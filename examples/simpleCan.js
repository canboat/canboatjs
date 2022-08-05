
const canboatjs = require('../index')
//const canboatjs = require('@canboat/canboatjs')
const Parser = require('../index').FromPgn
var parser = new canboatjs.FromPgn()

let messageCb = (data) => {
  let jsonData = parser.parse(data, (err) => { if ( err ) console.error(err) })
  if ( jsonData ) {
    //process
  }
}

let simpleCan = new canboatjs.SimpleCan({
  canDevice: 'can0',
  preferredAddress: 35,
  disableDefaultTransmitPGNs: true,
  transmitPGNs: [],
  addressClaim: {
    "Unique Number": 139725,
    "Manufacturer Code": 'Fusion Electronics',
    "Device Function": 130,
    "Device Class": 'Entertainment',
    "Device Instance Lower": 0,
    "Device Instance Upper": 0,
    "System Instance": 0,
    "Industry Group": 'Marine'
  },
  productInfo: {
    "NMEA 2000 Version": 1300,
    "Product Code": 667,
    "Model ID": "MS-UD650",
    "Software Version Code": "1.0",
    "Model Version": "1.0",
    "Model Serial Code": "123456",
    "Certification Level": 0,
    "Load Equivalency": 1
  }
}, messageCb)

simpleCan.start()

