const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const fs = require('fs')
const _ = require("lodash")
const { FromPgn, toPgn } = require('../index')
const { encodeActisense } = require('../lib/stringMsg')

let testData = {}

fs
  .readdirSync('./test/pgns')
  .forEach(filename => {
    testData[filename.split('.')[0]] = (require(`./pgns/${filename}`))
  })

const TEST_PGN = process.env.TEST_PGN

if ( TEST_PGN ) {
  testData = { [TEST_PGN]: testData[TEST_PGN] }
} 

describe('from pgn test data converts', function () {

  _.keys(testData).forEach(key => {
    var dataList = testData[key]

    it(`from pgn ${key} (${dataList[0].expected.description}) converts`, function (done) {
      let testsRemaining = dataList.length
      function success() {
        testsRemaining -= 1
        if (!testsRemaining) done()
      }
      dataList.forEach(data => {
        if ( data.disabled ) {
          success()
          return
        }

        let format = typeof data.format !== 'undefined' ? data.format : 1

        var fromPgn = new FromPgn({format})

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
            //console.log(JSON.stringify(data.expected))
            delete pgn.bus
            if ( data.expected.timestamp ) {
              pgn.timestamp.should.be.a('string')
            } else {
              delete pgn.timestamp
            }
            delete pgn.input
            pgn.should.jsonEqual(data.expected)
            success()
          } catch ( e ) {
            done(e)
          }
        })

        let input = data.input
        if ( !Array.isArray(input) ) {
          input = [ input ]
        }
        input.forEach((msg) => { fromPgn.parseString(msg) })
      })
    })
  })
})

describe('to pgn test data converts', function () {
  _.keys(testData).forEach(key => {
    var dataList = testData[key]

    it(`to pgn ${key} (${dataList[0].expected.description}) converts`, function (done) {
      let testsRemaining = dataList.length
      function success() {
        testsRemaining -= 1
        if (!testsRemaining) done()
      }
      dataList.forEach(test => {
        if ( test.disabled || Array.isArray(test.input) ) {
          success()
          return
        }

        var data = toPgn(test.expected)
        var str = encodeActisense({ pgn: test.expected.pgn, data })

        var expected = test.input.split(',')
        var result = str.split(',')

        result[2].should.equal(expected[2])

        result.slice(5).should.deep.equal(expected.slice(5))
        success()
      })
    })
  })
})

