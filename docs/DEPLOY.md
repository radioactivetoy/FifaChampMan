# Running ChampMan on a NAS with Docker + Cloudflare Tunnel

ChampMan has **no login of its own**, so it should never be exposed directly. The compose file runs it next to a
`cloudflared` container; the only way in from the internet is the tunnel, and a Cloudflare Access policy decides who may open it.

## 1. Create the tunnel (once, in the Cloudflare dashboard)
1. Zero Trust → **Networks → Tunnels → Create a tunnel** → *Cloudflared*, name it `champman`.
2. Copy the **token** (the long string after `--token` / `TUNNEL_TOKEN=`).
3. **Public hostname**: e.g. `champman.example.com` → Service **HTTP** → URL `champman:3210`
   (the compose service name; both containers share the compose network).
4. Zero Trust → **Access → Applications → Add → Self-hosted**: the same hostname, and a policy such as
   *Allow → Emails: the friends' addresses* (one-time PIN by email) or a Google/GitHub login. Without a policy the app is public.

## 2. Start it on the NAS
```bash
git clone <this repo> champman && cd champman
cp .env.example .env        # paste TUNNEL_TOKEN, set TZ
docker compose up -d --build
docker compose logs -f
```
Open `https://champman.example.com` — Cloudflare Access asks who you are first.

## Data and backups
- Everything lives in the `champman-data` volume: `champman.db` and `backups/` (the app copies the database there on every start and every `BACKUP_EVERY_HOURS` (default 24), newest 14 kept; Config lists them with download and restore).
  To keep it in a NAS folder, use the bind-mount line in `docker-compose.yml` instead (the folder must be writable by uid 1000, the `node` user).
- *Config → Download backup* still works through the tunnel.
- **Moving your existing data:** stop the app, then copy your local `champman.db` into the volume, e.g.
  `docker compose cp champman.db champman:/data/champman.db` (start the stack once first so the volume exists; the app makes a backup at each start).

## Updating
```bash
git pull && docker compose up -d --build
```
The database migrates itself on start (and a backup is taken first).

## Notes
- Team CSV import and template tools: `docker compose exec champman node tools/create-copa-del-rey-template.mjs "FC 27" /data/champman.db`.
- LAN access without the tunnel is off by default; see the commented `ports:` block (and remember that route skips Cloudflare Access).
- Cloudflare terminates TLS, so the app itself stays plain HTTP inside the compose network.
