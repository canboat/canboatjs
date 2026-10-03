/**
 * Copyright 2026 Kees Verruijt (kees@verruijt.net)
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

import fs from 'fs'
import { execFileSync } from 'child_process'

/*
 * The NAME's unique number, derived from the machine as canboat does it
 * (get_machine_id in crates/canboat/src/engine/os.rs, used by the SocketCAN
 * device's build_name): FNV-1a 64 over "<salt>|<machine id>", of which the
 * NAME keeps the low 21 bits. Stable across restarts and not stored, so a
 * copied configuration does not copy the NAME onto another machine.
 *
 * The salt is "canboatjs", not canboat's "canboat": both have the same NAME
 * defaults (manufacturer 999, PC gateway), so a canboat server and a
 * canboatjs device on one computer would otherwise get identical NAMEs.
 */

const SALT = 'canboatjs'

/** 64-bit FNV-1a, as canboat's fnv1a_64. */
export function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n
  for (const byte of Buffer.from(text, 'utf8')) {
    hash ^= BigInt(byte)
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash
}

/** The machine's own id, as canboat reads it, or undefined. */
export function machineString(): string | undefined {
  try {
    if (process.platform === 'linux') {
      for (const path of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(path)) {
          const id = fs.readFileSync(path, 'utf8').trim()
          if (id !== '') {
            return id
          }
        }
      }
    } else if (process.platform === 'darwin') {
      const out = execFileSync(
        'ioreg',
        ['-rd1', '-c', 'IOPlatformExpertDevice'],
        { encoding: 'utf8', timeout: 2000 }
      )
      // "IOPlatformUUID" = "XXXXXXXX-...-XXXXXXXXXXXX"
      return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1]
    } else if (process.platform === 'win32') {
      const out = execFileSync(
        'reg',
        [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid'
        ],
        { encoding: 'utf8', timeout: 2000 }
      )
      // MachineGuid    REG_SZ    xxxxxxxx-....
      return /MachineGuid\s+\S+\s+(\S+)/.exec(out)?.[1]
    }
  } catch {
    // No id: the caller falls back to a random unique number.
  }
  return undefined
}

/**
 * The 21-bit unique number for `machine`, or undefined when the machine
 * cannot be identified. `connection` (the provider id) tells apart several
 * devices in one process, which canboat, with one gateway per process,
 * does not need to.
 */
export function uniqueNumberFor(
  machine: string | undefined,
  connection?: string
): number | undefined {
  if (machine === undefined) {
    return undefined
  }
  const key =
    connection !== undefined && connection !== ''
      ? `${SALT}|${machine}|${connection}`
      : `${SALT}|${machine}`
  return Number(fnv1a64(key) & 0x1fffffn)
}

/** uniqueNumberFor this machine. */
export function machineUniqueNumber(connection?: string): number | undefined {
  return uniqueNumberFor(machineString(), connection)
}
