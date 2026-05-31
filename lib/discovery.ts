/**
 * Copyright 2019 Scott Bender <scott@scottbender.net>
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

import { createDebug } from './utilities'
import { isYDRAW } from './stringMsg'
import { IPG_PORT } from './maretron-ipg'
import dgram from 'dgram'

// dnssd is plain CommonJS with no shipped types. The namespace import keeps
// it untyped without needing a @types shim, while satisfying both the no-
// require-imports lint rule and esModuleInterop.
// @ts-expect-error -- no @types/dnssd published
import * as dnssd from 'dnssd'

const debug = createDebug('canboatjs:discovery')

// The Maretron IPG100 advertises itself on the LAN with an unsolicited UDP
// broadcast to port 65499 every ~10 s. The 34-byte payload begins with the
// ASCII string "IPG, return ping ACK\0" followed by a 0x01 discriminator and
// a binary device tail. We listen for one such frame, take the announcing
// host's IP as the connect target, and emit a streaming
// `maretron-ipg-canboatjs` provider on the IPG's TCP control port. To avoid
// waiting up to ~10 s for the next announce, we also actively solicit an
// immediate reply (see sendMaretronRequest).
//
// The whole REQ/ACK ping exchange uses port 65499: clients broadcast the
// request to 65499, and the IPG sends its ACK back to the request packet's
// source address and port. So we bind one socket to 65499, send the request
// from it, and read both the solicited reply and the unsolicited announces on
// that same socket.
const MARETRON_PORT = 65499
const MARETRON_ANNOUNCE_PREFIX = 'IPG, return ping ACK' // 20 ASCII bytes
const DISCOVERY_TIMEOUT_MS = 30000

// Both 65499 ping packets share a 21-byte header: the ASCII prefix followed by
// a NUL terminator at offset 20. The byte after that (offset 21) is the
// REQ/ACK flag. Empirically (captured off a live IPG100):
//   0x01 = a genuine announce/ACK FROM the IPG (34-byte frame: header + a
//          12-byte body of override IP, service port, product code, serial)
//   0x00 = a request frame broadcast BY OTHER HOSTS (22-byte frame, no body,
//          e.g. Maretron N2KAnalyzer). Matching it would mis-discover the
//          requester's IP as the IPG, so we must reject it.
const MARETRON_NUL_OFFSET = MARETRON_ANNOUNCE_PREFIX.length // 20
const MARETRON_DISCRIMINATOR_OFFSET = MARETRON_ANNOUNCE_PREFIX.length + 1 // 21
const MARETRON_NUL = 0x00
const MARETRON_RESPONSE_DISCRIMINATOR = 0x01
const MARETRON_REQUEST_DISCRIMINATOR = 0x00
// A genuine ACK carries the header plus a 12-byte body (bytes 22–33), so a
// real announce is 34 bytes. Requiring the full length rejects truncated or
// spoofed frames that carry only the header and flag.
const MARETRON_ANNOUNCE_LENGTH = 34

// Active-discovery probe schedule (ms after the socket binds). The IPG often
// ignores the first packet or two but answers reliably within a few closely
// spaced retries — so, like Maretron's own N2KAnalyzer, we send a short burst
// ~100 ms apart. Measured against a live IPG100 this yields a reply within a
// few hundred ms every time, with no rate-limiting on port 65499. Probing stops
// as soon as a reply arrives; the unsolicited ~10 s announce is the fallback if
// every probe is dropped. An immediate send (offset 0) is always done first.
const MARETRON_PROBE_OFFSETS_MS = [100, 200, 300, 500, 800]

/**
 * Build the 22-byte active-discovery request frame: the ASCII prefix, a NUL
 * terminator, and the 0x00 request flag. Broadcasting this to `MARETRON_PORT`
 * (65499) elicits an immediate ACK that the IPG sends back to the request's
 * source address and port. Pure and exported so it can be byte-compared against
 * a captured request frame without touching the network.
 */
export function buildMaretronRequest(): Buffer {
  return Buffer.concat([
    Buffer.from(MARETRON_ANNOUNCE_PREFIX, 'ascii'),
    Buffer.from([MARETRON_NUL, MARETRON_REQUEST_DISCRIMINATOR])
  ])
}

/**
 * Return true only for a genuine IPG announce/ACK frame: the full 34-byte
 * length, the ASCII prefix, the NUL terminator at offset 20, and the 0x01
 * response flag at offset 21. The 0x00 request frames other hosts broadcast
 * share the prefix but are 22 bytes with a 0x00 flag, so they are rejected —
 * as are truncated or spoofed frames that carry only the header and flag.
 */
