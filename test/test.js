const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'))

const fs = require('fs')
const _ = require('lodash')
const { FromPgn, toPgn } = require('../dist/index')
const { encodeActisense } = require('../dist/stringMsg')

let testData = {}

fs.readdirSync('./test/pgns').forEach((filename) => {
  testData[filename.split('.')[0]] = require(`./pgns/${filename}`)
})

const TEST_PGN = process.env.TEST_PGN

if (TEST_PGN) {
  testData = { [TEST_PGN]: testData[TEST_PGN] }
}

describe('from pgn test data converts', function () {
  _.keys(testData).forEach((key) => {
    var dataList = testData[key]

    dataList.forEach((data, idx) => {
      it(`from pgn ${key} (${data.expected.description}) (${idx}) converts`, function (done) {
        let format = typeof data.format !== 'undefined' ? data.format : 1
        let useCamel = true //data.useCamel == true

        var fromPgn = new FromPgn({ format, returnNulls: true, useCamel })

        fromPgn.on('error', (pgn, error) => {
          console.error(`Error parsing ${pgn.pgn} ${error}`)
          console.error(error.stack)
          done(error)
        })

        fromPgn.on('warning', (pgn, warning) => {
          done(new Error(`${pgn.pgn} ${warning}`))
        })

        fromPgn.on('pgn', (pgn) => {})

        let input = data.input
        if (!Array.isArray(input)) {
          input = [input]
        }
        let gotResult = false
        input.forEach((msg) => {
          const pgn = fromPgn.parseString(msg)
          if (pgn) {
            gotResult = true
            try {
              //console.log(JSON.stringify(data.expected))
              delete pgn.bus
              if (data.expected.timestamp) {
                pgn.timestamp.should.be.a('string')
              } else {
                delete pgn.timestamp
              }
              delete pgn.input
              if (data.ignoreTimestamp) {
                delete data.expected.timestamp
                delete pgn.timestamp
              }
              pgn.should.jsonEqual(data.expected)
              done()
            } catch (e) {
              done(e)
            }
          }
        })

        if (gotResult == false) {
          done(new Error('no pgn data received'))
        }
      })
    })
  })
})

describe('to pgn test data converts', function () {
  _.keys(testData).forEach((key) => {
    var dataList = testData[key]

    dataList.forEach((test, idx) => {
      if (test.disabled || test.skipEncoderTest || Array.isArray(test.input)) {
        return
      }

      it(`to pgn ${key} (${test.expected.description}) (${idx}) converts`, function (done) {
        try {
          var data = toPgn(test.expected)
          var str = encodeActisense({ pgn: test.expected.pgn, data })

          var expected = test.input.split(',')
          var result = str.split(',')

          result[2].should.equal(expected[2])

          result.slice(5).should.deep.equal(expected.slice(5))
          done()
        } catch (err) {
          done(err)
        }
      })
    })
  })
})
