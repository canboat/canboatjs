/**
 * Copyright 2025 Scott Bender (scott@scottbender.net)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  PGN,
  PGN_60928,
  PGN_59904,
  PGN_126208,
  PGN_126208_Acknowledge,
  PGN_126208_Command,
  PGN_126996,
  PGN_126993,
  PGN_59392,
  PGN_126464,
  PgnListFunction,
  GroupFunction,
  PgnErrorCode,
  TransmissionInterval,
  ControllerState,
  IsoControl
} from '@canboat/pgns'
import { createDebug } from './utilities'
import { EventEmitter } from 'node:events'
import _ from 'lodash'
import { Uint64LE } from 'int64-buffer'
import { defaultTransmitPGNs } from './codes'
import { toPgn } from './toPgn'
import packageJson from '../package.json'

const debug = createDebug('canboatjs:n2kdevice')

const deviceTransmitPGNs = [60928, 59904, 126996, 126464]

export class N2kDevice extends EventEmitter {
  addressClaim: any
  productInfo: any
  configurationInfo: any
  options: any
  address: number
  cansend: boolean
  foundConflict: boolean
  heartbeatCounter: number
  devices: any
  sentAvailable: boolean
  addressClaimDetectionTime: number
  transmitPGNs: number[]
  addressClaimSentAt?: number
  addressClaimChecker?: any
  heartbeatInterval?: any

  constructor(options: any) {
    super()

    if (options.addressClaim) {
      this.addressClaim = options.addressClaim
      this.addressClaim.pgn = 60928
      this.addressClaim.dst = 255
      this.addressClaim.prio = 6
    } else {
      this.addressClaim = {
        pgn: 60928,
        dst: 255,
        prio: 6,
        'Unique Number': 1263,
        'Manufacturer Code': 999,
        'Device Function': 130, // PC gateway
        'Device Class': 25, // Inter/Intranetwork Device
        'Device Instance Lower': 0,
        'Device Instance Upper': 0,
        'System Instance': 0,
        'Industry Group': 4, // Marine
        Reserved1: 1,
        Reserved2: 2
      }
      this.addressClaim['Unique Number'] =
        options.uniqueNumber || Math.floor(Math.random() * Math.floor(2097151))
    }

    const version = packageJson ? packageJson.version : '1.0'

    if (options.productInfo) {
      this.productInfo = options.productInfo
      this.productInfo.pgn = 126996
      this.productInfo.dst = 255
    } else {
      this.productInfo = {
        pgn: 126996,
        dst: 255,
        'NMEA 2000 Version': 1300,
        'Product Code': 667, // Just made up..
        'Model ID': 'Signal K',
        'Model Version': 'canboatjs',
        'Model Serial Code': options.uniqueNumber
          ? options.uniqueNumber.toString()
          : '000001',
        'Certification Level': 0,
        'Load Equivalency': 1
      }
    }

    this.productInfo['Software Version Code'] = version

    if (options.serverVersion && options.serverUrl) {
      this.configurationInfo = {
        pgn: 126998,
        dst: 255,
        'Installation Description #1': options.serverUrl,
        'Installation Description #2': options.serverDescription,
        'Manufacturer Information': options.serverVersion
      }
    }

    this.options = _.isUndefined(options) ? {} : options

    this.address = _.isUndefined(options.preferredAddress)
      ? 100
      : options.preferredAddress
    this.cansend = false
    this.foundConflict = false
    this.heartbeatCounter = 0
    this.devices = {}
    this.sentAvailable = false
    this.addressClaimDetectionTime =
      options.addressClaimDetectionTime !== undefined
        ? options.addressClaimDetectionTime
        : 5000

    if (!options.disableDefaultTransmitPGNs) {
      this.transmitPGNs = _.union(deviceTransmitPGNs, defaultTransmitPGNs)
    } else {
      this.transmitPGNs = [...deviceTransmitPGNs]
    }

    if (this.options.transmitPGNs) {
      this.transmitPGNs = _.union(this.transmitPGNs, this.options.transmitPGNs)
    }
  }

  start() {
    sendISORequest(this, 60928, 254)
    setTimeout(() => {
      sendAddressClaim(this)
    }, 1000)
  }

  setStatus(msg: string) {
    if (this.options.app && this.options.app.setPluginStatus) {
      this.options.app.setProviderStatus(this.options.providerId, msg)
    }
  }

  n2kMessage(pgn: PGN) {
    if (pgn.dst == 255 || pgn.dst == this.address) {
      try {
        if (pgn.pgn == 59904) {
          handleISORequest(this, pgn)
        } else if (pgn.pgn == 126208) {
          handleGroupFunction(this, pgn as PGN_126208)
        } else if (pgn.pgn == 60928) {
          handleISOAddressClaim(this, pgn as PGN_60928)
        } else if (pgn.pgn == 126996) {
          handleProductInformation(this, pgn)
        }
      } catch (err) {
        console.error(err)
      }

      /*
      var handler = this.handlers[pgn.pgn.toString()]
      if ( pgn.dst == this.address )
        debug(`handler ${handler}`)
      if ( _.isFunction(handler) ) {
        debug(`got handled PGN %j  ${handled}`, pgn)
        handler(pgn)
      }
      */
    }
  }

  sendPGN(_pgn: PGN, _src: number | undefined = undefined) {}
}

