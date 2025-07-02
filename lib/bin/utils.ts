import pkg from '../../package.json'

export const printVersion = (argv: { [key: string]: any }) => {
  if (argv['version']) {
    console.log(`v${pkg.version}`)
    process.exit(0)
  }
}