export function isMaretronAnnounce(buffer: Buffer): boolean {
  return (
    buffer.length >= MARETRON_ANNOUNCE_LENGTH &&
    buffer.toString('ascii', 0, MARETRON_ANNOUNCE_PREFIX.length) ===
      MARETRON_ANNOUNCE_PREFIX &&
    buffer[MARETRON_NUL_OFFSET] === MARETRON_NUL &&
    buffer[MARETRON_DISCRIMINATOR_OFFSET] === MARETRON_RESPONSE_DISCRIMINATOR
  )
}

/**
 * Actively solicit an IPG ACK instead of waiting for the next unsolicited
 * announce. Broadcasts the request frame to `MARETRON_PORT` (65499) from the
 * caller's already-bound listener `socket` — the IPG sends its ACK back to the
 * request's source address and port, so it must be sent from the same socket
 * the caller reads, not a throwaway one. Fire-and-forget: it never reads, it
 * only sends, on the burst schedule. `isDone()` short-circuits the burst once
 * the listener has handled a reply. `setBroadcast` must already be enabled on
 * the socket. Exported for unit testing with a fake socket.
 */
export function sendMaretronRequest(
  socket: dgram.Socket,
  isDone: () => boolean
): void {
  const frame = buildMaretronRequest()
  const blast = () => {
    if (isDone()) return
    socket.send(frame, MARETRON_PORT, '255.255.255.255', (err) => {
      if (err) debug('probe send failed %s', err)
    })
  }

  // Immediate probe, then the ~100 ms-spaced burst retries.
  blast()
  for (const offset of MARETRON_PROBE_OFFSETS_MS) {
    const t = setTimeout(blast, offset)
    if (t.unref) t.unref()
  }
}

function discoverMaretronIPG(app: any) {
  const port = String(IPG_PORT)
  const exists = app.config.settings.pipedProviders.find((provider: any) => {
    return (
      provider.pipeElements &&
      provider.pipeElements.length === 1 &&
      provider.pipeElements[0].type == 'providers/simple' &&
      provider.pipeElements[0].options &&
      provider.pipeElements[0].options.type === 'NMEA2000' &&
      provider.pipeElements[0].options.subOptions.type ===
        'maretron-ipg-canboatjs'
    )
  })

  if (exists) return

  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  let done = false
  socket.on('message', (buffer: Buffer, remote: any) => {
    if (done) return
    if (!isMaretronAnnounce(buffer)) return
    done = true
    socket.close()
    const host = remote.address
    debug('found Maretron IPG at %s (announce on port %d)', host, remote.port)
    app.emit('discovered', {
      id: `Maretron-IPG-${host}`,
      pipeElements: [
        {
          type: 'providers/simple',
          options: {
            logging: false,
            type: 'NMEA2000',
            subOptions: {
              type: 'maretron-ipg-canboatjs',
              host,
              port
            }
          }
        }
      ]
    })
  })
  socket.on('error', (error: any) => {
    debug(error)
  })
  socket.on('close', () => {
    debug('close')
  })
  debug('looking for a Maretron IPG on UDP port %d', MARETRON_PORT)
  try {
    socket.bind(MARETRON_PORT, () => {
      // Socket is up; actively solicit an immediate ACK instead of waiting up
      // to ~10 s for the next unsolicited announce. The IPG replies to this
      // socket's address/port, so we send the request from it and read the
      // reply on it. Unsolicited announces also arrive here as the fallback.
      try {
        socket.setBroadcast(true)
      } catch (ex) {
        debug('setBroadcast failed %s', ex)
      }
      sendMaretronRequest(socket, () => done)
    })
  } catch (ex) {
    debug(ex)
  }
  const timer = setTimeout(() => {
    if (!done) {
      socket.close()
    }
  }, DISCOVERY_TIMEOUT_MS)
  // Don't let the discovery window hold the host process open: SignalK's
  // shutdown (and jest) should be free to exit before the 30 s timeout.
  if (timer.unref) timer.unref()
}

// The sensesp-n2k-gateway ESP32 firmware (Ethernet or WiFi) advertises a
// candump3 TCP stream via mDNS as `_sensesp-n2k._tcp`. Works across both
// link types where UDP broadcast is unreliable. The advertisement carries
// `format=candump3` and the candump interface name in its TXT records;
// port comes from the SRV record. We map a discovered service to a
// streaming `navlink2-tcp-canboatjs` provider, which feeds candump3 lines
// into canboatjs's TCP+Liner pipeline and auto-detects the format.
const SENSESP_N2K_SERVICE = 'sensesp-n2k'

