const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const { FromPgn } = require('../index')

describe('from mxpgn data converts', function () {

  it(`from 129025 converts`, function (done) {
    var mxpgn = '$MXPGN,01F801,2801,C1308AC40C5DE343*19'
    var expected = {
      "pgn":129025,
      "src":1,
      "dst":255,
      "prio":0,
      "fields":{
        "Latitude": -99.7576511,
        "Longitude": 113.8973964,
      },
      "description":"Position, Rapid Update"
    }

    var fromPgn = new FromPgn()

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timestamp
        pgn.should.jsonEqual(expected)
        done()
      } catch ( e ) {
        done(e)
      }
    })

    fromPgn.parseString(mxpgn)
  })

  it(`from 129025 converts with tags`, function (done) {
    var mxpgn = '\\s:serial,c:1696759212*3E\\$MXPGN,01F801,2801,C1308AC40C5DE343*19'
    var expected = {
      "pgn":129025,
      "src":1,
      "dst":255,
      "prio":0,
      "fields":{
        "Latitude": -99.7576511,
        "Longitude": 113.8973964,
      },
      "description":"Position, Rapid Update"
    }

    var fromPgn = new FromPgn()

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timestamp
        pgn.should.jsonEqual(expected)
        done()
      } catch ( e ) {
        done(e)
      }
    })

    fromPgn.parseString(mxpgn)
  })

  it(`from little endian 129025 converts`, function (done) {
    var mxpgn = '$MXPGN,01F801,2801,43E35D0CC48A30C1'
    var expected = {
      "pgn":129025,
      "src":1,
      "dst":255,
      "prio":0,
      "fields":{
        "Latitude": -99.7576511,
        "Longitude": 113.8973964,
      },
      "description":"Position, Rapid Update"
    }

    var fromPgn = new FromPgn({littleEndianMXPGN:true})

    fromPgn.on('error', (pgn, error) => {
      console.error(`Error parsing ${pgn.pgn} ${error}`)
      console.error(error.stack)
      done(error)
    })

    fromPgn.on('warning', (pgn, warning) => {
      done(new Error(`${pgn.pgn} ${warning}`))
    })

    fromPgn.on('pgn', (pgn) => {
      try {
        //console.log(JSON.stringify(pgn))
        delete pgn.input
        delete pgn.timestamp
        pgn.should.jsonEqual(expected)
        done()
      } catch ( e ) {
        done(e)
      }
    })

    fromPgn.parseString(mxpgn)
  })
})
