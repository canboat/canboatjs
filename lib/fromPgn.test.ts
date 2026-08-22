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

  test('still resolves the distress variant', () => {
    const pgn: any = new FromPgn({ useCamelCompat: true }).parseString(
      dscFrame(116, 112)
    )
    expect(pgn.description).toBe('DSC Distress Call Information')
    expect(pgn.fields.dscCategory).toBe('Distress')
  })
})
