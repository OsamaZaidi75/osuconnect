# OsuConnect on Oracle Cloud (ARM64)

Live: https://129-80-41-146.nip.io (hostname is configurable via `PUBLIC_DOMAIN`).

Layout on the server: repo at `/opt/osuconnect`, stack in `deploy/oracle`, secrets in `deploy/oracle/.env.prod` (git-ignored, mode 600).

## Public ports
| Port | Proto | Purpose |
|------|-------|---------|
| 80, 443 | TCP (+443 UDP) | Caddy, automatic HTTPS |
| 7881 | TCP | LiveKit ICE/TCP fallback |
| 7882 | UDP | LiveKit media |

PrivateWire (WireGuard 51820/UDP, enrollment 8443/TCP) is not touched by this stack.

## Operate
```bash
cd /opt/osuconnect/deploy/oracle
docker compose --env-file .env.prod ps
docker compose --env-file .env.prod logs -f backend
docker compose --env-file .env.prod stop            # stop
docker compose --env-file .env.prod up -d           # start
```

## Update (git sync)
```bash
cd /opt/osuconnect && git pull --ff-only
cd deploy/oracle && docker compose --env-file .env.prod up -d --build
```

## Backup
```bash
docker compose --env-file .env.prod exec -T postgres pg_dump -U semaphore semaphore | gzip > osuconnect-$(date +%F).sql.gz
docker run --rm -v osuconnect_uploads:/u -v "$PWD":/b busybox tar czf /b/uploads-$(date +%F).tgz -C /u .
```

## Rollback
`git checkout <previous-commit>` then re-run the update command. The previous
Zaidi Connect stack files and volumes remain in `/opt/zaidi-connect` and the
`zaidi-connect_*` Docker volumes until you delete them.

## Known limitations
- Replay/egress recording is not deployed (`livekit-egress` omitted); the backend logs a harmless reconciliation warning.
- No TURN server; media uses LiveKit's UDP 7882 / TCP 7881 directly.
- `nip.io` hostname is a stopgap; point a real domain at the VM and set `PUBLIC_DOMAIN`.
