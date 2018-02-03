# Canboatjs
Pure javascript NMEA 2000 decoder and encoder

Canboatjs is a port of the canboat project (https://github.com/canboat/canboat) to javascript and it is inteded to be used with the [Signal K Node Server](https://github.com/SignalK/signalk-server-node)


# Features

- Read directly from an Actisense NGT-1 
- Read from a canbus using [socketcan](https://www.npmjs.com/package/socketcan)
- Supports input in canboat analyzer json format
- Take input in canboat analyzer json format and convert to binary N2K format and output to the NGT-1 or canbus

# PGN Data
The details about the PGN's recognized by canboatjs come from the canboat project in the [pgns.json](https://github.com/canboat/canboat/blob/master/analyzer/pgns.json) file. If you want to add or update PGN data, please make changes to the pgn.h file in canboat and submit a pull request there. Please include sample data and raise an issue here so that I can include your changes in canboatjs.


# Command Line Programs

## analyzerjs
This program is similar to the canboat `analyzer` command-line. It takes input in the actisense serial format and outputs canboat json for mat.

## to-pgn
This program takes input in the canboat json format and outputs actisense serial format.

## candumpanalyzer
This program takes input in the candump format and outputs canboat json format

# Signal K Node Server Configuration

## Actisense NTG-1 Configuration
You can use the admin ui to use canbusjs with an Actisense NTG-1. Add a new provider, make the input type "NMEA 2000" and select "Actisense NTG-1 (pure js, experimental)" for the "NMEA 2000 Source".

To configure in the settings file manually, add the following to your pipedProviders and fill in the correct usb device.
```
    {                                                                           
      "id": "actisense-canboatjs",                                                        
      "pipeElements": [                                                         
        {                                                                       
          "type": "providers/actisense-serial",                                 
          "options": {                                                          
            "device": "/dev/ttyUSB0"                                            
          }                                                                     
        },                                                                      
        {                                                                       
          "type": "providers/canboatjs"                                         
        },                                                                      
        {                                                                       
          "type": "providers/n2k-signalk",                                      
        }                                                                       
      ],                                                                        
      "enabled": true                                                          
    },                                                                          
```

## canbus Configuration
Current the only way to configure for canbus is to manually edit your settings file.
```
    {                                                                           
      "id": "canbus-canboatjse",                                          
      "enabled": true,                                                          
      "pipeElements": [                                                         
        {                                                                       
          "type": "providers/canbus",                                           
          "options": {
            "canDevice": "can0"
          }                                                                     
        },                                                                      
        {                                                                       
          "type": "providers/canboatjs"                                         
        },                                                                      
        {                                                                       
          "type": "providers/n2k-signalk"                                       
        }                                                                       
      ]                                                                         
    }                                                                           
```

# Sending NMEA 2000 PGNs From Node Server Plugins
You can send out N2K PGNs from server plugins by emiting 'nmea2000out' to the app object in either actisense serial format or analizer json format. Please note that the [signalk-to-nmea2000](https://github.com/SignalK/signalk-to-nmea2000) plugin can convert many things in Signal K to N2K and automatically output via Canboatjs.

#### Example Output In a Plugin
```
const pgn = {
  pgn: 130306,
  'Wind Speed': speed,
  'Wind Angle': angle < 0 ? angle + Math.PI*2 : angle,
  'Reference': "Apparent"
}
app.emit('nmea2000out', pgn)
```

# Canbus and SAE J1939
The canbus provider participates correctly in the SAE J1939 Address Claim Procedure. This means the your canbus device will get a correct canbus address and register with and be recognized by other N2K devices on the network.

By default it attempts to register using address 100, but will adjust accourdingly if there is another device on the network with the same address. If there are issues with that process, you can configure Canboatjs to default to a different address by setting the `preferedAddress` option:
```
    {                                                                           
      "id": "canbus-canboatjse",                                          
      "enabled": true,                                                          
      "pipeElements": [                                                         
        {                                                                       
          "type": "providers/canbus",                                           
          "options": {
            "canDevice": "can0",
            "preferredAddress": 7
          }                                                                     
        },                                                                      
        {                                                                       
          "type": "providers/canboatjs"                                         
        },                                                                      
        {                                                                       
          "type": "providers/n2k-signalk"                                       
        }                                                                       
      ]                                                                         
    }                                                                           
```

Canboatjs also responds to an ISO Request for PGN 126464, which is a request to find out which PGNs the device transmits. It currently defaults with PGNs supported internally and the PGNs supported by signalk-to-nmea2000. You can add to this list by providing the `transmitPGNs` option:
```
    {                                                                           
      "id": "canbus-canboatjse",                                          
      "enabled": true,                                                          
      "pipeElements": [                                                         
        {                                                                       
          "type": "providers/canbus",                                           
          "options": {
            "canDevice": "can0",
            "transmitPGNs": [ 123456, 123457 ] 
          }                                                                     
        },                                                                      
        {                                                                       
          "type": "providers/canboatjs"                                         
        },                                                                      
        {                                                                       
          "type": "providers/n2k-signalk"                                       
        }                                                                       
      ]                                                                         
    }                                                                           
```
