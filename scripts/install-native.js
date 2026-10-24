#!/usr/bin/env node
/*
 * Install step for the native SocketCAN addon (lib/canSocket.ts).
 *
 * SocketCAN is Linux only, so elsewhere nothing is built. On Linux a
 * prebuilt binary in prebuilds/ is used when one loads on this machine;
 * otherwise the addon is compiled with node-gyp. A failed compile does not
 * fail the install, since only socketcan connections need the addon, but it
 * is reported with how to build it by hand (#533).
 *
 * Set npm_config_build_from_source=true (npm install --build-from-source) to
 * compile even when a prebuilt binary would do.
 *
 * Copyright 2025 Signal K contributors
 * Licensed under the Apache License, Version 2.0
 */

'use strict'

const { spawnSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')

if (process.platform !== 'linux') {
  console.log(
    'canboatjs: SocketCAN is Linux only, not building the native canSocket addon'
  )
  process.exit(0)
}

// The addon that would be used at runtime, or the error loading it.
function load() {
  try {
    const nodeGypBuild = require('node-gyp-build')
    const file = nodeGypBuild.resolve(root)
    require(file)
    return { file }
  } catch (error) {
    return { error }
  }
}

if (process.env.npm_config_build_from_source !== 'true') {
  const { file } = load()
  if (file) {
    console.log(
      `canboatjs: using native canSocket addon ${path.relative(root, file)}`
    )
    process.exit(0)
  }
}

// npm passes the node-gyp it bundles; failing that, one installed alongside,
// or one on the PATH.
let nodeGyp = process.env.npm_config_node_gyp
if (!nodeGyp) {
  try {
    nodeGyp = require.resolve('node-gyp/bin/node-gyp.js')
  } catch (_err) {
    nodeGyp = undefined
  }
}
const command = nodeGyp ? process.execPath : 'node-gyp'
const args = nodeGyp ? [nodeGyp, 'rebuild'] : ['rebuild']
const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })

const { file, error } = load()
if (result.status === 0 && file) {
  process.exit(0)
}

const reason = result.error
  ? `could not run node-gyp: ${result.error.message}`
  : result.status !== 0
    ? `node-gyp rebuild exited with ${result.status ?? result.signal}`
    : `the addon built but does not load: ${error.message.split('\n')[0]}`
console.warn(`
canboatjs: WARNING: the native canSocket addon is not available, so
socketcan (canbus) connections will not work. No prebuilt binary fits this
machine (${process.platform}-${process.arch}), and building it failed:
  ${reason}
To build it by hand (needs python3, make and a C++ compiler):
  cd ${root}
  npx node-gyp rebuild
`)
