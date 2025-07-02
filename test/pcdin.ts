import chai, { expect } from 'chai'

chai.should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

import { PGN_127257 } from '@canboat/ts-pgns'

const { FromPgn } = require('../dist/index')
const opts = { useCamel: true }

describe('from pcdin data converts', function () {
  it(`from 127257 converts`, function (done) {
    var pcdin = '$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    var expected: PGN_127257 = {
      pgn: 127257,
      timestamp: '2010-01-01T00:00:00.000Z',
      //timer: 1262304000000,
      src: 15,
      dst: 255,
      prio: 0,
      fields: {
        sid: 42,
        pitch: 0.1745,
        roll: 0.5236,
        yaw: 0.0175
      },
      description: 'Attitude'
    }

    var fromPgn = new FromPgn(opts)

    fromPgn.on('error', (pgn: any, error: any) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn: any, warning: any) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn: any) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timer
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(pcdin)
  })

  it(`from 127257 converts with tag blocks`, function (done) {
    var pcdin =
      '\\s:serial,c:1696759212*3E\\$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59'
    var expected: PGN_127257 = {
      pgn: 127257,
      timestamp: '2010-01-01T00:00:00.000Z',
      //timer: 1262304000000,
      src: 15,
      dst: 255,
      prio: 0,
      fields: {
        sid: 42,
        pitch: 0.1745,
        roll: 0.5236,
        yaw: 0.0175
      },
      description: 'Attitude'
    }

    var fromPgn = new FromPgn(opts)

    fromPgn.on('error', (pgn: any, error: any) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn: any, warning: any) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn: any) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timer
        pgn.should.jsonEqual(expected)
        done()
      } catch (e) {
        done(e)
      }
    })

    fromPgn.parseString(pcdin)
  })
})
