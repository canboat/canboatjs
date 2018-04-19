const chai = require('chai')
chai.Should()
chai.use(require('chai-things'))
chai.use(require('chai-json-equal'));

const fs = require('fs')
const _ = require("lodash")
const { FromPgn, toPgn, toActisenseSerialFormat} = require('../index')

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

      dataList.forEach(data => {
        if ( data.disabled ) {
          done()
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
            
            pgn.should.jsonEqual(data.expected)
            done()
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

      dataList.forEach(test => {
        if ( test.disabled ) {
          done()
          return
        }

        if (test.input.startsWith("$PCDIN")) {
          // PASS - No conversion to PCDIN available at the moment.
          done()
          return
        }

        var data = toPgn(test.expected)
        var str = toActisenseSerialFormat(test.expected.pgn, data)

        var expected = test.input.split(',')
        var result = str.split(',')

        result[2].should.equal(expected[2])

        result.slice(5).should.deep.equal(expected.slice(5))
        done()
      })
    })
  })
})


