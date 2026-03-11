import {
  buildMaretronConfigCommand,
  buildMaretronConfigCommandActisense,
  parseMaretronConfigResponse,
  getMaretronProductName,
  getMaretronOpcodeName
} from './maretron'

describe('buildMaretronConfigCommand', () => {
  test('SIM100 Read All produces correct payload', () => {
    // From maretron.md: 01 00 ef 01 f8 04 01 89 98 02 33 5c 03 01 00 56 ff
    const result = buildMaretronConfigCommand(211, 23603, [0x56, 0xff])
    expect(result.pgn).toBe(126208)
    expect(result.dst).toBe(211)

    const bytes = result.fields.data
      .split(',')
      .map((s: string) => parseInt(s, 16))
    const expected = [
      0x01, 0x00, 0xef, 0x01, 0xf8, 0x04, 0x01, 0x89, 0x98, 0x02, 0x33, 0x5c,
      0x03, 0x01, 0x00, 0x56, 0xff
    ]
    expect(bytes).toEqual(expected)
  })

  test('SIM100 Write Ch3 mode produces correct payload', () => {
    // From maretron.md: 01 00 ef 01 f8 04 01 89 98 02 33 5c 03 01 00 57 22 01 ff
    const result = buildMaretronConfigCommand(
      211,
      23603,
      [0x57, 0x22, 0x01, 0xff]
    )
    const bytes = result.fields.data
      .split(',')
      .map((s: string) => parseInt(s, 16))
    const expected = [
      0x01, 0x00, 0xef, 0x01, 0xf8, 0x04, 0x01, 0x89, 0x98, 0x02, 0x33, 0x5c,
      0x03, 0x01, 0x00, 0x57, 0x22, 0x01, 0xff
    ]
    expect(bytes).toEqual(expected)
  })

  test('TLA100 Read Config produces correct payload', () => {
    // TLA100 product code = 2781 = 0x0ADD
    const result = buildMaretronConfigCommand(100, 2781, [0x30, 0x00])
    const bytes = result.fields.data
      .split(',')
      .map((s: string) => parseInt(s, 16))
    expect(bytes[10]).toBe(0xdd) // product code low byte
    expect(bytes[11]).toBe(0x0a) // product code high byte
    expect(bytes[15]).toBe(0x30) // opcode: Read Config
    expect(bytes[16]).toBe(0x00)
  })

  test('DCR100 Switch Lock produces correct payload', () => {
    // DCR100 product code = 22585 = 0x5839
    const result = buildMaretronConfigCommand(150, 22585, [0x67, 0x00, 0x01])
    const bytes = result.fields.data
      .split(',')
      .map((s: string) => parseInt(s, 16))
    expect(bytes[10]).toBe(0x39) // product code low byte
    expect(bytes[11]).toBe(0x58) // product code high byte
    expect(bytes[15]).toBe(0x67) // opcode: Switch Lock
    expect(bytes[16]).toBe(0x00)
    expect(bytes[17]).toBe(0x01)
  })
})

describe('buildMaretronConfigCommandActisense', () => {
  test('produces valid actisense format string', () => {
    const result = buildMaretronConfigCommandActisense(211, 23603, [0x56, 0xff])
    const parts = result.split(',')
    // Format: timestamp,prio,pgn,src,dst,len,hex...
    expect(parts[1]).toBe('3') // priority
    expect(parts[2]).toBe('126208') // pgn
    expect(parts[3]).toBe('0') // src
    expect(parts[4]).toBe('211') // dst
    expect(parseInt(parts[5])).toBe(17) // length
    expect(parts[6]).toBe('01') // FC=Command
  })
})

describe('parseMaretronConfigResponse', () => {
  test('parses maretronProprietaryConfiguration variant', () => {
    const pgn = {
      pgn: 126720,
      fields: {
        manufacturerCode: 'Maretron',
        industryCode: 'Marine Industry',
        productCode: 23603,
        softwareCode: 1,
        opcode: 0x56,
        payload: '00,64,00,01,64,00'
      }
    }
    const result = parseMaretronConfigResponse(pgn)
    expect(result).not.toBeNull()
    expect(result!.productCode).toBe(23603)
    expect(result!.productName).toBe('SIM100')
    expect(result!.opcode).toBe(0x56)
    expect(result!.opcodeName).toBe('Read All')
    expect(result!.payload).toEqual([0x00, 0x64, 0x00, 0x01, 0x64, 0x00])
  })

  test('parses maretronSlaveResponse variant with command field', () => {
    const pgn = {
      pgn: 126720,
      fields: {
        manufacturerCode: 'Maretron',
        industryCode: 'Marine Industry',
        productCode: 22585,
        softwareCode: 1,
        command: 0xfa
      }
    }
    const result = parseMaretronConfigResponse(pgn)
    expect(result).not.toBeNull()
    expect(result!.productCode).toBe(22585)
    expect(result!.productName).toBe('DCR100')
    expect(result!.opcode).toBe(0xfa)
    expect(result!.opcodeName).toBe('Status')
  })

  test('returns null for non-Maretron PGN', () => {
    const pgn = {
      pgn: 126720,
      fields: {
        manufacturerCode: 'Raymarine',
        industryCode: 'Marine Industry'
      }
    }
    expect(parseMaretronConfigResponse(pgn)).toBeNull()
  })

  test('returns null for wrong PGN number', () => {
    expect(parseMaretronConfigResponse({ pgn: 60928, fields: {} })).toBeNull()
  })

  test('returns null for null input', () => {
    expect(parseMaretronConfigResponse(null)).toBeNull()
  })

  test('handles numeric manufacturer code', () => {
    const pgn = {
      pgn: 126720,
      fields: {
        manufacturerCode: 137,
        productCode: 2781,
        softwareCode: 1,
        opcode: 0x30
      }
    }
    const result = parseMaretronConfigResponse(pgn)
    expect(result).not.toBeNull()
    expect(result!.productName).toBe('TLA100')
    expect(result!.opcodeName).toBe('Read Config')
  })
})

describe('getMaretronProductName', () => {
  test('returns name for known product codes', () => {
    expect(getMaretronProductName(23603)).toBe('SIM100')
    expect(getMaretronProductName(2781)).toBe('TLA100')
    expect(getMaretronProductName(22585)).toBe('DCR100')
    expect(getMaretronProductName(26493)).toBe('ACM100')
  })

  test('returns undefined for unknown product code', () => {
    expect(getMaretronProductName(99999)).toBeUndefined()
  })
})

describe('getMaretronOpcodeName', () => {
  test('returns name for known opcodes', () => {
    expect(getMaretronOpcodeName(0x56)).toBe('Read All')
    expect(getMaretronOpcodeName(0x57)).toBe('Write Register')
    expect(getMaretronOpcodeName(0x30)).toBe('Read Config')
    expect(getMaretronOpcodeName(0xfa)).toBe('Status')
  })

  test('returns undefined for unknown opcode', () => {
    expect(getMaretronOpcodeName(0x99)).toBeUndefined()
  })
})
