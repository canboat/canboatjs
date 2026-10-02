/**
 * Quick CAN Protocol - Message Definitions
 *
 * The Quick protocol uses standard 11-bit CAN IDs with direct mapping
 * (no PGN encoding in the CAN ID). Each CAN ID maps to a specific message type.
 * Multi-byte fields are little-endian.
 *
 * Every Quick message begins with a 16-bit talker identifier. It is an ordinary
 * decoded field (`sourceAddress`), exactly as canboat reads it: an 11-bit
 * identifier has no room for a source address, so there is nothing to derive
 * from the frame and nothing to invent. Definitions here mirror
 * database/quick/pgns/*.yaml in canboat.
 */

export type QuickField = {
  id: string
  name: string
  bits: number
  type: 'NUMBER' | 'BINARY' | 'LOOKUP' | 'BITLOOKUP' | 'STRING_FIX'
  signed?: boolean
  resolution?: number
  unit?: string
  lookup?: string
  description?: string
  // Inline enumeration for LOOKUP fields, mapping raw value -> label.
  enumValues?: Record<number, string>
}

export type QuickMessageDef = {
  canId: number // 11-bit CAN ID (0x000 - 0x7FF)
  id: string // machine-readable identifier
  description: string // human-readable description
  byteOrder: 'littleEndian' | 'bigEndian'
  fields: QuickField[]
}

/**
 * The 16-bit talker identifier every Quick message starts with. Kept in one
 * place so all four messages decode it identically.
 */
const SOURCE_ADDRESS_FIELD: QuickField = {
  id: 'sourceAddress',
  name: 'Source Address',
  bits: 16,
  type: 'NUMBER',
  description: 'Talker identifier of the transmitting device'
}

/**
 * Registry of all known Quick protocol messages, keyed by CAN ID.
 * Add new message definitions here as the protocol documentation progresses.
 */
export const quickMessageRegistry: Map<number, QuickMessageDef> = new Map([
  [
    0x6c0,
    {
      canId: 0x6c0,
      id: 'miscFlagsPacket',
      description: 'Quick: Miscellaneous Flags Packet',
      byteOrder: 'littleEndian',
      fields: [
        { ...SOURCE_ADDRESS_FIELD },
        {
          id: 'flags',
          name: 'Flags',
          bits: 48,
          type: 'BINARY',
          description:
            'Miscellaneous flag bits (layout TBD - placeholder 48 bits for 6 remaining bytes)'
        }
      ]
    }
  ],
  [
    0x6c1,
    {
      canId: 0x6c1,
      id: 'chainCountPacket',
      description: 'Quick: Chain Count Packet',
      byteOrder: 'littleEndian',
      fields: [
        { ...SOURCE_ADDRESS_FIELD },
        {
          id: 'chainDeployed',
          name: 'Chain Deployed',
          bits: 32,
          type: 'NUMBER',
          // No unit of its own: the sibling `units` field says whether the
          // value is meters or feet, so labelling it here would be a lie
          // half the time.
          description: 'Length of chain currently deployed'
        },
        {
          id: 'units',
          name: 'Units',
          bits: 16,
          type: 'LOOKUP',
          enumValues: { 1: 'Meters', 2: 'Feet' },
          description: 'Measurement units for the deployed chain length'
        }
      ]
    }
  ],
  [
    0x6c2,
    {
      canId: 0x6c2,
      id: 'unknownPacket1',
      description: 'Quick: Unknown Packet Type 1',
      byteOrder: 'littleEndian',
      fields: [
        { ...SOURCE_ADDRESS_FIELD },
        {
          id: 'data',
          name: 'Data',
          bits: 48,
          type: 'BINARY',
          description: 'Unknown payload (layout TBD)'
        }
      ]
    }
  ],
  [
    0x6c3,
    {
      canId: 0x6c3,
      id: 'unknownPacket2',
      description: 'Quick: Unknown Packet Type 2',
      byteOrder: 'littleEndian',
      fields: [
        { ...SOURCE_ADDRESS_FIELD },
        {
          id: 'data',
          name: 'Data',
          bits: 48,
          type: 'BINARY',
          description: 'Unknown payload (layout TBD)'
        }
      ]
    }
  ]
])

/**
 * Look up a Quick protocol message definition by CAN ID.
 * Returns undefined if no definition exists for the given CAN ID.
 */
export const getQuickMessageDef = (
  canId: number
): QuickMessageDef | undefined => {
  return quickMessageRegistry.get(canId & 0x7ff)
}

/**
 * Check if a CAN ID belongs to the Quick protocol range.
 * Quick uses CAN IDs in the 0x6C0 - 0x6CF range (currently defined).
 * This can be expanded as more message types are documented.
 */
export const isQuickCanId = (canId: number): boolean => {
  return quickMessageRegistry.has(canId & 0x7ff)
}

/**
 * Get all registered Quick CAN IDs.
 */
export const getQuickCanIds = (): number[] => {
  return Array.from(quickMessageRegistry.keys())
}
