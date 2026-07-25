# table-telephones

`table-telephones` is an installable PWA for local group chats with text and
images. It needs no chat backend and no signaling, STUN, or TURN server. After
one complete load over HTTPS, the app can be used without internet access.

## Features

- text and image chat for two or more participants
- direct WebRTC DataChannel connections on the same Wi-Fi network or smartphone
  hotspot
- shareable invitation link with an embedded connection code and raw-code
  fallback
- name prompt and direct acceptance after opening an invitation link
- answer code sharing through Web Share or the clipboard, with QR scanning as a
  fallback
- camera autofocus request, tap-to-refocus, and optional zoom and light controls
  where the device supports them
- installable, offline-capable PWA
- no accounts, database, advertising, tracking, or external resources
- no persistent storage of messages or images
- responsive, keyboard-accessible interface

## How connections work

1. Open the app on every device connected to the same Wi-Fi network or
   smartphone hotspot.
2. The room host enters a name, starts a chat, and shares the invitation link.
3. A participant opens the link, enters a name, and accepts the invitation.
4. The participant shares the generated answer code back. The host enters or
   scans it in the still-open app. The direct WebRTC connection then opens.
5. Repeat the process for every additional participant.

Invitation links and answer codes can be sent through the Web Share API or
copied to the clipboard. For transfer without internet access, select a local
share target such as Quick Share, AirDrop, or Bluetooth in the system share
sheet. Shared invitation text also contains the raw connection code as a
fallback. Invitations expire after 15 minutes.

QR codes use a high-resolution, module-aligned rendering. For reliable camera
scanning, keep the entire code visible, hold the devices about 20–40 cm apart,
and avoid reflections. Tap the camera preview to refocus. On supported devices,
the scanner also exposes zoom and light controls. Selecting a saved QR image
remains available as a fallback.

A shared Wi-Fi network does not transfer an invitation link by itself. Without
internet access, the second device can open the link only if the PWA is already
installed or was previously loaded completely and cached by the service worker.
Otherwise, both devices must load the app once with internet access.

The connection code is stored in the invitation URL fragment. The fragment is
not sent to the web server and is removed from the address bar after it is read.

In a group chat, the room host acts as the local relay peer. Every participant
connects directly to the host, which relays messages to the other participants.
The host device must therefore stay connected. There is no delayed delivery.

## Requirements

- a current browser with WebRTC DataChannel support
- a shared local network without client or AP isolation
- HTTPS for installation, service workers, camera access, and Web Share
- camera and local-network permission in the browser or operating system where
  required

Camera access and Web Share are optional. Clipboard input, QR images, and raw
connection codes provide fallbacks. Some corporate, guest, and public Wi-Fi
networks isolate connected devices. WebRTC cannot establish a direct connection
on such networks even when signaling succeeds.

## Development

Node.js 22.12 or later is required.

```bash
npm ci --ignore-scripts
npm run check
npm run dev
```

Create a production build:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

Serve the contents of `dist/` unchanged over HTTPS. Relative asset paths also
allow deployment below a subdirectory.

Security header examples are provided in:

- `public/_headers` for compatible static hosts
- `deploy/nginx.conf.example` for nginx
- `public/web.config` for IIS; it is copied into `dist/`

After the first successful load, the service worker caches the application
shell and serves subsequent requests from the cache. This allows the installed
app and invitation links to open later without internet access.

## Security and privacy

- WebRTC encrypts every peer connection with DTLS.
- Manual exchange of the invitation link and answer code replaces a centralized
  signaling server.
- In groups, encryption terminates at the room host because it relays messages
  to the other peer connections.
- Text is inserted into the DOM only as text.
- Images are re-encoded, limited to 3 MB, and checked on receipt using their
  file signature, MIME type, and actual dimensions.
- Connection data, protocol messages, names, text, images, and participant
  lists are validated and size-limited.
- The app makes no external connections and stores no chat history.
- A restrictive Content Security Policy and additional security headers are
  included.

See [SECURITY.md](SECURITY.md) for the trust model and known limitations.

## Tests

```bash
npm run check
npm run build
npm audit --audit-level=high
npm audit signatures
```

Automated tests cover signaling codecs, decompression limits, protocol
validation, XSS payloads, image signatures, and module-aligned QR rendering.
The interface, QR fallback, offline reload, and mobile layout should also be
checked in a browser.

Headless Chromium does not expose local ICE candidates in the test environment
used for this project. The actual Wi-Fi or hotspot connection must therefore be
verified with at least two physical devices.

## Technical limitations

- no connections across different networks because STUN and TURN are
  intentionally omitted
- no automatic device discovery; every connection still requires an invitation
  and an answer
- no chat history or delivery to disconnected participants
- room host is the relay peer and a single point of failure for groups
- protocol limit of 128 participants including the host; the practical number
  is usually much lower and depends on the device, browser, and image traffic
