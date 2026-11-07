import { ManufacturerFilter } from '../manufacturerFilter'
import pkg from '../../package.json'

export const printVersion = (argv: { [key: string]: any }) => {
  if (argv['version']) {
    console.log(`v${pkg.version}`)
    process.exit(0)
  }
}

export const MANUFACTURER_FILTER_HELP = `  --manufacturer-allow <name|code>
                            only keep the messages of devices of this
                            manufacturer (repeatable, or comma separated).
                            A name is looked up, ignoring case and
                            punctuation; a unique prefix is enough
  --manufacturer-deny <name|code>
                            drop the messages of devices of this
                            manufacturer. Nothing from a device is shown
                            until its manufacturer is known`

/**
 * The allowManufacturers and denyManufacturers options from
 * --manufacturer-allow and --manufacturer-deny, and a filter for a program
 * that shows frames without decoding them (undefined without either flag). Stops the program with a
 * clear message when a name matches no manufacturer or several, or both
 * flags are given.
 */
export const manufacturerFilterOptions = (argv: { [key: string]: any }) => {
  // minimist gives a bare string for one flag, an array for several.
  const list = (value: unknown) =>
    value === undefined ? undefined : Array.isArray(value) ? value : [value]
  const options = {
    allowManufacturers: list(argv['manufacturer-allow']),
    denyManufacturers: list(argv['manufacturer-deny'])
  }
  // A flag given without a manufacturer would quietly filter nothing.
  for (const flag of ['manufacturer-allow', 'manufacturer-deny']) {
    const values = list(argv[flag])
    if (
      values !== undefined &&
      values.every((value: unknown) => String(value).trim() === '')
    ) {
      console.error(`--${flag} needs a manufacturer name or code`)
      process.exit(1)
    }
  }
  let filter: ManufacturerFilter | undefined
  try {
    filter = ManufacturerFilter.fromOptions(options)
  } catch (e: any) {
    console.error(
      e.message
        .replace('allowManufacturers option', '--manufacturer-allow')
        .replace('denyManufacturers option', '--manufacturer-deny')
        .replace(
          'give allowManufacturers or denyManufacturers',
          'give --manufacturer-allow or --manufacturer-deny'
        )
    )
    process.exit(1)
  }
  return { options, filter }
}
