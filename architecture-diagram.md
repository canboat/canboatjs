# Architecture Diagram: canboatjs, n2k-signalk, and signalk-server Integration

## Overview
This diagram shows how the three main components work together to process marine data from NMEA 2000 devices to Signal K format and beyond.

```mermaid
graph TB
    %% Hardware Layer
    subgraph "Hardware Layer"
        N2K[NMEA 2000 Network]
        CAN[CAN Bus]
        ACTISENSE[Actisense NGT-1]
        YDWG[Yacht Devices YDWG-02]
        IKON[Digital Yacht iKonvert]
        MINIPLEX[MiniPlex-3-N2K]
        SOCKETCAN[SocketCAN Interface]
    end

    %% Data Formats
    subgraph "Raw Data Formats"
        ACT_FMT["Actisense Format<br/>2017-03-13T01:00:00.146Z,2,127245,204,255,8,fc,f8,ff,7f,ff,7f,ff,ff"]
        YDWG_FMT["YDWG Raw Format<br/>16:29:27.082 R 09F8017F 50 C3 B8 13 47 D8 2B C6"]
        IKON_FMT["iKonvert Format<br/>!PDGY,127245,255,/Pj/f/9///8="]
        CANDUMP_FMT["candump Format<br/>can0  09F8027F   [8]  00 FC FF FF 00 00 FF FF"]
        PCDIN_FMT["PCDIN Format<br/>$PCDIN,01F119,00000000,0F,2AAF00D1067414FF*59"]
        MXPGN_FMT["MXPGN Format<br/>$MXPGN,01F801,2801,C1308AC40C5DE343*19"]
    end

    %% canboatjs Layer
    subgraph "canboatjs (@canboat/canboatjs)"
        direction TB
        FROMPGN[FromPgn Parser]
        UTILS[Utility Functions]
    end

    %% Parsed Data
    subgraph "Parsed N2K Data (JSON)"
        JSON_N2K["Canboat JSON Format<br/>{<br/>  'pgn': 127245,<br/>  'src': 204,<br/>  'dst': 255,<br/>  'fields': {<br/>    'Instance': 252,<br/>    'Direction Order': 0<br/>  }<br/>}"]
    end

    %% n2k-signalk Layer
    subgraph "n2k-signalk (@signalk/n2k-signalk)"
        direction TB
        N2K_MAPPER[N2kMapper]
        PGN_MAPPINGS[PGN Mappings]
        DELTA_CONV[Delta Converter]
        
        subgraph "PGN Mappings"
            STANDARD_PGNS[Standard PGNs]
            FUSION_PGNS[Fusion PGNs]
            LOWRANCE_PGNS[Lowrance PGNs]
            RAYMARINE_PGNS[Raymarine PGNs]
            MARETRON_PGNS[Maretron PGNs]
            ACTISENSE_PGNS[Actisense PGNs]
            DIGITALYACHT_PGNS[Digital Yacht PGNs]
            SIMRAD_PGNS[Simrad PGNs]
        end
    end

    %% Signal K Delta
    subgraph "Signal K Delta Format"
        SIGNALK_DELTA["Signal K Delta<br/>{<br/>  'context': 'vessels.self',<br/>  'updates': [{<br/>    'source': {<br/>      'pgn': 127245,<br/>      'src': '204'<br/>    },<br/>    'values': [{<br/>      'path': 'steering.rudderAngle',<br/>      'value': 0.1745<br/>    }]<br/>  }]<br/>}"]
    end

    %% signalk-server Layer
    subgraph "signalk-server"
        direction TB
        SERVER_CORE[Server Core]
        STREAM_PROCESSORS[Stream Processors]
        PROVIDERS[Data Providers]
        INTERFACES[Network Interfaces]
        PLUGINS[Plugin System]
        WEBAPP[Web Application]
        API[REST/WebSocket APIs]
        
        subgraph "Stream Processors"
            CANBOATJS_STREAM[CanboatJs Stream]
            N2K_SIGNALK_STREAM[N2kToSignalK Stream]
            NMEA0183_STREAM[NMEA0183ToSignalK]
            AUTODETECT[AutoDetect Stream]
        end

        subgraph "Data Providers"
            SIMPLE_PROVIDER[Simple Provider]
            EXECUTE_PROVIDER[Execute Provider]
            SERIAL_PROVIDER[Serial Provider]
            TCP_PROVIDER[TCP Provider]
            UDP_PROVIDER[UDP Provider]
            FILE_PROVIDER[File Provider]
        end

        subgraph "Network Interfaces"
            HTTP_INTERFACE[HTTP Server :3000]
            WS_INTERFACE[WebSocket Server]
            TCP_NMEA[TCP NMEA 0183 :10110]
            MDNS[mDNS Discovery]
        end

        subgraph "Plugin Ecosystem"
            TO_NMEA0183[signalk-to-nmea0183]
            N2KAIS_TO_NMEA0183[signalk-n2kais-to-nmea0183]
            TO_NMEA2000[signalk-to-nmea2000]
            AUTOPILOT[signalk-autopilot]
            VENUS_PLUGIN[signalk-venus-plugin]
            CUSTOM_PLUGINS[Custom Plugins...]
        end
    end

    %% Client Applications
    subgraph "Client Applications"
        APPS[Navigation Apps<br/>Navionics, iSailor,<br/>iNavX, Aqua Map]
        WIDGETS[Web Widgets]
        CUSTOM_CLIENTS[Custom Applications]
        WILHELMSK[WilhelmSK]
    end

    %% Output Formats
    subgraph "Output Data Formats"
        NMEA0183_OUT[NMEA 0183 TCP :10110]
        NMEA2000_OUT[NMEA 2000 Output]
        SIGNALK_WS[Signal K WebSocket]
        SIGNALK_REST[Signal K REST API]
        SIGNALK_TCP[Signal K TCP]
    end

    %% Connections - Hardware to canboatjs
    N2K --> ACTISENSE
    N2K --> YDWG
    N2K --> IKON
    N2K --> MINIPLEX
    CAN --> SOCKETCAN

    ACTISENSE --> ACT_FMT
    YDWG --> YDWG_FMT
    IKON --> IKON_FMT
    SOCKETCAN --> CANDUMP_FMT
    MINIPLEX --> MXPGN_FMT

    %% canboatjs parsing
    ACT_FMT --> FROMPGN
    YDWG_FMT --> FROMPGN
    IKON_FMT --> FROMPGN
    CANDUMP_FMT --> FROMPGN
    PCDIN_FMT --> FROMPGN
    MXPGN_FMT --> FROMPGN

    FROMPGN --> JSON_N2K

    %% n2k-signalk conversion
    JSON_N2K --> N2K_MAPPER
    PGN_MAPPINGS --> N2K_MAPPER
    N2K_MAPPER --> SIGNALK_DELTA

    %% signalk-server processing
    SIGNALK_DELTA --> N2K_SIGNALK_STREAM
    JSON_N2K --> CANBOATJS_STREAM
    CANBOATJS_STREAM --> N2K_SIGNALK_STREAM
    N2K_SIGNALK_STREAM --> SERVER_CORE

    PROVIDERS --> STREAM_PROCESSORS
    STREAM_PROCESSORS --> SERVER_CORE
    SERVER_CORE --> API
    SERVER_CORE --> INTERFACES
    SERVER_CORE --> PLUGINS

    %% Output connections
    API --> SIGNALK_WS
    API --> SIGNALK_REST
    INTERFACES --> TCP_NMEA
    INTERFACES --> SIGNALK_TCP
    PLUGINS --> NMEA0183_OUT
    PLUGINS --> NMEA2000_OUT

    %% Client connections
    SIGNALK_WS --> APPS
    SIGNALK_REST --> WIDGETS
    TCP_NMEA --> APPS
    SIGNALK_TCP --> CUSTOM_CLIENTS
    SIGNALK_WS --> WILHELMSK

    %% Styling
    classDef hardware fill:#e1f5fe,stroke:#0277bd,stroke-width:2px
    classDef format fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef canboatjs fill:#e8f5e8,stroke:#2e7d32,stroke-width:2px
    classDef n2ksignalk fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef signalkserver fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef output fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef clients fill:#f1f8e9,stroke:#558b2f,stroke-width:2px

    class N2K,CAN,ACTISENSE,YDWG,IKON,MINIPLEX,SOCKETCAN hardware
    class ACT_FMT,YDWG_FMT,IKON_FMT,CANDUMP_FMT,PCDIN_FMT,MXPGN_FMT format
    class FROMPGN,UTILS canboatjs
    class N2K_MAPPER,PGN_MAPPINGS,DELTA_CONV,STANDARD_PGNS,FUSION_PGNS,LOWRANCE_PGNS,RAYMARINE_PGNS,MARETRON_PGNS,ACTISENSE_PGNS,DIGITALYACHT_PGNS,SIMRAD_PGNS n2ksignalk
    class SERVER_CORE,STREAM_PROCESSORS,PROVIDERS,INTERFACES,PLUGINS,WEBAPP,API,CANBOATJS_STREAM,N2K_SIGNALK_STREAM,NMEA0183_STREAM,AUTODETECT,SIMPLE_PROVIDER,EXECUTE_PROVIDER,SERIAL_PROVIDER,TCP_PROVIDER,UDP_PROVIDER,FILE_PROVIDER,HTTP_INTERFACE,WS_INTERFACE,TCP_NMEA,MDNS,TO_NMEA0183,N2KAIS_TO_NMEA0183,TO_NMEA2000,AUTOPILOT,VENUS_PLUGIN,CUSTOM_PLUGINS signalkserver
    class NMEA0183_OUT,NMEA2000_OUT,SIGNALK_WS,SIGNALK_REST,SIGNALK_TCP output
    class APPS,WIDGETS,CUSTOM_CLIENTS,WILHELMSK clients
```

