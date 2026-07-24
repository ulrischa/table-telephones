# table-telephones

`table-telephones` ist eine installierbare PWA für lokale Gruppenchats mit Text
und Bildern. Die App benötigt weder Chat-Backend noch Signalisierungs-, STUN-
oder TURN-Server. Nach dem ersten vollständigen Laden über HTTPS kann sie ohne
Internetzugang verwendet werden.

## Funktionen

- Text- und Bildchat für zwei oder mehr Teilnehmer
- direkte WebRTC-DataChannel-Verbindungen im selben WLAN oder Smartphone-Hotspot
- manueller Verbindungsaufbau mit Einladungs- und Antwort-QR-Code
- QR-Scan per Kamera oder Bilddatei sowie Verbindungscode als Fallback
- Teilen des QR-Codes als PNG über die Web Share API
- installierbare und offlinefähige PWA
- keine Konten, Datenbank, Werbung, Tracker oder externen Ressourcen
- keine dauerhafte Speicherung von Nachrichten und Bildern
- responsive und tastaturbedienbare Oberfläche

## So funktioniert die Verbindung

1. Alle Geräte öffnen die App im selben WLAN oder Smartphone-Hotspot.
2. Der Raum-Ersteller gibt einen Namen ein, startet einen Chat und zeigt den
   Einladungs-QR-Code.
3. Ein Teilnehmer scannt die Einladung und zeigt den erzeugten Antwort-QR-Code.
4. Der Raum-Ersteller scannt die Antwort. Danach öffnet sich die direkte
   WebRTC-Verbindung.
5. Für jeden weiteren Teilnehmer wird der Vorgang wiederholt.

Alternativ lassen sich QR-Bilder auswählen oder die kompakten Verbindungscodes
kopieren und einfügen. Die Einladungen sind 15 Minuten gültig.

Bei einem Gruppenchat ist der Raum-Ersteller der lokale Relay-Peer: Jeder
Teilnehmer ist direkt mit ihm verbunden, und er leitet Nachrichten an die
übrigen Teilnehmer weiter. Deshalb muss sein Gerät während des Chats verbunden
bleiben. Eine nachträgliche Zustellung gibt es nicht.

## Voraussetzungen

- aktueller Browser mit WebRTC DataChannel
- gemeinsames lokales Netz ohne Client- oder AP-Isolation
- HTTPS für Installation, Service Worker, Kamera und Web Share
- gegebenenfalls Freigabe für Kamera und lokales Netzwerk im Browser oder
  Betriebssystem

Die Kamera und Web Share sind optional: QR-Bilder und Verbindungscodes dienen
als Fallback. Manche Firmen-, Gäste- und öffentliche WLANs isolieren verbundene
Geräte. In solchen Netzen kann WebRTC trotz korrektem QR-Austausch keine direkte
Verbindung aufbauen.

## Entwicklung

Voraussetzung ist Node.js 22.12 oder neuer.

```bash
npm ci --ignore-scripts
npm run check
npm run dev
```

Produktions-Build erstellen:

```bash
npm run build
```

Lokale Vorschau des Builds starten:

```bash
npm run preview
```

## Bereitstellung

Den Inhalt von `dist/` unverändert über HTTPS ausliefern. Relative Asset-Pfade
ermöglichen auch die Bereitstellung in einem Unterverzeichnis.

Für Sicherheitsheader enthält das Projekt:

- `public/_headers` für kompatible Static Hosts
- `deploy/nginx.conf.example` als nginx-Beispiel
- `public/web.config` für IIS; die Datei wird in `dist/` übernommen

Nach dem ersten erfolgreichen Laden speichert der Service Worker die App-Hülle
lokal. Dadurch lässt sich die installierte App später ohne Internet öffnen.

## Sicherheit und Datenschutz

- WebRTC verschlüsselt jede Peer-Verbindung mit DTLS.
- Der QR-Austausch ersetzt einen zentralen Signalisierungsserver.
- Bei Gruppen endet die Verschlüsselung jeweils beim Raum-Ersteller, da er die
  Nachrichten an die anderen Peer-Verbindungen weiterleitet.
- Texte werden ausschließlich als Text in das DOM eingefügt.
- Bilder werden neu kodiert, auf 3 MB begrenzt und beim Empfang anhand von
  Dateisignatur, MIME-Typ und tatsächlichen Abmessungen geprüft.
- Verbindungsdaten, Protokollnachrichten, Namen, Texte, Bilder und
  Teilnehmerlisten werden validiert und in ihrer Größe begrenzt.
- Die App baut keine externen Verbindungen auf und speichert keine Chats
  dauerhaft.
- Eine restriktive Content Security Policy und weitere Sicherheitsheader sind
  enthalten.

Weitere Einzelheiten und bekannte Vertrauensgrenzen stehen in
[SECURITY.md](SECURITY.md).

## Tests

```bash
npm run check
npm run build
npm audit --audit-level=high
npm audit signatures
```

Die automatisierten Tests decken Signalcodierung, Dekompressionsgrenzen,
Protokollvalidierung, XSS-Nutzdaten und Bildsignaturen ab. Oberfläche,
QR-Fallback, Offline-Neuladen und mobile Darstellung wurden zusätzlich in
Chromium geprüft.

Da Headless-Chromium in der verwendeten Testumgebung keine lokalen
ICE-Kandidaten bereitstellt, muss die tatsächliche WLAN- oder
Hotspot-Verbindung zusätzlich mit mindestens zwei physischen Geräten geprüft
werden.

## Technische Grenzen

- keine Verbindung über unterschiedliche Netze, da STUN und TURN bewusst fehlen
- keine automatische Gerätesuche; jede Verbindung benötigt zwei Signalisierungsschritte
- keine Chat-Historie und keine Zustellung an nicht verbundene Teilnehmer
- Raum-Ersteller als Relay-Peer und Single Point of Failure bei Gruppen
- Protokolllimit von 128 Teilnehmern einschließlich Raum-Ersteller; die
  praktisch nutzbare Anzahl liegt abhängig von Gerät, Browser und Bildvolumen
  meist deutlich darunter
