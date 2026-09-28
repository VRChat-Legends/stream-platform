# VRChat Legends Stream Platform

An OBS-compatible streaming platform with a public viewer, private studio, persistent fallback video, live chat and Discord status reporting.

Live pages: [watch](https://watch.vrchatlegends.com), [studio](https://studio.vrchatlegends.com). The separate AI application is [Mochi](https://github.com/VRChat-Legends/mochi).

## Features

- RTMP ingest with rotatable stream keys and a continuous FFmpeg program.
- HLS, fragmented MP4 and MPEG-TS playback, plus RTSP and iframe URLs.
- A fallback video or slate keeps the output active when OBS disconnects.
- A responsive viewer and authenticated studio with upload, branding and diagnostics controls.
- Live chat using VRChat Legends OAuth, moderation tools and a transparent OBS overlay.
- Optional Discord bot for stream status and activity summaries.

## Set up

Use Docker Engine with Compose, Python 3, and public DNS names pointing to your host. The application requires HTTPS for authentication.

```sh
python3 deploy/setup-env.py
# Edit .env locally. Set hostnames, OAuth credentials and an optional Discord bot token.
docker compose build
docker compose up -d
```

The setup script generates a unique administrator password, internal token and encryption key. Read the administrator password from your local `.env`. Keep that file private.

Register `https://<WATCH_HOST>/auth/callback` with your VRChat Legends OAuth application. The client ID and secret stay on the server. OAuth documentation: https://vrchatlegends.com/docs/oauth.

Choose one HTTPS proxy arrangement:

1. Existing Nginx: adapt `deploy/nginx.conf` for your hostnames, install the site, issue TLS certificates and reload Nginx. The backend listens on host loopback port 18080 and HLS on 18888.
2. Dedicated host with free ports 80 and 443: edit the hostnames in `Caddyfile`, then run `docker compose -f compose.yml -f compose.caddy.yml up -d --build`. Caddy obtains TLS certificates.

Allow inbound TCP 1935 for RTMP and TCP 8554 if RTSP is needed. Do not expose internal Docker APIs or the backend's internal port.

## Broadcast and play

In Studio, copy the ingest address and stream key into OBS. Suggested OBS video settings are H.264, 1080p30, 4,000 to 6,000 kbps, with a two-second keyframe interval. Use AAC stereo audio at 48 kHz.

For the configured stream host:

- HLS: `/live.m3u8` or `/live/index.m3u8`
- Fragmented MP4: `/live.mp4`
- MPEG-TS: `/live.ts`
- Viewer embed: `https://<WATCH_HOST>/embed`
- OBS chat browser source: `https://<WATCH_HOST>/chat/overlay`

See [feature details](docs/features.md) for chat endpoints, OAuth and Discord setup. Upload your own fallback media and artwork through Studio.

## Development and checks

Node.js 22 is used in the Docker build.

```sh
npm ci
node scripts/check-public.mjs
npm run check
npm run build
```

`tests/continuity.py` is an integration test that publishes a temporary feed. Run it only in a disposable test deployment with the configured environment, never during a real broadcast.

## Data and updates

The `data` Docker volume contains private configuration, sessions, chat data and uploads. Back it up privately. Preserve both that volume and `.env` during updates; do not run `docker compose down -v` to update the application.

This repository contains application source and example configuration. Runtime data, user uploads, passwords, tokens, database backups and private deployment records are excluded. Dependency licenses remain with their respective projects.
