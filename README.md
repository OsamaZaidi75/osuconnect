# OsuConnect

**Your space. Your people. Your connection.**

OsuConnect is a private, self-hosted Discord-style platform: text channels, voice and video, and screen sharing with audio. It runs in any browser (including phones, with no install) or in a Windows desktop app that can share system audio.

Live instance: https://129-80-41-146.nip.io

## Features

- Communities with text and voice channels, threads, reactions, DMs and file sharing
- Voice, video and screen sharing with audio, powered by a LiveKit SFU
- Browser and phone (PWA) viewing, no install needed
- Windows desktop app (Electron) with system-audio capture for screen share
- Invite-only registration, roles and permissions, and an admin panel
- Frosted-glass dark theme by default, with selectable accent colours and light mode

> Note: DRM-protected video (Netflix and similar) shows as a black frame when screen-shared. That is a limit of the streaming service, not of OsuConnect.

## Deploy

The production stack for an Oracle Cloud Always Free ARM64 VM (Caddy for HTTPS, backend, frontend, LiveKit, Postgres, Redis) lives in [`deploy/oracle`](./deploy/oracle/README.md).

```bash
git clone https://github.com/OsamaZaidi75/osuconnect.git /opt/osuconnect
cd /opt/osuconnect/deploy/oracle
cp env.example .env.prod      # fill in the secrets
docker compose --env-file .env.prod up -d --build
```

Update an existing server:

```bash
cd /opt/osuconnect && git pull
cd deploy/oracle && docker compose --env-file .env.prod up -d --build
```

Required ports: 80/TCP, 443/TCP, 7881/TCP and 7882/UDP.

## Inviting people

Registration is invite-only. Open `/#/admin/invites`, create an invite, and send the link (`/#/join/<code>`) to your friend. It works in a phone browser.

## Development

Backend: NestJS, Prisma and PostgreSQL. Frontend: React and MUI. Both are in this repo (`backend/`, `frontend/`).

```bash
docker compose up -d          # dev stack with hot reload
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## Credits and license

OsuConnect is built on the open-source [Semaphore Chat](https://github.com/semaphore-chat/semaphore-chat) project and keeps its license: **AGPL v3** (see [LICENSE.md](./LICENSE.md)). Under the AGPL, anyone who uses a modified OsuConnect over a network is entitled to its source, which is this repository. The original project README is kept in [`docs/UPSTREAM_README.md`](./docs/UPSTREAM_README.md).