## Data Flow Explanation

### 1. **Hardware Layer**
- **NMEA 2000 Network**: Marine electronics network using CAN bus protocol
- **Gateways**: Various hardware devices that bridge NMEA 2000 to serial/ethernet/wifi
- **Interfaces**: Direct CAN bus interfaces for Linux systems

### 2. **canboatjs (@canboat/canboatjs)**
**Purpose**: Parse and encode NMEA 2000 data in various formats
- **FromPgn Parser**: Core parser that converts various N2K formats to standardized JSON
- **Utility Functions**: Format conversion, detection, and encoding functions

**Key Features**:
- Multi-format input support (Actisense, YDWG, iKonvert, etc.)
- Real-time stream processing
- Bidirectional conversion (parse and generate)
- Hardware abstraction layer

### 3. **n2k-signalk (@signalk/n2k-signalk)**
**Purpose**: Convert parsed NMEA 2000 JSON to Signal K delta format
- **N2kMapper**: Main conversion engine
- **PGN Mappings**: Manufacturer-specific and standard PGN definitions
- **Delta Converter**: Transforms N2K data to Signal K delta updates

**Key Features**:
- Comprehensive PGN coverage
- Manufacturer-specific extensions
- Signal K delta format output
- Custom mapping support

### 4. **signalk-server**
**Purpose**: Central hub for marine data processing and distribution
- **Stream Processors**: Handle different data types and formats
- **Data Providers**: Connect to various data sources
- **Plugin System**: Extensible architecture for custom functionality
- **Network Interfaces**: Serve data via HTTP, WebSocket, TCP, etc.

