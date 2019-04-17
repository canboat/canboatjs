const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const fs = require('fs')
const _ = require("lodash")
const { FromPgn, toPgn } = require('../index')
const { encodeActisense } = require('../lib/stringMsg')

const testData = {}
fs
  .readdirSync('./test/pgns')
  .forEach(filename => {
    testData[filename.split('.')[0]] = (require(`./pgns/${filename}`))
  })

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

        var fromPgn = new FromPgn({format: 1})

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
            pgn.timestamp.should.be.a('string')
            pgn.should.jsonEqual(data.expected)
            success()
          } catch ( e ) {
          done(e)
          }
        })

        fromPgn.parseString(data.input)
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
        if ( test.disabled ) {
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

describe('callback is called', function (done) {
  const testData = require('./pgns/59392')
  const fromPgn = new FromPgn({ format: 1 })

  it('successfully for string input', done => {
    fromPgn.parse(testData[0].input, (err, result) => {
      result.should.deep.equal(testData[0].expected)
      done()
    })
  })

  // it('with error', done => {
  //   const testData = require('./pgns/59392')
  //   const fromPgn = new FromPgn({ format: 1 })
  //   //error is emitted, so we must have an error handler
  //   fromPgn.on('error', err => { })
  //   fromPgn.parse(testData[0].input.replace(',ff,', ',kk,'), (err, result) => {
  //     try {
  //       (typeof err).should.not.equal('undefined')
  //       done()
  //     } catch (err) {
  //       done(err)
  //     }
  //   })
  // })
})
