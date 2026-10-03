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
  PGN_126998,
  PGN_126993,
  PGN_59392,
  PGN_126464,
  PgnListFunction,
  PgnErrorCode,
  TransmissionInterval,
  IsoControl,
  EquipmentStatus,
  YesNo1Bit,
  PGN_126996
} from '@canboat/ts-pgns'
import { EventEmitter } from 'node:events'
import _ from 'lodash'
import { defaultTransmitPGNs } from './codes'
import { toPgn } from './toPgn'
import packageJson from '../package.json'
import { getPersistedData, savePersistedData } from './persist'
import { machineUniqueNumber } from './machineId'
import { createDebug } from './utilities'
import { AddressClaim, ClaimOutput, ClaimState } from './addressClaim'

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
  transmitPGNs: number[]
  /** The ISO 11783-5 claim, as canboat runs it (see addressClaim.ts). */
  claim!: AddressClaim
  claimTimer?: ReturnType<typeof setTimeout>
  heartbeatInterval?: any
  lastProductInfoAt = -Infinity
  debug: any

  constructor(options: any, debugName: string) {
    super()

    this.options = options === undefined ? {} : options
    this.debug = createDebug(debugName, options)

    // The NAME's unique number: the configured one; else one persisted by
    // an earlier version, so an existing device keeps its NAME; else one
    // derived from the machine, as canboat does, which is not stored, so a
    // copied configuration does not copy the NAME; else, on a machine that
    // cannot be identified, a random one, stored.
    let uniqueNumber: number
    if (options.uniqueNumber !== undefined) {
      uniqueNumber = options.uniqueNumber
    } else {
      uniqueNumber = this.getPersistedData('uniqueNumber')
      if (uniqueNumber === undefined) {
        const derived = machineUniqueNumber(options.providerId)
        if (derived !== undefined) {
          uniqueNumber = derived
        } else {
          uniqueNumber = Math.floor(Math.random() * Math.floor(2097151))
          this.savePersistedData('uniqueNumber', uniqueNumber)
        }
      }
    }

    if (options.addressClaim) {
      this.addressClaim = options.addressClaim
      this.addressClaim.pgn = 60928
      this.addressClaim.dst = 255
      this.addressClaim.prio = 6
    } else {
      // Device Instance: 8-bit identifier built from a 3-bit "lower"
      // and a 5-bit "upper" field, mirroring the N2K standard. We
      // accept a single combined value 0-255 via options.deviceInstance
      // and split it; individual lower/upper overrides also work for
      // users that want to set them explicitly.
      //
      // Inputs that fall outside the documented range (or aren't a
      // finite integer-coercible value at all) are dropped silently
      // back to 0. We deliberately do NOT bit-mask out-of-range
      // numbers: silently emitting `255 → 0` from a user-set
      // deviceInstance of e.g. 257 would be more surprising than the
      // fallback. Numeric-string forms ("3") are accepted because
      // the admin UI's <input type="number"> ships values as strings.
      const toIntInRange = (
        v: unknown,
        min: number,
        max: number
      ): number | undefined => {
        let n: number | undefined
        if (typeof v === 'number' && Number.isFinite(v)) n = Math.trunc(v)
        else if (typeof v === 'string' && v.trim() !== '') {
          const parsed = Number(v)
          if (Number.isFinite(parsed)) n = Math.trunc(parsed)
        }
        if (n === undefined || n < min || n > max) return undefined
        return n
      }
      const combined = toIntInRange(options.deviceInstance, 0, 0xff) ?? 0
      const explicitLower = toIntInRange(options.deviceInstanceLower, 0, 0x07)
      const explicitUpper = toIntInRange(options.deviceInstanceUpper, 0, 0x1f)
      const explicitSystem = toIntInRange(options.systemInstance, 0, 0x0f)
      const deviceInstanceLower =
        explicitLower !== undefined ? explicitLower : combined & 0x07
      const deviceInstanceUpper =
        explicitUpper !== undefined ? explicitUpper : (combined >> 3) & 0x1f
      const systemInstance = explicitSystem !== undefined ? explicitSystem : 0

      this.addressClaim = new PGN_60928(
        {
          manufacturerCode:
            options.manufacturerCode != undefined
              ? options.manufacturerCode
              : 999,
          deviceFunction: 130, // PC gateway
          deviceClass: 25, // Inter/Intranetwork Device
          deviceInstanceLower,
          deviceInstanceUpper,
          systemInstance,
          industryGroup: 4, // Marine
          arbitraryAddressCapable: YesNo1Bit.Yes
        },
        255
      )
    }

    // PGN_60928 stores its NMEA fields in `.fields` (canboat camelCase Id
    // form). Older canboatjs code set a top-level `uniqueNumber` /
    // `'Unique Number'` property, which the encoder ignored — meaning every
    // signalk-server claim went out with the all-ones (0x1FFFFF) sentinel
    // unique number. Some N2K analyzers (e.g. Maretron) treat that value
    // as factory-default and hide the device.
    //
    // Honor any uniqueNumber the caller already set on the supplied
    // addressClaim — both the canonical `.fields.uniqueNumber` form and
    // the legacy top-level `uniqueNumber` / `'Unique Number'` shapes —
    // before backfilling from options/persistence. This preserves a
    // caller-supplied claim's identity instead of silently overwriting it.
    const ac: any = this.addressClaim
    const fields = (ac.fields = ac.fields || {})
    if (fields.uniqueNumber === undefined) {
      const legacy = ac.uniqueNumber ?? ac['Unique Number']
      if (legacy !== undefined) {
        fields.uniqueNumber = legacy
      } else {
        fields.uniqueNumber = uniqueNumber
      }
    }

    const version = packageJson ? packageJson.version : '1.0'

    if (options.productInfo) {
      this.productInfo = options.productInfo
      this.productInfo.pgn = 126996
      this.productInfo.dst = 255
    } else {
      this.productInfo = new PGN_126996({
        nmea2000Version: 2.1, // 2.100, as canboat announces; the field counts in 0.001
        productCode: 667, // Just made up..
        modelId: 'signalk-server',
        softwareVersionCode: getServerVersion(options),
        modelVersion: version,
        modelSerialCode: uniqueNumber.toString(),
        certificationLevel: 0,
        loadEquivalency: 1
      })
    }

    const url = getServerURL(options)

    if (options.configurationInfo) {
      this.configurationInfo = options.configurationInfo
      this.configurationInfo.pgn = 126998
      this.configurationInfo.dst = 255
    } else if (url) {
      this.configurationInfo = new PGN_126998({
        installationDescription1: url
      })
    }

    let address: number | undefined = undefined

    address = this.getPersistedData('lastAddress')

    if (address === undefined) {
      address = _.isUndefined(options.preferredAddress)
        ? 100
        : options.preferredAddress
    }
    this.address = address!
    this.claim = new AddressClaim(
      ownName(this),
      this.address,
      ownName(this) >> 63n === 1n,
      options.addressClaimDetectionTime
    )
    this.cansend = false
    this.foundConflict = false
    this.heartbeatCounter = 0
    this.devices = {}
    this.sentAvailable = false

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
    runClaim(this, (now) => this.claim.start(now))
  }

  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
    if (this.claimTimer) {
      clearTimeout(this.claimTimer)
      this.claimTimer = undefined
    }
    this.cansend = false
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
    if (pgn.dst == 255 || pgn.dst == this.address) {
      try {
        if (
          pgn.pgn == 59904 &&
          Number((pgn as PGN_59904).fields.pgn) == 60928
        ) {
          // Answerable while the claim is still settling, as canboat does.
          answerClaimRequest(this)
        } else if (pgn.pgn == 59904 && this.cansend) {
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

function getServerURL(options: any) {
  if (options.app?.config?.getExternalHostname !== undefined) {
    return `${options.app.config.ssl ? 'https' : 'http'}://${options.app.config.getExternalHostname()}:${options.app.config.getExternalPort()}`
  }
}

function getServerVersion(options: any) {
  if (options.app?.config?.version !== undefined) {
    return options.app.config.version
  }
}

function handleISORequest(device: N2kDevice, n2kMsg: PGN_59904) {
  device.debug('handleISORequest %j', n2kMsg)

  const PGN = Number(n2kMsg.fields.pgn)
  // As canboat: an unsupported request is NAKed only when it was addressed
  // to us; one sent to everyone is ignored (ISO 11783-3).
  const addressed = n2kMsg.dst === device.address

  switch (PGN) {
    case 126996: // Product Information request
      sendProductInformation(device)
      break
    case 126993: // Heartbeat request
      sendHeartbeat(device)
      break
    case 126998: // Config Information request
      sendConfigInformation(device)
      break
    case 126464:
      sendPGNList(device, n2kMsg.src!)
      break
    default:
      if (addressed && !device.options.disableNAKs) {
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
  // Answered only when addressed to us, as an ISO Request is.
  if (n2kMsg.dst !== device.address) {
    return
  }
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
  const theirName = nameOf(n2kMsg)
  if (theirName === undefined) {
    return
  }
  if (theirName !== device.claim.name) {
    // Who is on the bus, for the PGNs that look a device up by address.
    device.devices[n2kMsg.src!] = {
      ...device.devices[n2kMsg.src!],
      addressClaim: n2kMsg
    }
  }
  runClaim(device, (now) =>
    device.claim.onAddressClaim(now, n2kMsg.src!, theirName)
  )
}

function answerClaimRequest(device: N2kDevice) {
  const answer = device.claim.respondToClaimRequest()
  if (answer !== undefined) {
    sendClaimOutputs(device, [answer])
    device.options?.app?.emit(
      device.options.analyzerOutEvent || 'N2KAnalyzerOut',
      device.addressClaim
    )
  }
}

/**
 * Run one step of the claim (start, a claim heard, a deadline) and act on
 * it: send what it asks for, follow its address, and announce the device
 * the moment the address becomes ours.
 */
function runClaim(device: N2kDevice, step: (now: number) => ClaimOutput[]) {
  const wasClaimed = device.claim.isClaimed()
  const wasState = device.claim.state
  const wasAddress = device.claim.claimAddress()
  const out = step(Date.now())
  device.address = device.claim.claimAddress()
  sendClaimOutputs(device, out)

  if (!wasClaimed && device.claim.isClaimed()) {
    onAddressClaimed(device)
  }
  if (wasState !== device.claim.state) {
    if (device.claim.state === ClaimState.Failed) {
      device.cansend = false
      device.setError('no NMEA 2000 address could be claimed')
    } else if (
      device.claim.state === ClaimState.Pending &&
      wasState !== ClaimState.Scanning
    ) {
      device.foundConflict = true
      // Lost the address: nothing goes out from the new one until its
      // claim settles (onAddressClaimed sends again). Having won, the
      // address stays ours and sending goes on while it is re-claimed.
      if (device.claim.claimAddress() !== wasAddress) {
        device.cansend = false
      }
    }
  }
  scheduleClaim(device)
}

function scheduleClaim(device: N2kDevice) {
  if (device.claimTimer) {
    clearTimeout(device.claimTimer)
    device.claimTimer = undefined
  }
  if (device.claim.isTiming()) {
    device.claimTimer = setTimeout(
      () => {
        device.claimTimer = undefined
        runClaim(device, (now) => device.claim.tick(now))
      },
      Math.max(0, device.claim.deadline - Date.now())
    )
  }
}

function sendClaimOutputs(device: N2kDevice, out: ClaimOutput[]) {
  for (const o of out) {
    if (o.kind === 'request') {
      device.debug(`Sending ISO request for 60928 from ${o.src}`)
      sendISORequest(device, 60928, o.src, o.dst)
    } else {
      device.debug(`Sending address claim ${o.src}`)
      device.sendPGN(device.addressClaim, o.src)
    }
  }
}

function onAddressClaimed(device: N2kDevice) {
  device.debug('claimed address %d', device.address)
  const version = packageJson ? packageJson.version : 'unknown'
  device.setStatus(`Claimed address ${device.address} (canboatjs v${version})`)
  device.savePersistedData('lastAddress', device.address)

  device.cansend = true
  announceStartupMessages(device)
  if (!device.sentAvailable) {
    if (device.options.app) {
      device.options.app.emit('nmea2000OutAvailable')
    }
    device.emit('nmea2000OutAvailable')
    device.sentAvailable = true
  }
  if (!device.heartbeatInterval) {
    device.heartbeatInterval = setInterval(() => {
      sendHeartbeat(device)
    }, 60 * 1000)
  }
}

/** The 64-bit NAME an address claim carries, as arbitration compares it. */
function nameOf(claim: any): bigint | undefined {
  const data = toPgn(claim)
  if (!data || data.length < 8) {
    return undefined
  }
  return Buffer.from(data).readBigUInt64LE(0)
}

function ownName(device: N2kDevice): bigint {
  return nameOf(device.addressClaim) ?? 0n
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
  // Only from an address we own, as canboat: not while a claim settles,
  // nor after one failed.
  if (!device.claim.isClaimed()) {
    return
  }
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

function announceStartupMessages(device: N2kDevice) {
  sendProductInformation(device)
  sendConfigInformation(device)
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
  // Product Information is broadcast, so one reply answers every requester
  // within the second: canboat collapses discovery bursts the same way.
  const now = Date.now()
  if (now - device.lastProductInfoAt < 1000) {
    return
  }
  device.lastProductInfoAt = now
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
