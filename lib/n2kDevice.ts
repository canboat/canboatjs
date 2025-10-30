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
  PGN_126208_NmeaRequestGroupFunction,
  PGN_126208_NmeaCommandGroupFunction,
  PGN_126208_NmeaAcknowledgeGroupFunction,
  //PGN_126996,
  PGN_126993,
  PGN_59392,
  PGN_126464,
  PgnListFunction,
  PgnErrorCode,
  TransmissionInterval,
  IsoControl,
  EquipmentStatus
} from '@canboat/ts-pgns'
import { EventEmitter } from 'node:events'
import _ from 'lodash'
import { Uint64LE } from 'int64-buffer'
import { defaultTransmitPGNs } from './codes'
import { toPgn } from './toPgn'
import packageJson from '../package.json'
import { getPersistedData, savePersistedData } from './persist'
import { createDebug } from './utilities'

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
  debug: any

  constructor(options: any, debugName: string) {
    super()

    this.options = options === undefined ? {} : options
    this.debug = createDebug(debugName, options)

    let uniqueNumber: number
    if (options.uniqueNumber !== undefined) {
      uniqueNumber = options.uniqueNumber
    } else {
      uniqueNumber = this.getPersistedData('uniqueNumber')
      if (uniqueNumber === undefined) {
        uniqueNumber = Math.floor(Math.random() * Math.floor(2097151))
        this.savePersistedData('uniqueNumber', uniqueNumber)
      }
    }

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
        'Manufacturer Code':
          options.manufacturerCode != undefined
            ? options.manufacturerCode
            : 999,
        'Device Function': 130, // PC gateway
        'Device Class': 25, // Inter/Intranetwork Device
        'Device Instance Lower': 0,
        'Device Instance Upper': 0,
        'System Instance': 0,
        'Industry Group': 4, // Marine
        Reserved1: 1,
        Reserved2: 2
      }
    }

    if (this.addressClaim['Unique Number'] === undefined) {
      this.addressClaim['Unique Number'] = uniqueNumber
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
        'Model Version': getModelVersion(options),
        'Model Serial Code': uniqueNumber.toString(),
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

    let address: number | undefined = undefined

    address = this.getPersistedData('lastAddress')

    if (address === undefined) {
      address = _.isUndefined(options.preferredAddress)
        ? 100
        : options.preferredAddress
    }
    this.address = address!
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

  getPersistedData(key: string) {
    try {
      return getPersistedData(this.options, this.options.providerId, key)
    } catch (err: any) {
      this.debug('reading persisted data %o', err)
      if (err.code !== 'ENOENT') {
        console.error(err)
        this.setError(err.message)
      }
    }
  }

  savePersistedData(key: string, value: any) {
    try {
      savePersistedData(this.options, this.options.providerId, key, value)
    } catch (err: any) {
      console.error(err)
      this.setError(err.message)
    }
  }

  setStatus(msg: string) {
    if (this.options.app && this.options.app.setProviderStatus) {
      this.options.app.setProviderStatus(this.options.providerId, msg)
    }
  }

  setError(msg: string) {
    if (this.options.app && this.options.app.setProviderError) {
      this.options.app.setProviderError(this.options.providerId, msg)
    }
  }

  n2kMessage(pgn: PGN) {
    if (pgn.dst == 255 || (this.cansend && pgn.dst == this.address)) {
      try {
        if (pgn.pgn == 59904 && this.cansend) {
          handleISORequest(this, pgn)
        } else if (pgn.pgn == 126208 && this.cansend) {
          handleGroupFunction(this, pgn as PGN_126208_NmeaRequestGroupFunction)
        } else if (pgn.pgn == 60928) {
          handleISOAddressClaim(this, pgn as PGN_60928)
        } /*else if (pgn.pgn == 126996 && this.cansend) {
          handleProductInformation(this, pgn)
        }*/
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

function getModelVersion(options: any) {
  if (options.app?.config?.getExternalHostname !== undefined) {
    return `${options.app.config.ssl ? 'https' : 'http'}://${options.app.config.getExternalHostname()}:${options.app.config.getExternalPort()}`
  } else {
    return 'canboatjs'
  }
}

function handleISORequest(device: N2kDevice, n2kMsg: PGN_59904) {
  device.debug('handleISORequest %j', n2kMsg)

  const PGN = Number(n2kMsg.fields.pgn)

  switch (PGN) {
    case 126996: // Product Information request
      sendProductInformation(device)
      break
    case 126998: // Config Information request
      sendConfigInformation(device)
      break
    case 60928: // ISO address claim request
      device.debug('sending address claim')
      device.sendPGN(device.addressClaim as PGN)
      break
    case 126464:
      sendPGNList(device, n2kMsg.src!)
      break
    default:
      if (!device.options.disableNAKs) {
        device.debug(`Got unsupported ISO request for PGN ${PGN}. Sending NAK.`)
        sendNAKAcknowledgement(device, n2kMsg.src!, PGN)
      }
  }
}

function handleGroupFunction(
  device: N2kDevice,
  n2kMsg: PGN_126208_NmeaRequestGroupFunction
) {
  device.debug('handleGroupFunction %j', n2kMsg)
  const functionCode = n2kMsg.fields.functionCode
  if (functionCode === 'Request') {
    handleRequestGroupFunction(device, n2kMsg)
  } else if (functionCode === 'Command') {
    handleCommandGroupFunction(device, n2kMsg)
  } else {
    device.debug('Got unsupported Group Function PGN: %j', n2kMsg)
  }

  function handleRequestGroupFunction(
    device: N2kDevice,
    n2kMsg: PGN_126208_NmeaRequestGroupFunction
  ) {
    if (!device.options.disableNAKs) {
      // We really don't support group function requests for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"

      const PGN = n2kMsg.fields.pgn

      device.debug(
        "Sending 'PGN Not Supported' Group Function response for requested PGN",
        PGN
      )

      const acknowledgement = new PGN_126208_NmeaAcknowledgeGroupFunction(
        {
          pgn: PGN,
          pgnErrorCode: PgnErrorCode.NotSupported,
          transmissionIntervalPriorityErrorCode:
            TransmissionInterval.Acknowledge,
          numberOfParameters: 0,
          list: []
        },
        n2kMsg.src!
      )
      device.sendPGN(acknowledgement)
    }
  }

  function handleCommandGroupFunction(
    device: N2kDevice,
    n2kMsg: PGN_126208_NmeaCommandGroupFunction
  ) {
    if (!device.options.disableNAKs) {
      // We really don't support group function commands for any PGNs yet -> always respond with pgnErrorCode 1 = "PGN not supported"

      const PGN = n2kMsg.fields.pgn

      device.debug(
        "Sending 'PGN Not Supported' Group Function response for commanded PGN",
        PGN
      )

      const acknowledgement = new PGN_126208_NmeaAcknowledgeGroupFunction(
        {
          pgn: PGN,
          pgnErrorCode: PgnErrorCode.NotSupported,
          transmissionIntervalPriorityErrorCode:
            TransmissionInterval.Acknowledge,
          numberOfParameters: 0,
          list: []
        },
        n2kMsg.src!
      )

      device.sendPGN(acknowledgement)
    }
  }
}

function handleISOAddressClaim(device: N2kDevice, n2kMsg: PGN_60928) {
  if (device.cansend == false || n2kMsg.src != device.address) {
    if (!device.devices[n2kMsg.src!]) {
      device.debug(`registering device ${n2kMsg.src}`)
      device.devices[n2kMsg.src!] = { addressClaim: n2kMsg }
      if (device.cansend) {
        //sendISORequest(device, 126996, undefined, n2kMsg.src)
      }
    }
    return
  }

  device.debug('Checking ISO address claim. %j', n2kMsg)

  const uint64ValueFromReceivedClaim = getISOAddressClaimAsUint64(n2kMsg)
  const uint64ValueFromOurOwnClaim = getISOAddressClaimAsUint64(
    device.addressClaim
  )

  if (uint64ValueFromOurOwnClaim < uint64ValueFromReceivedClaim) {
    device.debug(
      `Address conflict detected! Kept our address as ${device.address}.`
    )
    sendAddressClaim(device) // We have smaller address claim data -> we can keep our address -> re-claim it
  } else if (uint64ValueFromOurOwnClaim > uint64ValueFromReceivedClaim) {
    device.foundConflict = true
    increaseOwnAddress(device) // We have bigger address claim data -> we have to change our address
    device.debug(
      `Address conflict detected!  trying address ${device.address}.`
    )
    sendAddressClaim(device)
  }
}

function increaseOwnAddress(device: N2kDevice) {
  const start = device.address
  do {
    device.address = (device.address + 1) % 253
  } while (device.address != start && device.devices[device.address])
}

/*
function handleProductInformation(device: N2kDevice, n2kMsg: PGN_126996) {
  if (!device.devices[n2kMsg.src!]) {
    device.devices[n2kMsg.src!] = {}
  }
  device.debug('got product information %j', n2kMsg)
  device.devices[n2kMsg.src!].productInformation = n2kMsg
}
*/

function sendHeartbeat(device: N2kDevice) {
  device.heartbeatCounter = device.heartbeatCounter + 1
  if (device.heartbeatCounter > 252) {
    device.heartbeatCounter = 0
  }

  const hb = new PGN_126993({
    dataTransmitOffset: 60,
    sequenceCounter: device.heartbeatCounter,
    equipmentStatus: EquipmentStatus.Operational
  })

  device.sendPGN(hb)
}

function sendAddressClaim(device: N2kDevice) {
  if (device.devices[device.address]) {
    //someone already has this address, so find a free one
    increaseOwnAddress(device)
  }
  device.debug(`Sending address claim ${device.address}`)
  device.sendPGN(device.addressClaim)
  const version = packageJson ? packageJson.version : 'unknown'
  device.setStatus(`Claimed address ${device.address} (canboatjs v${version})`)
  device.addressClaimSentAt = Date.now()
  if (device.addressClaimChecker) {
    clearTimeout(device.addressClaimChecker)
  }

  device.addressClaimChecker = setTimeout(() => {
    //if ( Date.now() - device.addressClaimSentAt > 1000 ) {
    //device.addressClaimChecker = null
    device.debug('claimed address %d', device.address)

    device.savePersistedData('lastAddress', device.address)

    device.cansend = true
    if (!device.sentAvailable) {
      if (device.options.app) {
        device.options.app.emit('nmea2000OutAvailable')
      }
      device.emit('nmea2000OutAvailable')
      device.sentAvailable = true
    }
    //sendISORequest(device, 126996)
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
  device.debug(`Sending iso request for ${pgn} to ${dst}`)

  const isoRequest = new PGN_59904({ pgn })

  device.sendPGN(isoRequest, src)
}

function sendProductInformation(device: N2kDevice) {
  device.debug('Sending product info')

  device.sendPGN(device.productInfo)
}

function sendConfigInformation(device: N2kDevice) {
  if (device.configurationInfo) {
    device.debug('Sending config info..')
    device.sendPGN(device.configurationInfo)
  }
}

function sendNAKAcknowledgement(
  device: N2kDevice,
  src: number,
  requestedPGN: number
) {
  const acknowledgement = new PGN_59392(
    {
      control: IsoControl.Nak,
      groupFunction: 255,
      pgn: requestedPGN
    },
    src
  )

  device.sendPGN(acknowledgement)
}

function sendPGNList(device: N2kDevice, dst: number) {
  //FIXME: for now, adding everything that signalk-to-nmea2000 supports
  //need a way for plugins, etc. to register the pgns they provide
  const pgnList = new PGN_126464(
    {
      functionCode: PgnListFunction.TransmitPgnList,
      list: device.transmitPGNs.map((num: number) => {
        return { pgn: num }
      })
    },
    dst
  )
  device.sendPGN(pgnList)
}

function getISOAddressClaimAsUint64(pgn: any) {
  return new Uint64LE(toPgn(pgn)!)
}
