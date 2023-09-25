module.exports = [
  {
    "expected": {"timestamp":"2017-04-15T16:02:48.913Z","prio":7,"src":1,"dst":255,"pgn":126720,"description":"Seatalk1: Device Identification","fields":{"Manufacturer Code":"Raymarine","Industry Code":"Marine Industry","Proprietary ID":"0x81f0","command":"0x90","device":"S100","Reserved1":null,"Reserved2":null}},
    "input": "2017-04-15T16:02:48.913Z,7,126720,1,255,7,3b,9f,f0,81,90,ff,03"
  },
  {
    "expected": {"timestamp":"2023-09-25T18:06:16.648Z","prio":7,"src":35,"dst":100,"pgn":126720,"description":"Airmar: Calibrate Speed","fields":{"Manufacturer Code":"Airmar","Industry Code":"Marine Industry","Proprietary ID":"Calibrate Speed","Number of pairs of data points":8,"Reserved1":null,"list":[{"Input frequency":2.3,"Output speed":0.51},{"Input frequency":7.9,"Output speed":1.03},{"Input frequency":17.9,"Output speed":2.06},{"Input frequency":26.6,"Output speed":3.09},{"Input frequency":34.0,"Output speed":4.12},{"Input frequency":44.6,"Output speed":6.17},{"Input frequency":47.9,"Output speed":7.20},{"Input frequency":49.9,"Output speed":8.23}]}},
    "format": 0,
    "input": [
      "2023-09-25T18:06:16.632Z,7,126720,35,100,8,c0,24,87,98,29,08,17,00",
      "2023-09-25T18:06:16.636Z,7,126720,35,100,8,c1,33,00,4f,00,67,00,b3",
      "2023-09-25T18:06:16.639Z,7,126720,35,100,8,c2,00,ce,00,0a,01,35,01",
      "2023-09-25T18:06:16.641Z,7,126720,35,100,8,c3,54,01,9c,01,be,01,69",
      "2023-09-25T18:06:16.645Z,7,126720,35,100,8,c4,02,df,01,d0,02,f3,01",
      "2023-09-25T18:06:16.648Z,7,126720,35,100,8,c5,37,03,ff,ff,ff,ff,ff"
    ]
  }
]
