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

/*
 * The ISO 11783-5 address claim, ported from canboat's
 * crates/canboat/src/io/address_claim.rs so that canboatjs claims exactly
 * as canboat does: scan the bus, pick a source address, defend it by NAME
 * arbitration (the lower NAME wins), re-claim on conflict. No I/O: it takes
 * the PGNs that drive claiming and a monotonic `now` in ms, and returns
 * what to send.
 */

/** Highest assignable source address; 254 (null) and 255 (global) are reserved. */
export const ADDR_MAX = 253
export const ADDR_NULL = 254
export const ADDR_GLOBAL = 255

/** How long a claim must go uncontested before it is ours. */
export const CLAIM_TIMEOUT_MS = 250
/** How long to listen for others' claims before picking an address. */
export const SCAN_TIMEOUT_MS = 1000
/**
 * How long an address stays in use after its claim was last heard.
 * Devices don't announce leaving; three missed rounds of canboat's
 * five-minute re-claim requests mean the device is gone.
 */
export const USED_TTL_MS = 15 * 60 * 1000

export enum ClaimState {
  /** Listening for existing claims before choosing an address. */
  Scanning = 'scanning',
  /** A claim has been sent and awaits the uncontested timeout. */
  Pending = 'pending',
  /** The address is ours. */
  Claimed = 'claimed',
  /** No address could be claimed: the node is silent. */
  Failed = 'failed'
}

/** What to put on the bus: an ISO Request for 60928, or our claim. */
export type ClaimOutput =
  | { kind: 'request'; src: number; dst: number }
  | { kind: 'claim'; src: number }

export class AddressClaim {
  readonly name: bigint
  readonly preferred: number
  readonly arbitrary: boolean
  readonly claimTimeoutMs: number
  state: ClaimState = ClaimState.Pending
  deadline = 0
  private current: number
  /** When each address was last claimed by someone else. */
  private lastSeen: (number | undefined)[] = new Array(256).fill(undefined)

  /**
   * A claimer for `name` preferring source address `preferred`;
   * `arbitrary` is the NAME's arbitrary-address-capable bit.
   * `claimTimeoutMs` overrides CLAIM_TIMEOUT_MS (canboatjs's
   * addressClaimDetectionTime option).
   */
  constructor(
    name: bigint,
    preferred: number,
    arbitrary: boolean,
    claimTimeoutMs: number = CLAIM_TIMEOUT_MS
  ) {
    this.name = name
    this.preferred = preferred
    this.current = preferred
    this.arbitrary = arbitrary
    this.claimTimeoutMs = claimTimeoutMs
  }

  isClaimed(): boolean {
    return this.state === ClaimState.Claimed
  }

  /** The claimed address, or undefined until one is owned. */
  address(): number | undefined {
    return this.isClaimed() ? this.current : undefined
  }

  /** The address claims go out from: the one being claimed, or 254. */
  claimAddress(): number {
    return this.current
  }

  /** True while a scan or claim deadline is running. */
  isTiming(): boolean {
    return (
      this.state === ClaimState.Scanning || this.state === ClaimState.Pending
    )
  }

  /**
   * Begin: scan the bus. Asks every node, from the null address since we
   * own none yet, to announce its claim.
   */
  start(now: number): ClaimOutput[] {
    this.state = ClaimState.Scanning
    this.deadline = now + SCAN_TIMEOUT_MS
    return [{ kind: 'request', src: ADDR_NULL, dst: ADDR_GLOBAL }]
  }

  /**
   * An address claim from `src` with NAME `theirName`: learn the address
   * as used and, if it is ours, arbitrate by NAME.
   */
  onAddressClaim(now: number, src: number, theirName: bigint): ClaimOutput[] {
    if (src > ADDR_MAX) {
      return []
    }
    // Our own NAME: our claim coming back, never a peer.
    if (theirName === this.name) {
      return []
    }
    if (this.state === ClaimState.Scanning || src !== this.current) {
      this.lastSeen[src] = now
      return []
    }
    if (this.name < theirName) {
      // We win: keep the address and claim it again.
      this.state = ClaimState.Pending
      this.deadline = now + this.claimTimeoutMs
      return [this.claim()]
    }
    this.lastSeen[src] = now
    if (this.arbitrary) {
      const next = this.pickFree(now)
      if (next !== undefined) {
        this.current = next
        this.state = ClaimState.Pending
        this.deadline = now + this.claimTimeoutMs
        return [this.claim()]
      }
    }
    // Lost, and nowhere to go: "cannot claim", from the null address.
    this.current = ADDR_NULL
    this.state = ClaimState.Failed
    return [this.claim()]
  }

  /** The answer to an ISO Request for 60928, while claimed or claiming. */
  respondToClaimRequest(): ClaimOutput | undefined {
    return this.state === ClaimState.Claimed ||
      this.state === ClaimState.Pending
      ? this.claim()
      : undefined
  }

  /** Advance the deadlines: scan → claim → owned. */
  tick(now: number): ClaimOutput[] {
    if (this.state === ClaimState.Scanning && now >= this.deadline) {
      return this.beginClaim(now)
    }
    if (this.state === ClaimState.Pending && now >= this.deadline) {
      this.state = ClaimState.Claimed
    }
    return []
  }

  /** The preferred address if free, else the next free one up from it. */
  private beginClaim(now: number): ClaimOutput[] {
    if (this.inUse(this.preferred, now)) {
      const next = this.pickFree(now)
      if (next === undefined) {
        this.current = ADDR_NULL
        this.state = ClaimState.Failed
        return [this.claim()]
      }
      this.current = next
    } else {
      this.current = this.preferred
    }
    this.state = ClaimState.Pending
    this.deadline = now + this.claimTimeoutMs
    return [this.claim()]
  }

  /** Whether someone else claimed `address` within USED_TTL_MS. */
  inUse(address: number, now: number): boolean {
    const seen = this.lastSeen[address]
    return seen !== undefined && now - seen < USED_TTL_MS
  }

  /**
   * The first free address upward from the preferred one, wrapping round.
   * Not the lowest free address: that is where real devices like to sit,
   * so a node parked there keeps being displaced.
   */
  pickFree(now: number): number | undefined {
    for (let i = 0; i <= ADDR_MAX; i++) {
      const a = (this.preferred + i) % (ADDR_MAX + 1)
      if (!this.inUse(a, now)) {
        return a
      }
    }
    return undefined
  }

  private claim(): ClaimOutput {
    return { kind: 'claim', src: this.current }
  }
}
