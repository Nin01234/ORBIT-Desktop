# ORBIT Desktop

**Sound without borders.**

ORBIT is an independent Windows desktop application for discovering and listening to live radio, music previews, podcasts, audiobooks, and entertainment listings.

## Project status

- Desktop application: Electron-based Windows app.
- Current source version: 1.1.4.
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

## Policies

- [Code signing policy](CODE_SIGNING_POLICY.md)
- [Privacy notice](PRIVACY.md)



## YouTube video downloads (desktop)

The Music Video cards include a Download action for videos the user owns or is otherwise authorized to download. Downloads are handled by the Electron main process and saved in ORBIT's existing offline library. FFmpeg is supplied through the `ffmpeg-static` dependency and is used by yt-dlp to merge separate audio/video streams when needed.

**yt-dlp is an external prerequisite** and must be installed on the computer and available on `PATH` (or exposed through the `yt-dlp` command). On Windows, install it from the official yt-dlp release page, then restart ORBIT. If yt-dlp is missing, ORBIT displays an installation error instead of silently failing.

The feature validates YouTube URLs, restricts downloads to one video at a time, enforces a 500 MB limit and a 30-minute timeout, and writes completed videos into Downloads. It does not bypass DRM, private-video access, paywalls, or other access controls. Users must have the rights holder's permission to download the selected video.

Run `npm install` after pulling this branch so the new FFmpeg dependency is installed, then run `npm test`.
