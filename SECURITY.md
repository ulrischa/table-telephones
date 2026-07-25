# Security

## Unterstützte Nutzung

Die App ist für kurzlebige Chats in einem vertrauenswürdigen lokalen WLAN oder
Hotspot gedacht. Sie ersetzt keinen Messenger mit verifizierten Konten,
Schlüsselverwaltung, Ende-zu-Ende-verschlüsselter dauerhafter Historie oder
anonymer Kommunikation.

## Vertrauensgrenzen

- QR-Codes und eingefügte Verbindungscodes sind nicht vertrauenswürdig.
- Jeder DataChannel-Peer kann manipulierte Protokollnachrichten senden.
- Ausgewählte und empfangene Bilder sind nicht vertrauenswürdig.
- Bei Gruppen sieht und relayed der Raum-Ersteller alle Nachrichten.

## Schutzmaßnahmen

- kein Backend, keine Datenbank, kein Tracking und keine externen Requests
- WebRTC DTLS für Transportverschlüsselung
- keine ICE-Server und dadurch keine Internet-Relay-Verbindungen
- streng validierte, komprimierte Signalcodes mit Dekompressionslimit
- Größenlimits für Text, Steuerpakete, Bilder und Teilnehmerlisten
- 16-KB-Bildblöcke mit Backpressure auf dem DataChannel
- Rasterbilder ausschließlich als JPEG, PNG oder WebP; kein SVG
- sichere DOM-Ausgabe ohne `innerHTML`
- restriktive CSP, Permissions Policy und weitere HTTP-Sicherheitsheader
- kein dauerhafter Nachrichten- oder Bildspeicher

## Bekannte Grenzen

- Ein abgegriffener gültiger QR-Code kann eine unberechtigte Verbindung erlauben.
- Namen sind nicht verifiziert und können nachgeahmt werden.
- Der Raum-Ersteller ist bei Gruppenchats ein vertrauenswürdiger Relay-Peer.
- Browser- und Bilddecoder-Sicherheitsupdates liegen außerhalb der App.
- Schutz vor Funkstörungen oder gezielter Überlastung des lokalen Netzes ist nicht
  möglich.

Sicherheitsrelevante Fehler sollten mit Browser, Betriebssystem, reproduzierbaren
Schritten und ohne echte Chat-Inhalte gemeldet werden.
