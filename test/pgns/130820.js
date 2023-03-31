module.exports = [{
  "expected": {"timestamp":"2017-04-15T14:57:58.469Z","prio":7,"src":10,"dst":255,"pgn":130820,"description":"Fusion: Power State","fields":{"Manufacturer Code":"Fusion","Industry Code":"Marine Industry","Message ID":"Power","A":128,"State":"On"}},
  "input": "2017-04-15T14:57:58.469Z,7,130820,10,255,5,a3,99,20,80,01"
},{
  "expected": {"prio":7,"pgn":130820,"dst":255,"src":11,"timestamp":"2023-03-30T18:28:03.510Z","fields":{"Manufacturer Code":"Fusion","Industry Code":"Marine Industry","Message ID":"Source","A":128,"Source ID":1,"Current Source ID":11,"D":1,"E":197,"Source":"FM"},"description":"Fusion: Source Name"},
  "input": "2023-03-30T18:28:03.510Z,7,130820,11,255,12,a3,99,02,80,01,0b,01,c5,02,46,4d,00"}
]
