import { Parser as FromPgn } from './fromPgn'
import { pgnToActisenseSerialFormat } from './toPgn'

// PGN 129808 has two variants: a distress one selecting on `dscCategory`
// (Match: 112) and a general one with a plain `dscCategorySymbol` LOOKUP in the
// same slot. Both share an identical 22 field bit layout, so encoding the
// distress variant and patching the two header bytes yields structurally valid
// frames for the other categories. Encoding the general variant by name is not
// an option here: the encoder writes 0xff for its field names.
const dscFrame = (format: number, category: number): string => {
  const parts = pgnToActisenseSerialFormat({
    pgn: 129808,
    dst: 255,
    src: 3,
    prio: 3,
    fields: {
      dscFormat: 'Distress',
      dscCategory: 'Distress',
      dscMessageAddress: '338040079',
      natureOfDistress: 'Sinking',
      latitudeOfVesselReported: 48.7621,
      longitudeOfVesselReported: -123.2345,
      timeOfPosition: '18:00:00',
      mmsiOfShipInDistress: '338040079'
    }
  } as any).split(',')
  const hex = (n: number) => n.toString(16).padStart(2, '0')
  parts[6] = hex(format)
  parts[7] = hex(category)
  return parts.join(',')
}

describe('PGN 129808 DSC Call Information', () => {
  test.each([
    [100, 'Routine'],
    [108, 'Safety'],
    [110, 'Urgency']
  ])('keeps the category for a non-distress call (%i)', (value, name) => {
    // DSC Format 116 "All ships" resolves the general variant
    const pgn: any = new FromPgn({ useCamelCompat: true }).parseString(
      dscFrame(116, value as number)
    )
    expect(pgn.description).toBe('DSC Call Information')
    expect(pgn.fields.dscCategory).toBe(name)
  })

  test('leaves an unavailable value null rather than post-processing it', () => {
    // 61184 truncated where the match field starts: readField has no bits left
    // and returns null, which must survive as null rather than be fed to a
    // post-processor or an enum lookup.
    const pgn: any = new FromPgn({ returnNulls: true }).parseString(
      '2017-04-15T16:02:48.913Z,3,61184,3,255,2,3b,87'
    )
    expect(pgn.description).toBe('Seatalk: Wireless Keypad Control')
    expect(pgn.fields.proprietaryId).toBeNull()
  })

  test('still resolves the distress variant', () => {
    const pgn: any = new FromPgn({ useCamelCompat: true }).parseString(
      dscFrame(116, 112)
    )
    expect(pgn.description).toBe('DSC Distress Call Information')
    expect(pgn.fields.dscCategory).toBe('Distress')
  })
})

// #497: one line with more than 8 bytes switched the parser into the
// coalesced format for good, after which every fast-packet frame was
// decoded as a whole message (PGN 129029 dates of 1970 or 21xx).
describe('raw CAN frames never decode as a whole message', () => {
  // PGN 129029 from a B&G GPS, as a YDWG-02 delivered it in the issue
  const frames = [
    '17:31:22.999 R 0DF80514 60 2F FC FA 50 B0 B3 99',
    '17:31:23.000 R 0DF80514 61 25 C0 8A 5C 84 41 6A',
    '17:31:23.000 R 0DF80514 62 FB FD 00 4A 91 24 56',
    '17:31:23.001 R 0DF80514 63 32 B0 EB 40 80 58 00',
    '17:31:23.002 R 0DF80514 64 00 00 00 00 22 FC 0F',
    '17:31:23.002 R 0DF80514 65 8A 02 50 05 64 00 00',
    '17:31:23.000 R 0DF80514 66 00 01 00 00 00 00 FF'
  ]

  const newParser = () => {
    const parser = new FromPgn({ useCamel: true })
    const errors: any[] = []
    parser.on('error', (_pgn: any, error: any) => errors.push(error))
    parser.on('warning', () => {})
    return { parser, errors }
  }

  // Every 129029 the parser emits for `lines`
  const positions = (parser: FromPgn, lines: string[]) =>
    lines
      .map((line) => parser.parseString(line) as any)
      .filter((pgn) => pgn?.pgn === 129029)
      .map((pgn) => [pgn.fields.date, pgn.fields.time])

  const expected = [['2026.10.04', 63083]]

  test('reassembles the frames', () => {
    const { parser } = newParser()
    expect(positions(parser, frames)).toEqual(expected)
  })

  test('rejects a YDRAW line with more than 8 bytes and keeps reassembling', () => {
    const { parser, errors } = newParser()
    positions(parser, frames)
    // The tail of one line glued to the tail of another
    expect(
      parser.parseString(
        '17:31:22.999 R 0DF80514 60 2F FC 25 C0 8A 5C 84 41 6A'
      )
    ).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(positions(parser, frames)).toEqual(expected)
  })

  test('rejects a candump line with more than 8 bytes and keeps reassembling', () => {
    const { parser, errors } = newParser()
    expect(
      parser.parseString(
        '(1502979132.106111) slcan0 0DF80514#602FFCFA50B0B39925C0'
      )
    ).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(
      positions(
        parser,
        frames.map((f) => {
          const [, , canId, ...data] = f.split(' ')
          return `(1502979132.106111) slcan0 ${canId}#${data.join('')}`
        })
      )
    ).toEqual(expected)
  })

  test('rejects a candump line that declares 8 bytes but lists more', () => {
    const { parser, errors } = newParser()
    expect(
      parser.parseString('can0  0DF80514   [8]  60 2F FC FA 50 B0 B3 99 25 C0')
    ).toBeUndefined()
    expect(errors).toHaveLength(1)
  })

  test('a raw frame does not reset the format learned from coalesced input', () => {
    const { parser } = newParser()
    const coalesced = (bytes: string[]) =>
      `2026-10-04T17:31:23.000Z,3,129029,20,255,${bytes.length},${bytes.join(',')}`
    const payload = frames
      .flatMap((f, i) => f.split(' ').slice(i === 0 ? 5 : 4))
      .slice(0, 47)
    // A whole message teaches the parser its input is coalesced
    expect(positions(parser, [coalesced(payload)])).toEqual(expected)
    // A raw frame from another source in between
    parser.parseString(frames[0])
    // A whole fast-packet message of 8 bytes still decodes as a message
    expect(positions(parser, [coalesced(payload.slice(0, 8))])).toEqual(
      expected
    )
  })

  test('a coalesced message from another source does not stop frames from reassembling', () => {
    const { parser } = newParser()
    // The same message as one coalesced Actisense line: this legitimately
    // teaches the parser that its input carries whole messages
    const bytes = frames.flatMap((f, i) => f.split(' ').slice(i === 0 ? 5 : 4))
    const coalesced = `2026-10-04T17:31:23.000Z,3,129029,20,255,47,${bytes.slice(0, 47).join(',')}`
    expect(positions(parser, [coalesced])).toEqual(expected)
    expect(positions(parser, frames)).toEqual(expected)
  })
})