function handleISORequest(device: N2kDevice, n2kMsg: PGN_59904) {
  debug('handleISORequest %j', n2kMsg)

  const PGN = Number(n2kMsg.fields.pgn)

  switch (PGN) {
    case 126996: // Product Information request
      sendProductInformation(device)
      break
    case 126998: // Config Information request
      sendConfigInformation(device)
      break
    case 60928: // ISO address claim request
      debug('sending address claim %j', device.addressClaim)
      device.sendPGN(device.addressClaim as PGN)
      break
    case 126464:
      sendPGNList(device, n2kMsg.src!)
      break
    default:
      if (!device.options.disableNAKs) {
        debug(`Got unsupported ISO request for PGN ${PGN}. Sending NAK.`)
        sendNAKAcknowledgement(device, n2kMsg.src!, PGN)
      }
  }
}

function handleGroupFunction(device: N2kDevice, n2kMsg: PGN_126208) {
  debug('handleGroupFunction %j', n2kMsg)
  const functionCode = n2kMsg.fields.functionCode
  if (functionCode === 'Request') {
    handleRequestGroupFunction(device, n2kMsg)
  } else if (functionCode === 'Command') {
    handleCommandGroupFunction(device, n2kMsg)
  } else {
    debug('Got unsupported Group Function PGN: %j', n2kMsg)
  }

  function handleRequestGroupFunction(device: N2kDevice, n2kMsg: PGN_126208) {
    if (!device.options.disableNAKs) {
      // We really don't support group function requests for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"

      const PGN = n2kMsg.fields.pgn

      debug(
        "Sending 'PGN Not Supported' Group Function response for requested PGN",
        PGN
      )

      const acknowledgement: PGN_126208_Acknowledge = {
        pgn: 126208,
        dst: n2kMsg.src!,
        fields: {
          functionCode: GroupFunction.Acknowledge,
          pgn: PGN,
          pgnErrorCode: PgnErrorCode.NotSupported,
          transmissionIntervalPriorityErrorCode:
            TransmissionInterval.Acknowledge,
          numberOfParameters: 0,
          list: []
        }
      }
      device.sendPGN(acknowledgement)
    }
  }

  function handleCommandGroupFunction(
    device: N2kDevice,
    n2kMsg: PGN_126208_Command
  ) {
    if (!device.options.disableNAKs) {
      // We really don't support group function commands for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"

      const PGN = n2kMsg.fields.pgn

      debug(
        "Sending 'PGN Not Supported' Group Function response for commanded PGN",
        PGN
      )

      const acknowledgement: PGN_126208_Acknowledge = {
        pgn: 126208,
        dst: n2kMsg.src!,
        fields: {
          functionCode: GroupFunction.Acknowledge,
          pgn: PGN,
          pgnErrorCode: PgnErrorCode.NotSupported,
          transmissionIntervalPriorityErrorCode:
            TransmissionInterval.Acknowledge,
          numberOfParameters: 0,
          list: []
        }
      }
      device.sendPGN(acknowledgement)
    }
  }
}

function handleISOAddressClaim(device: N2kDevice, n2kMsg: PGN_60928) {
  if (n2kMsg.src != device.address) {
    if (!device.devices[n2kMsg.src!]) {
      debug(`registering device ${n2kMsg.src}`)
      device.devices[n2kMsg.src!] = { addressClaim: n2kMsg }
      if (device.cansend) {
        //sendISORequest(device, 126996, undefined, n2kMsg.src)
      }
    }
    return
  }

  debug('Checking ISO address claim. %j', n2kMsg)

  const uint64ValueFromReceivedClaim = getISOAddressClaimAsUint64(n2kMsg)
  const uint64ValueFromOurOwnClaim = getISOAddressClaimAsUint64(
    device.addressClaim
  )

  if (uint64ValueFromOurOwnClaim < uint64ValueFromReceivedClaim) {
    debug(`Address conflict detected! Kept our address as ${device.address}.`)
    sendAddressClaim(device) // We have smaller address claim data -> we can keep our address -> re-claim it
  } else if (uint64ValueFromOurOwnClaim > uint64ValueFromReceivedClaim) {
    device.foundConflict = true
    increaseOwnAddress(device) // We have bigger address claim data -> we have to change our address
    debug(`Address conflict detected!  trying address ${device.address}.`)
    sendAddressClaim(device)
  }
}

