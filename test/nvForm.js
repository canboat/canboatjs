const chai = require('chai')
chai.Should()

const { FromPgn } = require('../dist/index')
const { toPgn } = require('../dist/toPgn')

// canboat's --nv JSON (canboat convert --nv, analyzer -nv) gives a value as
// {value, name}: toPgn reads it as the value it holds (#574). Each case is
// canboat 9.2.0's output for the line next to it, and must write the same
// bytes as canboatjs's own decode of that line.
const hex = (pgn) => Buffer.from(toPgn(pgn)).toString('hex')
const fromLine = (lines, format) => {
  const parser = new FromPgn({ useCamel: true, format })
  let pgn
  for (const line of lines) pgn = parser.parseString(line) || pgn
  return pgn
}

describe('canboat --nv JSON', () => {
  it('reads lookups, a date and a time, with and without key', () => {
    const nv = {
      pgn: 129029,
      fields: {
        date: {
          value: 20612,
          name: '2026.06.08'
        },
        time: {
          value: 6684.2,
          name: '01:51:24.2000'
        },
        latitude: 21.2835018,
        longitude: -157.8428998,
        altitude: 21.203671,
        gnssType: {
          value: 4,
          name: 'GPS+SBAS/WAAS+GLONASS'
        },
        method: {
          value: 2,
          name: 'DGNSS fix'
        },
        integrity: {
          value: 0,
          name: 'No integrity checking'
        },
        numberOfSvs: 26,
        hdop: 0.5,
        pdop: 0.7,
        geoidalSeparation: 3.3,
        referenceStations: 0
      }
    }
    hex(nv).should.equal(
      hex(
        fromLine(
          [
            '2026-06-08T01:51:24.232,3,129029,52,255,43,ff,84,50,90,ed,fb,03,c0,f2,28,38,52,24,f4,02,00,66,c0,75,30,4b,18,ea,d7,8a,43,01,00,00,00,00,24,fc,1a,32,00,46,00,4a,01,00,00,00'
          ],
          1
        )
      )
    )
  })

  it('reads a bit lookup wider than 32 bits as its list of bits', () => {
    const nv = {
      pgn: 130820,
      fields: {
        manufacturerCode: {
          value: 419,
          name: 'Fusion Electronics'
        },
        industryCode: {
          value: 4,
          name: 'Marine Industry'
        },
        messageId: {
          value: 32829,
          name: 'System Capabilities',
          key: true
        },
        capabilities: [
          {
            value: 1,
            name: 'ANT'
          },
          {
            value: 2,
            name: 'Bluetooth'
          },
          {
            value: 8,
            name: 'Ethernet'
          },
          {
            value: 16,
            name: 'NMEA 2000'
          },
          {
            value: 128,
            name: 'Power Button'
          },
          {
            value: 1024,
            name: 'USB Connector'
          },
          {
            value: 4096,
            name: 'DSP'
          },
          {
            value: 8192,
            name: 'AM/FM Antenna'
          },
          {
            value: 32768,
            name: 'SiriusXM Connector'
          },
          {
            value: 65536,
            name: 'S/PDIF'
          },
          {
            value: 524288,
            name: 'Telephone Mute'
          },
          {
            value: 2097152,
            name: 'Ignition Wire'
          },
          {
            value: 8388608,
            name: 'STM32 Coprocessor'
          },
          {
            value: 33554432,
            name: 'Multiroom Source'
          },
          {
            value: 67108864,
            name: 'Multiroom Renderer'
          },
          {
            value: 134217728,
            name: null
          },
          {
            value: 268435456,
            name: null
          },
          {
            value: 536870912,
            name: null
          },
          {
            value: 1073741824,
            name: null
          },
          {
            value: 2147483648,
            name: null
          },
          {
            value: 8589934592,
            name: 'Amplifier and Line Out Independent'
          },
          {
            value: 17179869184,
            name: 'Wake on LAN'
          },
          {
            value: 34359738368,
            name: 'SiriusXM Instant Replay'
          },
          {
            value: 68719476736,
            name: 'SiriusXM TuneMix'
          },
          {
            value: 137438953472,
            name: 'Artist and Song Alert'
          },
          {
            value: 274877906944,
            name: 'Game Alert'
          },
          {
            value: 549755813888,
            name: 'Sports Flash'
          },
          {
            value: 2199023255552,
            name: 'Zone 1 Amplifier 2 Ohm Stable'
          },
          {
            value: 8796093022208,
            name: 'Zone 2 Amplifier 2 Ohm Stable'
          },
          {
            value: 35184372088832,
            name: 'Apple AirPlay'
          },
          {
            value: 70368744177664,
            name: 'Volume Sync Zone'
          },
          {
            value: 140737488355328,
            name: 'Source Disable'
          },
          {
            value: 281474976710656,
            name: 'Source Rename'
          },
          {
            value: 2251799813685248,
            name: null
          },
          {
            value: 4503599627370496,
            name: null
          }
        ]
      }
    }
    hex(nv).should.equal('a3993d809bb4a9fefeea1900')
  })

  it('reads the parameters of a group function', () => {
    const nv = {
      pgn: 126208,
      fields: {
        functionCode: {
          value: 1,
          name: 'Command'
        },
        pgn: {
          value: 65379
        },
        priority: {
          value: 8,
          name: 'Leave unchanged'
        },
        numberOfParameters: 4,
        list: [
          {
            parameter: 1,
            value: {
              value: 1851,
              name: 'Raymarine'
            }
          },
          {
            parameter: 3,
            value: {
              value: 4,
              name: 'Marine Industry'
            }
          },
          {
            parameter: 4,
            value: {
              value: 0,
              name: 'Standby'
            }
          },
          {
            parameter: 5,
            value: 'FF FF'
          }
        ]
      }
    }
    // The message as sent. (canboatjs's own decode leaves out parameter
    // 5, all ones, so it cannot be written back that way: #567.)
    hex(nv).should.equal('0163ff00f804013b07030404000005ffff')
  })

  it('leaves the message it is given as it is', () => {
    const fields = {
      sid: 100,
      windSpeed: 0,
      windAngle: 3.3484,
      reference: { value: 2, name: 'Apparent', key: true }
    }
    hex({ pgn: 130306, fields }).should.equal('640000cc82faffff')
    fields.reference.should.deep.equal({
      value: 2,
      name: 'Apparent',
      key: true
    })
  })
})
