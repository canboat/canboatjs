// The tests of canboat's crates/canboat/src/io/address_claim.rs, ported.

import {
  ADDR_GLOBAL,
  ADDR_MAX,
  ADDR_NULL,
  AddressClaim,
  CLAIM_TIMEOUT_MS,
  ClaimOutput,
  ClaimState,
  SCAN_TIMEOUT_MS,
  USED_TTL_MS
} from './addressClaim'

// Two NAMEs; LOW arbitrates as the winner (the lower value).
const LOW = 0x00aabbccddeeff00n
const HIGH = 0x80aabbccddeeff00n

const claims = (out: ClaimOutput[]) =>
  out.filter((o) => o.kind === 'claim').map((o) => o.src)

test('scans, then claims the preferred address', () => {
  const c = new AddressClaim(LOW, 42, true)
  const out = c.start(0)
  expect(out).toEqual([{ kind: 'request', src: ADDR_NULL, dst: ADDR_GLOBAL }])
  expect(c.state).toBe(ClaimState.Scanning)
  expect(claims(c.tick(SCAN_TIMEOUT_MS))).toEqual([42])
  expect(c.state).toBe(ClaimState.Pending)
  expect(c.address()).toBeUndefined() // not owned until the claim settles
  expect(c.tick(SCAN_TIMEOUT_MS + CLAIM_TIMEOUT_MS)).toEqual([])
  expect(c.isClaimed()).toBe(true)
  expect(c.address()).toBe(42)
})

test('a scan learns used addresses and avoids the preferred one', () => {
  const c = new AddressClaim(LOW, 42, true)
  c.start(0)
  expect(c.onAddressClaim(10, 42, HIGH)).toEqual([])
  expect(claims(c.tick(SCAN_TIMEOUT_MS))).toEqual([43])
})

test('wins a conflict with a higher NAME and claims again', () => {
  const c = new AddressClaim(LOW, 42, true)
  c.start(0)
  c.tick(SCAN_TIMEOUT_MS) // pending on 42
  expect(claims(c.onAddressClaim(SCAN_TIMEOUT_MS, 42, HIGH))).toEqual([42])
  expect(c.state).toBe(ClaimState.Pending)
})

test('loses a conflict and moves up when arbitrary-address capable', () => {
  const c = new AddressClaim(HIGH, 42, true)
  c.start(0)
  c.tick(SCAN_TIMEOUT_MS)
  // Moved up from the contested address, not down to 0.
  expect(claims(c.onAddressClaim(SCAN_TIMEOUT_MS, 42, LOW))).toEqual([43])
  expect(c.state).toBe(ClaimState.Pending)
})

test('arbitrates a conflict while the claim is still pending', () => {
  // The claim window counts: a lower NAME claiming our address before ours
  // settles still wins it.
  const c = new AddressClaim(HIGH, 42, true)
  c.start(0)
  c.tick(SCAN_TIMEOUT_MS)
  c.onAddressClaim(SCAN_TIMEOUT_MS + 100, 42, LOW)
  c.tick(SCAN_TIMEOUT_MS + 100 + CLAIM_TIMEOUT_MS)
  expect(c.address()).toBe(43)
})

test('the search for a free address wraps round', () => {
  const c = new AddressClaim(LOW, ADDR_MAX, true)
  c.start(0)
  c.onAddressClaim(10, ADDR_MAX, HIGH)
  expect(claims(c.tick(SCAN_TIMEOUT_MS))).toEqual([0])
})

test('an address not heard from is free again', () => {
  const c = new AddressClaim(HIGH, 42, true)
  c.start(0)
  c.tick(SCAN_TIMEOUT_MS)
  c.onAddressClaim(SCAN_TIMEOUT_MS, 42, LOW) // lose 42 → 43
  expect(c.pickFree(SCAN_TIMEOUT_MS + 1)).toBe(43)
  // The winner has not re-claimed 42 for a TTL.
  expect(c.pickFree(SCAN_TIMEOUT_MS + USED_TTL_MS)).toBe(42)
})

test('loses a conflict and fails when not arbitrary-address capable', () => {
  const c = new AddressClaim(HIGH, 42, false)
  c.start(0)
  c.tick(SCAN_TIMEOUT_MS)
  expect(claims(c.onAddressClaim(SCAN_TIMEOUT_MS, 42, LOW))).toEqual([
    ADDR_NULL
  ])
  expect(c.state).toBe(ClaimState.Failed)
  expect(c.address()).toBeUndefined()
})

test('answers a claim request only once owned or pending', () => {
  const c = new AddressClaim(LOW, 42, true)
  c.start(0)
  expect(c.respondToClaimRequest()).toBeUndefined() // scanning
  c.tick(SCAN_TIMEOUT_MS)
  expect(c.respondToClaimRequest()).toEqual({ kind: 'claim', src: 42 })
  c.tick(SCAN_TIMEOUT_MS + CLAIM_TIMEOUT_MS)
  expect(c.respondToClaimRequest()).toEqual({ kind: 'claim', src: 42 })
})

test('ignores its own claim echoed back', () => {
  // Otherwise the node loses to itself and walks through every address.
  const c = new AddressClaim(LOW, 42, true)
  c.start(0)
  c.tick(SCAN_TIMEOUT_MS)
  c.tick(SCAN_TIMEOUT_MS + CLAIM_TIMEOUT_MS)
  expect(c.onAddressClaim(5000, 42, LOW)).toEqual([])
  expect(c.address()).toBe(42)
  // Also from another address: an identical NAME is never a peer.
  expect(c.onAddressClaim(5001, 41, LOW)).toEqual([])
  expect(c.inUse(41, 5002)).toBe(false)
})

test('a full bus fails with a claim from the null address', () => {
  const c = new AddressClaim(LOW, 42, true)
  c.start(0)
  for (let a = 0; a <= ADDR_MAX; a++) {
    c.onAddressClaim(10, a, HIGH)
  }
  expect(claims(c.tick(SCAN_TIMEOUT_MS))).toEqual([ADDR_NULL])
  expect(c.state).toBe(ClaimState.Failed)
})

test('claims from the null or global address are not addresses in use', () => {
  const c = new AddressClaim(LOW, 42, true)
  c.start(0)
  expect(c.onAddressClaim(10, ADDR_NULL, HIGH)).toEqual([])
  expect(c.onAddressClaim(10, ADDR_GLOBAL, HIGH)).toEqual([])
  expect(c.pickFree(20)).toBe(42)
})