**Key Features**:
- Multi-protocol support (NMEA 2000, NMEA 0183, Signal K)
- Web-based administration interface
- Plugin ecosystem for extensions
- Real-time data streaming
- Format conversion and bridging

## Integration Points

### **canboatjs → n2k-signalk**
- canboatjs parses raw N2K data into standardized JSON format
- n2k-signalk consumes this JSON and converts it to Signal K deltas
- Both libraries share common PGN definitions from @canboat/ts-pgns

### **n2k-signalk → signalk-server**
- signalk-server uses n2k-signalk as a stream processor
- N2K data flows through canboatjs → n2k-signalk → Signal K deltas
- Server maintains device metadata and manages data flow

## Output Capabilities

### **Data Formats**
- **Signal K**: Native JSON format via WebSocket and REST APIs
- **NMEA 0183**: Converted output via TCP for legacy applications
- **NMEA 2000**: Bidirectional N2K communication

### **Client Applications**
- **Navigation Apps**: Navionics, iSailor, iNavX, Aqua Map via NMEA 0183 TCP
- **Signal K Apps**: WilhelmSK and custom applications via Signal K APIs
- **Web Applications**: Browser-based instruments and controls
- **Custom Clients**: Direct API access for specialized applications

## Key Benefits

1. **Multi-Format Support**: Handle various proprietary formats from different manufacturers
2. **Real-Time Processing**: Stream-based architecture for live data
3. **Extensibility**: Plugin system and custom mappings
4. **Standardization**: Convert proprietary formats to open Signal K standard
5. **Bridging**: Connect legacy NMEA 0183 apps to modern NMEA 2000 networks
6. **Device Integration**: Support for multiple hardware interfaces and protocols