function increaseOwnAddress(device: N2kDevice) {
  const start = device.address
  do {
    device.address = (device.address + 1) % 253
  } while (device.address != start && device.devices[device.address])
}

function handleProductInformation(device: N2kDevice, n2kMsg: PGN_126996) {
  if (!device.devices[n2kMsg.src!]) {
    device.devices[n2kMsg.src!] = {}
  }
  debug('got product information %j', n2kMsg)
  device.devices[n2kMsg.src!].productInformation = n2kMsg
}

function sendHeartbeat(device: N2kDevice) {
  device.heartbeatCounter = device.heartbeatCounter + 1
  if (device.heartbeatCounter > 252) {
    device.heartbeatCounter = 0
  }

  const hb: PGN_126993 = {
    pgn: 126993,
    dst: 255,
    prio: 7,
    fields: {
      dataTransmitOffset: 60,
      sequenceCounter: device.heartbeatCounter,
      controller1State: ControllerState.ErrorActive
    }
  }

  device.sendPGN(hb)
}

function sendAddressClaim(device: N2kDevice) {
  if (device.devices[device.address]) {
    //someone already has this address, so find a free one
    increaseOwnAddress(device)
  }
  debug(`Sending address claim ${device.address}`)
  device.sendPGN(device.addressClaim)
  device.setStatus(`Claimed address ${device.address}`)
  device.addressClaimSentAt = Date.now()
  if (device.addressClaimChecker) {
    clearTimeout(device.addressClaimChecker)
  }

  device.addressClaimChecker = setTimeout(() => {
    //if ( Date.now() - device.addressClaimSentAt > 1000 ) {
    //device.addressClaimChecker = null
    debug('claimed address %d', device.address)
    device.cansend = true
    if (!device.sentAvailable) {
      if (device.options.app) {
        device.options.app.emit('nmea2000OutAvailable')
      }
      device.emit('nmea2000OutAvailable')
      device.sentAvailable = true
    }
    sendISORequest(device, 126996)
    if (!device.heartbeatInterval) {
      device.heartbeatInterval = setInterval(() => {
        sendHeartbeat(device)
      }, 60 * 1000)
    }
    //}
  }, device.addressClaimDetectionTime)
}

function sendISORequest(
  device: N2kDevice,
  pgn: number,
  src: number | undefined = undefined,
  dst = 255
) {
  debug(`Sending iso request for ${pgn} to ${dst}`)

  const isoRequest: PGN_59904 = {
    pgn: 59904,
    dst: dst,
    fields: {
      pgn
    }
  }
  device.sendPGN(isoRequest, src)
}

function sendProductInformation(device: N2kDevice) {
  debug('Sending product info %j', device.productInfo)

  device.sendPGN(device.productInfo)
}

function sendConfigInformation(device: N2kDevice) {
  if (device.configurationInfo) {
    debug('Sending config info..')
    device.sendPGN(device.configurationInfo)
  }
}

function sendNAKAcknowledgement(
  device: N2kDevice,
  src: number,
  requestedPGN: number
) {
  const acknowledgement: PGN_59392 = {
    pgn: 59392,
    dst: src,
    fields: {
      control: IsoControl.Ack,
      groupFunction: 255,
      pgn: requestedPGN
    }
  }
  device.sendPGN(acknowledgement)
}

function sendPGNList(device: N2kDevice, dst: number) {
  //FIXME: for now, adding everything that signalk-to-nmea2000 supports
  //need a way for plugins, etc. to register the pgns they provide
  const pgnList: PGN_126464 = {
    pgn: 126464,
    dst,
    fields: {
      functionCode: PgnListFunction.TransmitPgnList,
      list: device.transmitPGNs
    }
  }
  device.sendPGN(pgnList)
}

function getISOAddressClaimAsUint64(pgn: any) {
  return new Uint64LE(toPgn(pgn)!)
}
