# table-telephones

`table-telephones` ist eine installierbare PWA für lokale Gruppenchats mit Text
und Bildern. Die App benötigt weder Chat-Backend noch Signalisierungs-, STUN-
oder TURN-Server. Nach dem ersten vollständigen Laden über HTTPS kann sie ohne
Internetzugang verwendet werden.

## Funktionen

- Text- und Bildchat für zwei oder mehr Teilnehmer
- direkte WebRTC-DataChannel-Verbindungen im selben WLAN oder Smartphone-Hotspot
- teilbarer Einladungslink mit eingebettetem Verbindungscode und Rohcode-Fallback
- Namensabfrage und direkte Annahme nach dem Öffnen des Einladungslinks
- Antwortcode per Web Share oder Zwischenablage; QR-Scan weiterhin als Fallback
- installierbare und offlinefähige PWA
- keine Konten, Datenbank, Werbung, Tracker oder externen Ressourcen
- keine dauerhafte Speicherung von Nachrichten und Bildern
- responsive und tastaturbedienbare Oberfläche

## So funktioniert die Verbindung

1. Alle Geräte öffnen die App im selben WLAN oder Smartphone-Hotspot.
2. Der Raum-Ersteller gibt einen Namen ein, startet einen Chat und teilt den
   Einladungslink.
3. Ein Teilnehmer öffnet den Link, gibt seinen Namen ein und nimmt die Einladung
   an.
4. Der Teilnehmer teilt den erzeugten Antwortcode zurück. Der Raum-Ersteller
   fügt ihn in der weiterhin geöffneten App ein. Danach öffnet sich die direkte
   WebRTC-Verbindung.
5. Für jeden weiteren Teilnehmer wird der Vorgang wiederholt.

Einladungslink und Antwortcode lassen sich über die Web Share API oder die
Zwischenablage weitergeben. Für eine Übertragung ohne Internet muss im
systemeigenen Teilen-Menü ein lokales Ziel wie Quick Share, AirDrop oder
Bluetooth gewählt werden. Der geteilte Einladungstext enthält zusätzlich den
rohen Verbindungscode als Fallback. QR-Codes werden hochauflösend und
modulgenau erzeugt und können direkt per Kamera gelesen oder als Bild ausgewählt
werden. Die Einladungen sind 15 Minuten gültig.

Ein gemeinsames WLAN transportiert einen Einladungslink nicht selbst. Ohne
Internet kann das zweite Gerät den Link nur öffnen, wenn die PWA dort bereits
installiert oder zuvor vollständig geladen und vom Service Worker
zwischengespeichert wurde. Andernfalls müssen beide Geräte die App zunächst
einmal mit Internetzugang laden.

Der Einladungslink speichert den Verbindungscode im URL-Fragment. Dieses
Fragment wird nicht an den Webserver übertragen und nach dem Einlesen aus der
Adresszeile entfernt.

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

Kamera und Web Share sind optional: Zwischenablage, QR-Bilder und
Verbindungscodes dienen als Fallback. Manche Firmen-, Gäste- und öffentliche
WLANs isolieren verbundene Geräte. In solchen Netzen kann WebRTC trotz
korrektem Signalaustausch keine direkte Verbindung aufbauen.

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
lokal und liefert sie bei weiteren Aufrufen aus dem Cache. Dadurch lassen sich
die installierte App und Einladungslinks später ohne Internet öffnen.

## Sicherheit und Datenschutz

- WebRTC verschlüsselt jede Peer-Verbindung mit DTLS.
- Der Austausch von Einladungslink und Antwortcode ersetzt einen zentralen
  Signalisierungsserver.
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
- keine automatische Gerätesuche; jede Verbindung benötigt weiterhin
  Einladungs- und Antwortschritt
- keine Chat-Historie und keine Zustellung an nicht verbundene Teilnehmer
- Raum-Ersteller als Relay-Peer und Single Point of Failure bei Gruppen
- Protokolllimit von 128 Teilnehmern einschließlich Raum-Ersteller; die
  praktisch nutzbare Anzahl liegt abhängig von Gerät, Browser und Bildvolumen
  meist deutlich darunter
