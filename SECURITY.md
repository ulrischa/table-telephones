# Security

## Supported use

The app is intended for short-lived chats on a trusted local Wi-Fi network or
hotspot. It is not a replacement for a messenger with verified accounts, key
management, a persistent end-to-end encrypted history, or anonymous
communication.

## Trust boundaries

- Invitation links, QR codes, and pasted connection codes are untrusted input.
- Every DataChannel peer can send manipulated protocol messages.
- Selected and received images are untrusted input.
- In a group, the room host can see and relay every message.

## Security controls

- no backend, database, tracking, or external requests
- WebRTC DTLS transport encryption
- no ICE servers and therefore no internet relay connections
- strictly validated compressed signaling codes with a decompression limit
- invitation data stored only in the URL fragment, which is not sent to the web
  server and is removed from the address bar after being read
- size limits for text, control packets, images, and participant lists
- 16 KB image chunks with DataChannel backpressure
- raster images restricted to JPEG, PNG, and WebP; SVG is not accepted
- safe DOM rendering without `innerHTML`
- background notifications omit message text and image content
- restrictive CSP, Permissions Policy, and additional HTTP security headers
- no persistent message or image storage

## Known limitations

- Anyone who obtains a valid invitation link, QR code, or connection code can
  attempt to join before the invitation expires.
- Display names are not verified and can be impersonated.
- The room host is a trusted relay peer in group chats.
- Browser and image-decoder security updates are outside the app's control.
- The app cannot prevent radio interference or deliberate local-network
  congestion.
- When notifications are enabled, the operating system may show the sender name
  and whether an image was received on the lock screen. The exact presentation
  is controlled by browser and system notification settings.
- QR recognition depends on the physical camera, screen, lighting, reflections,
  browser support, and the distance between devices. Raw-code input and QR image
  selection remain available when a live camera scan is unreliable.

Report security issues with the browser, operating system, reproducible steps,
and no real chat content.
