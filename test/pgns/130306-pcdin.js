module.exports = [{
  "expected": {
    // Note: analyzer produces timestamp in local time (not UTC) but this seems incorrect.
    //"timestamp":"1969-12-31-16:00:00,3",
    "timestamp":"1970-01-01T00:00:00.003Z",
    "prio":0,"src":1,"dst":255,"pgn":130306,"description":"Wind Data",
    "fields":{"SID":0,"Wind Speed":2.23,"Wind Angle":0.0966, "Reference":"Apparent"}
  },
  "input": "$PCDIN,01FD02,00000003,01,00DF00C603FAFFFF*20"
}]
