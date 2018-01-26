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
    it(`from pgn ${key} converts`, function (done) {
      var dataList = testData[key]

      dataList.forEach(data => {
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
            //console.log(JSON.stringify(data.expected))
            delete pgn.timestamp
            delete data.expected.timestamp
            
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
    it(`to pgn ${key} converts`, function (done) {
      var dataList = testData[key]

      dataList.forEach(data => {
        var res = toPgn(data.expected)
        var str = toActisenseSerialFormat(data.expected.pgn, res)
        str.should.equal(data.input)
      })
    })
  })
})
    
