const { invert, propertyOf } = require('lodash/fp')
const manufacturerNames = require('./codesMfgs.json')

const industryCodes = {
  0: 'Global',
  1: 'Highway',
  2: 'Agriculture',
  3: 'Construction',
  4: 'Marine Industry',
  5: 'Industrial'
}

const deviceClassCodes = {
  0: 'Reserved for 2000 Use',
  10: 'System tools',
  20: 'Safety systems',
  25: 'Internetwork device',
  30: 'Electrical Distribution',
  35: 'Electrical Generation',
  40: 'Steering and Control surfaces',
  50: 'Propulsion',
  60: 'Navigation',
  70: 'Communication',
  75: 'Sensor Communication Interface',
  80: 'Instrumentation/general systems',
  85: 'External Environment',
  90: 'Internal Environment',
  100: 'Deck + cargo + fishing equipment systems',
  120: 'Display',
  125: 'Entertainment'
}

const deviceClassNames = invert(deviceClassCodes)
const industryNames = invert(industryCodes)
industryNames['Marine'] = 4

const defaultTransmitPGNs = [
  126992,  // systemTime
  128267,  // waterDepth
  129794,  // aisClassAStaticAndVoyageRelatedData
  129038,  // aisClassAPositionReport
  129041,  // aisAidsToNavigationAtonReport
  127505,  // fluidLevel
  127506,  // dcDetailedStatus
  127508,  // batteryStatus
  129026,  // cogSogRapidUpdate
  129025,  // positionRapidUpdate
  129029,  // gnssPositionData
  127250,  // vesselHeading
  130306,  // windData
  126720,  // 0x1ef00ManufacturerProprietaryFastPacketAddressed
  127489,  // engineParametersDynamic
  127488,  // engineParametersRapidUpdate
  130311,  // environmentalParameters
  130312,  // temperature
  127257,  // attitude
  128259,  // speed
  127502   // switchBankControl
]

const defaultReceivePGNs = [
  126992,  // systemTime
  128267,  // waterDepth
  129794,  // aisClassAStaticAndVoyageRelatedData
  129038,  // aisClassAPositionReport
  129041,  // aisAidsToNavigationAtonReport
  127505,  // fluidLevel
  127506,  // dcDetailedStatus
  127508,  // batteryStatus
  129026,  // cogSogRapidUpdate
  129025,  // positionRapidUpdate
  129029,  // gnssPositionData
  127250,  // vesselHeading
  130306,  // windData
  126720,  // 0x1ef00ManufacturerProprietaryFastPacketAddressed
  127489,  // engineParametersDynamic
  127488,  // engineParametersRapidUpdate
  130311,  // environmentalParameters
  130312,  // temperature
  127257,  // attitude
  128259,  // speed
  127502   // switchBankControl
]

const manufacturerCodes = invert(manufacturerNames)
module.exports.manufacturerCodes = manufacturerCodes
module.exports.getIndustryName = propertyOf(industryCodes)
module.exports.getManufacturerName = propertyOf(manufacturerCodes)
module.exports.getIndustryCode = propertyOf(industryNames)
module.exports.getManufacturerCode = propertyOf(manufacturerNames)
module.exports.getDeviceClassCode = propertyOf(deviceClassNames)
module.exports.getDeviceClassName = propertyOf(deviceClassCodes)
module.exports.defaultTransmitPGNs = defaultTransmitPGNs
module.exports.defaultReceivePGNs = defaultReceivePGNs