function discoverSensespN2K(app: any) {
  const browser = new dnssd.Browser(dnssd.tcp(SENSESP_N2K_SERVICE))
  let done = false
  const stop = () => {
    if (done) return
    done = true
    try {
      browser.stop()
    } catch (ex) {
      debug(ex)
    }
  }

  browser.on('serviceUp', (service: any) => {
    if (done) return
    const txt = service.txt || {}
    if (txt.format !== 'candump3') {
      debug(
        'ignoring %s: unsupported format %j',
        service.fullname || service.name,
        txt.format
      )
      return
    }
    // Prefer an IPv4 address — dnssd may list IPv6 first (e.g. ['::1',
    // '192.168.1.1']) and downstream Node net.connect / SignalK consumers
    // generally expect bare-dot-quad hosts in the provider config.
    const addresses: string[] = service.addresses || []
    const host =
      addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) || addresses[0]
    const port = service.port
    if (!host || !port) return

    const id = `SensESP-N2K-${host}`
    const exists = app.config.settings.pipedProviders.find((provider: any) => {
      const opts = provider.pipeElements?.[0]?.options
      const sub = opts?.subOptions
      return (
        provider.id === id ||
        (opts?.type === 'NMEA2000' &&
          sub?.type === 'navlink2-tcp-canboatjs' &&
          sub?.host === host &&
          String(sub?.port) === String(port))
      )
    })
    if (exists) {
      debug('SensESP-N2K at %s already configured, skipping', host)
      return
    }

    debug('found SensESP-N2K gateway at %s:%d', host, port)
    app.emit('discovered', {
      id,
      pipeElements: [
        {
          type: 'providers/simple',
          options: {
            logging: false,
            type: 'NMEA2000',
            subOptions: {
              type: 'navlink2-tcp-canboatjs',
              host,
              port: String(port)
            }
          }
        }
      ]
    })
  })
  browser.on('error', (error: any) => {
    debug(error)
  })

  debug('browsing for _%s._tcp via mDNS', SENSESP_N2K_SERVICE)
  try {
    browser.start()
  } catch (ex) {
    debug(ex)
  }

  const timer = setTimeout(stop, DISCOVERY_TIMEOUT_MS)
  if (timer.unref) timer.unref()
}

export function discover(app: any) {
  if (app.config.settings.pipedProviders) {
    discoverMaretronIPG(app)
    discoverSensespN2K(app)
  }

  if (app.config.settings.pipedProviders) {
    const exists = app.config.settings.pipedProviders.find((provider: any) => {
      return (
        provider.pipeElements &&
        provider.pipeElements.length === 1 &&
        provider.pipeElements[0].type == 'providers/simple' &&
        provider.pipeElements[0].options &&
        provider.pipeElements[0].options.type === 'NMEA2000' &&
        provider.pipeElements[0].options.subOptions.type ===
          'ydwg02-udp-canboatjs' &&
        provider.pipeElements[0].options.subOptions.port === '2002'
      )
    })

    if (!exists) {
      const socket = dgram.createSocket('udp4')
      socket.on('message', (buffer: Buffer, _remote: any) => {
        const msg = buffer.toString('utf8')
        if (isYDRAW(msg)) {
          socket.close()
          app.emit('discovered', {
            id: 'YDGW-02-UDP',
            pipeElements: [
              {
                type: 'providers/simple',
                options: {
                  logging: false,
                  type: 'NMEA2000',
                  subOptions: {
                    type: 'ydwg02-udp-canboatjs',
                    port: '2002'
                  }
                }
              }
            ]
          })
        }
      })
      socket.on('error', (error: any) => {
        debug(error)
      })
      socket.on('close', () => {
        debug('close')
      })
      debug('looking for YDGW over UDP')
      try {
        socket.bind(2002)
      } catch (ex) {
        debug(ex)
      }
      setTimeout(() => {
        if (socket) {
          socket.close()
        }
      }, 5000)
    }
  }

  /*
  if ( app.config.settings.pipedProviders ) {
    const exists = app.config.settings.pipedProviders.find(provider => {
      return provider.pipeElements
        && provider.pipeElements.length === 1
        && provider.pipeElements[0].type == 'providers/simple'
        && provider.pipeElements[0].options
        && provider.pipeElements[0].options.type === 'NMEA2000'
        && provider.pipeElements[0].options.subOptions.host === '192.168.88.99'
        && provider.pipeElements[0].options.subOptions.port === '1457'
    })

    if ( !exists )
    {
      setTimeout(() =>
                 app.emit('discovered', {
                   id: 'TestDiscovered',
                   pipeElements: [
                     {
                       "type": "providers/simple",
                       "options": {
                         "logging": false,
                         "type": "NMEA2000",
                         "subOptions": {
                           "type": "ydwg02-canboatjs",
                           "host": "192.168.88.99",
                           "port": "1457"
                         }
                       }
                     }
                   ]
                 }), 5000)
      
    }
  }
*/
}
