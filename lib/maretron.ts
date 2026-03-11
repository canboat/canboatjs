import { PGN } from '@canboat/ts-pgns'

/**
 * Product code → device name mapping for known Maretron devices.
 */
const PRODUCT_NAMES: { [code: number]: string } = {
  434: 'SSC200',
  2686: 'SSC300',
  2781: 'TLA100',
  3979: 'NBE100',
  4078: 'RIM100',
  8165: 'ALM100',
  20067: 'TMP100',
  22585: 'DCR100',
  23603: 'SIM100',
  26493: 'ACM100'
}

/**
 * Opcode → name mapping for Maretron config opcodes.
 */
const OPCODE_NAMES: { [code: number]: string } = {
  0x20: 'Write Config',
  0x21: 'Read Filter',
  0x22: 'Write Filter',
  0x24: 'Calibrate',
  0x30: 'Read Config',
  0x31: 'Read Calibration',
  0x35: 'Read Gauge Resistance',
  0x36: 'Realtime Current',
  0x38: 'Current Reading',
  0x56: 'Read All',
  0x57: 'Write Register',
  0x5a: 'Read AC Config',
  0x5b: 'Write AC Config',
  0x60: 'Test Annunciator',
  0x61: 'Set Instance',
  0x62: 'Read Extended',
  0x63: 'Write Extended',
  0x66: 'Calibration Status',
  0x67: 'Switch Lock',
  0xfa: 'Status',
  0xfc: 'Debug'
}

/**
 * Build a raw PGN 126208 Command payload targeting PGN 126720 for Maretron
 * proprietary device configuration. This bypasses canboatjs's structured
 * 126208 encoder because Maretron's field index scheme doesn't match
 * canboat's semantic field ordering for PGN 126720.
 *
 * Wire format (confirmed from live capture):
 * ```
 * [0]     FC = 0x01 (Command)
 * [1-3]   Target PGN = 0x01EF00 (126720) LE
 * [4]     Priority + Reserved = 0xF8
 * [5]     Number of params = 0x04
 * [6]     Field idx 1
 * [7-8]   Mfr code packed = 0x9889 (mfr=137, rsvd=1, ind=4)
 * [9]     Field idx 2
 * [10-11] Product code (LE)
 * [12]    Field idx 3
 * [13-14] Sub-header = 0x0001
 * [15+]   Opcode + payload bytes
 * ```
 *
 * @param dst Destination device address on the N2K bus
 * @param productCode Maretron product code (e.g. 23603 for SIM100)
 * @param opcodePayload Array of bytes: [opcode, ...data]
 * @returns PGN object suitable for emission via nmea2000JsonOut
 */
export function buildMaretronConfigCommand(
  dst: number,
  productCode: number,
  opcodePayload: number[]
): PGN & { dst: number; fields: { data: string } } {
  const payload = [
    0x01, // Function Code: Command
    0x00,
    0xef,
    0x01, // Target PGN 126720 (0x01EF00) LE
    0xf8, // Priority=15 (leave unchanged) + reserved
    0x04, // Number of parameters
    0x01, // Field index 1: manufacturer code
    0x89,
    0x98, // Packed: mfr=137(0x89), reserved=1, industry=4 → 0x9889 LE
    0x02, // Field index 2: product code
    productCode & 0xff,
    (productCode >> 8) & 0xff, // Product code LE
    0x03, // Field index 3: sub-header
    0x01,
    0x00, // Sub-header = 0x0001
    ...opcodePayload
  ]

  const hexData = payload.map((b) => b.toString(16).padStart(2, '0')).join(',')

  return {
    pgn: 126208,
    prio: 3,
    dst,
    src: 0,
    fields: {
      data: hexData
    }
  } as PGN & { dst: number; fields: { data: string } }
}

/**
 * Build a raw PGN 126208 Command as an actisense-format hex string,
 * suitable for emission via the nmea2000out event.
 *
 * @param dst Destination device address on the N2K bus
 * @param productCode Maretron product code
 * @param opcodePayload Array of bytes: [opcode, ...data]
 * @returns Actisense serial format string
 */
export function buildMaretronConfigCommandActisense(
  dst: number,
  productCode: number,
  opcodePayload: number[]
): string {
  const payload = [
    0x01,
    0x00,
    0xef,
    0x01,
    0xf8,
    0x04,
    0x01,
    0x89,
    0x98,
    0x02,
    productCode & 0xff,
    (productCode >> 8) & 0xff,
    0x03,
    0x01,
    0x00,
    ...opcodePayload
  ]

  const now = new Date()
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}Z`
  const hexBytes = payload
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(',')
  return `${timestamp},3,126208,0,${dst},${payload.length},${hexBytes}`
}

export interface MaretronConfigResponse {
  productCode: number
  productName: string | undefined
  softwareCode: number
  opcode: number
  opcodeName: string | undefined
  payload: number[]
}

/**
 * Parse a decoded PGN 126720 that matches the Maretron proprietary
 * configuration format. Works with both the new maretronProprietaryConfiguration
 * variant (which has named fields) and the generic maretronSlaveResponse.
 *
 * For maretronProprietaryConfiguration:
 *   fields.productCode, fields.softwareCode, fields.opcode, fields.payload
 *
 * For raw PGN objects with a data field, extracts bytes directly.
 *
 * @param pgn A decoded PGN 126720 object
 * @returns Parsed Maretron config info, or null if not a Maretron config PGN
 */
export function parseMaretronConfigResponse(
  pgn: any
): MaretronConfigResponse | null {
  if (!pgn || pgn.pgn !== 126720) {
    return null
  }

  const fields = pgn.fields

  // Check for Maretron manufacturer code
  if (
    fields?.manufacturerCode !== 'Maretron' &&
    fields?.manufacturerCode !== 137
  ) {
    return null
  }

  // New maretronProprietaryConfiguration variant with named fields
  if (fields.opcode !== undefined) {
    const productCode =
      typeof fields.productCode === 'number' ? fields.productCode : 0
    const softwareCode =
      typeof fields.softwareCode === 'number' ? fields.softwareCode : 0
    const opcode = typeof fields.opcode === 'number' ? fields.opcode : 0

    let payloadBytes: number[] = []
    if (fields.payload) {
      if (typeof fields.payload === 'string') {
        payloadBytes = fields.payload
          .split(',')
          .map((s: string) => parseInt(s, 16))
      } else if (Buffer.isBuffer(fields.payload)) {
        payloadBytes = Array.from(fields.payload)
      }
    }

    return {
      productCode,
      productName: PRODUCT_NAMES[productCode],
      softwareCode,
      opcode,
      opcodeName: OPCODE_NAMES[opcode],
      payload: payloadBytes
    }
  }

  // Legacy maretronSlaveResponse: command field maps to opcode
  if (fields.command !== undefined) {
    const productCode =
      typeof fields.productCode === 'number' ? fields.productCode : 0
    const softwareCode =
      typeof fields.softwareCode === 'number' ? fields.softwareCode : 0
    const opcode = typeof fields.command === 'number' ? fields.command : 0

    return {
      productCode,
      productName: PRODUCT_NAMES[productCode],
      softwareCode,
      opcode,
      opcodeName: OPCODE_NAMES[opcode],
      payload: []
    }
  }

  return null
}

/**
 * Get the product name for a Maretron product code.
 */
export function getMaretronProductName(
  productCode: number
): string | undefined {
  return PRODUCT_NAMES[productCode]
}

/**
 * Get the opcode name for a Maretron config opcode.
 */
export function getMaretronOpcodeName(opcode: number): string | undefined {
  return OPCODE_NAMES[opcode]
}
