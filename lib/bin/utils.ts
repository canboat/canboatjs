import { PGN } from '@canboat/ts-pgns'
import pkg from '../../package.json'

export const printVersion = (argv: { [key: string]: any }) => {
  if (argv['version']) {
    console.log(`v${pkg.version}`)
    process.exit(0)
  }
}

export const setupFilters = (argv: { [key: string]: any }) => {
  let pgn_filter: any = argv['pgn']
  const manufacturer_filter = argv['manufacturer']

  if (pgn_filter !== undefined && Array.isArray(pgn_filter) === false) {
    pgn_filter = [pgn_filter]
  }

  let src_filter: any = argv['src']
  if (src_filter !== undefined && Array.isArray(src_filter) === false) {
    src_filter = [src_filter]
  }

  let dst_filter: any = argv['dst']
  if (dst_filter !== undefined && Array.isArray(dst_filter) === false) {
    dst_filter = [dst_filter]
  }

  let js_filter = argv['filter']

  if (js_filter !== undefined) {
    try {
      js_filter = new Function('pgn', `return ${js_filter}`)
    } catch (e: any) {
      console.error(`Invalid filter expression: ${e.message}`)
      process.exit(1)
    }
  }

  return { pgn_filter, manufacturer_filter, src_filter, dst_filter, js_filter }
}

export const filterPGN = (pgn: PGN, filter: any): boolean => {
  if (
    (filter.pgn_filter === undefined ||
      filter.pgn_filter.find((p: string) => pgn.pgn === Number(p))) &&
    (filter.src_filter === undefined ||
      filter.src_filter.find((s: string) => pgn.src === Number(s))) &&
    (filter.dst_filter === undefined ||
      filter.dst_filter.find((d: string) => pgn.dst === Number(d)))
  ) {
    if (filter.manufacturer_filter !== undefined) {
      const manufacturer =
        (pgn as any).fields.manufacturerCode ||
        (pgn as any).fields['Manufacturer Code']
      if (manufacturer !== filter.manufacturer_filter) {
        return false
      }
    }
    if (filter.js_filter !== undefined) {
      try {
        return filter.js_filter(pgn)
      } catch (e: any) {
        console.error(`Error evaluating filter on PGN ${pgn.pgn}: ${e.message}`)
        return false
      }
    }
    return true
  }

  return false
}
