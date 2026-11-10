# ORBIT Desktop

**Sound without borders.**

ORBIT is an independent Windows desktop application for discovering and listening to live radio, music previews, podcasts, audiobooks, and entertainment listings.

## Project status

- Desktop application: Electron-based Windows app.
- Current source version: 1.1.3.
- License: MIT (see `LICENSE`).
- Windows installer: unsigned at present. Windows SmartScreen may show a warning until a trusted code-signing certificate is configured and the signed releases establish reputation.

## Features

- Live radio discovery using the public Radio Browser directory.
- Station search, country filters, and locally saved favourites.
- Radio globe and station markers.
- Music and podcast discovery using public catalogue endpoints.
- Public-domain audiobook discovery through LibriVox.
- Film and entertainment discovery with provider previews and links.
- Local offline saving features supported by the app.

Availability and playback depend on the third-party broadcaster, catalogue, publisher, region, and their rights and technical restrictions. ORBIT does not provide a paid movie catalogue or guarantee that every stream is available.

## Requirements

- Windows 10 or later (64-bit recommended).
- Node.js 22.12 or later and npm for development/building.

## Run from source

```powershell
npm ci
npm start
```

## Build a Windows installer

```powershell
npm ci
npm run dist
```

The installer is written to `dist/`. Build output is intentionally excluded from this source repository. Release binaries should be attached to versioned GitHub Releases, not committed to the source tree.

## Security notes

The Electron renderer uses context isolation, disables Node integration, and enables sandboxing. The local application server is intended to bind only to loopback (`127.0.0.1`). Do not add API credentials, signing certificates, private keys, user data, or local build output to this repository.

Official releases should be built from tagged source, scanned before publication, and Authenticode-signed once the project has an approved trusted signing workflow. Until then, installers remain unsigned.

## Third-party services

ORBIT uses independent public services and catalogues, including Radio Browser, Apple/iTunes, LibriVox, public IPTV datasets, Globe.gl, and Google Fonts. These services are not owned or operated by ORBIT and may change or become unavailable. ORBIT is not affiliated with them.

## Maintainer

Nino Brown / ORBIT
