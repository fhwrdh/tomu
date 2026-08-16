# Self-hosting Tomu

A reproducible guide to running your own Tomu instance on a single Linux server
(Debian/Ubuntu shown). Everything runs on one box; the only external dependency is a
private git repo for backups (optional but recommended).

Replace `tomu.example.com` with your domain and `deploy` with your server user
throughout. Run privileged steps with `sudo`; run the app as an unprivileged user.

## 0. Prerequisites

- A server with a public IP and a domain's A record pointing at it.
- **PostgreSQL 16**, **Node 20+** (22 LTS recommended), **nginx**, **certbot**, **pm2**
  (`npm i -g pm2`), and **git**.
- Comfortable ~1GB RAM for Tomu alone; add swap on tiny boxes.

## 1. Database

```bash
sudo -u postgres psql <<SQL
CREATE ROLE filmlog LOGIN PASSWORD 'a-strong-password';
CREATE DATABASE filmlog OWNER filmlog;
SQL
```

Postgres defaults to `listen_addresses = localhost` — keep it that way; nginx and the
app reach it over loopback only.

## 2. Get the code and build

```bash
git clone <your-fork-url> ~/filmlog && cd ~/filmlog
npm install
npm run build          # shared -> server -> client -> mcp
```

If the build errors with `Cannot find module '@tomu/shared'`, clear stale
incremental-build state and rebuild:

```bash
find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
npm run build
```

## 3. Load your data

Fresh install — create the schema:

```bash
DATABASE_URL='postgres://filmlog:...@localhost:5432/filmlog' \
  npm run -w packages/server db:push
```

Migrating an existing instance — restore a dump (see [../RESTORE.md](../RESTORE.md)):

```bash
gunzip -c latest.sql.gz | psql 'postgres://filmlog:...@localhost:5432/filmlog'
```

## 4. Secrets and environment

Copy `.env.example` to `.env` and fill it in. Generate strong values:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # TOMU_MCP_TOKEN
openssl rand -hex 16   # TOMU_MCP_PATH_SECRET
```

Set `HOST=127.0.0.1`, `NODE_ENV=production`, `CORS_ORIGIN=https://tomu.example.com`,
and the `DATABASE_URL` from step 1. `chmod 600 .env`.

### Minting `TOMU_API_TOKEN`

The MCP server calls the API as *you*, using a JWT signed with `JWT_SECRET` whose
`sub` is your user id. Find your user id, then mint a token (HS256, no expiry — matches
the server's `@fastify/jwt` setup):

```bash
# your user id
psql "$DATABASE_URL" -tAc "select id, email from users;"

# mint (paste the id as U, your JWT_SECRET as S)
S='<JWT_SECRET>' U='<your-user-id>' node -e '
  const c=require("crypto");
  const b64=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const d=b64({alg:"HS256",typ:"JWT"})+"."+b64({sub:process.env.U});
  process.stdout.write(d+"."+c.createHmac("sha256",process.env.S).update(d).digest("base64url")+"\n");'
```

Put the result in `.env` as `TOMU_API_TOKEN`.

## 5. Run under pm2

The repo ships `ecosystem.config.cjs` (portable; reads `.env` via `--env-file`):

```bash
pm2 start ecosystem.config.cjs     # tomu-api :3456, tomu-mcp :3457 (both loopback)
pm2 save
sudo env PATH=$PATH pm2 startup systemd -u deploy --hp /home/deploy   # boot persistence
```

## 6. nginx + TLS

Serve the client build and proxy the two services. A ready-to-use source config is
tracked at [`deploy/nginx/tomu.conf`](../deploy/nginx/tomu.conf) (and the rate-limit
zone at `deploy/nginx/tomu-ratelimit.conf`). Minimal server block:

```nginx
server {
    server_name tomu.example.com;
    root /home/deploy/tomu/packages/client/dist;
    index index.html;

    location /api/ { proxy_pass http://127.0.0.1:3456; proxy_set_header Host $host; }

    # MCP (SSE streaming). The MCP server enforces its own auth.
    location ~ ^/([A-Za-z0-9]+/)?mcp/?$ {
        proxy_pass http://127.0.0.1:3457;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # Return a clean 404 for OAuth discovery so remote MCP clients (e.g. the
    # claude.ai connector) treat this as a no-OAuth server and connect via the
    # path secret. Without it, the SPA catch-all below returns 200 HTML here and
    # the connector's OAuth registration fails. (Until Tomu implements OAuth.)
    location ^~ /.well-known/oauth { return 404; }

    location / { try_files $uri $uri/ /index.html; }
}
```

Enable it, then get a certificate (adds 443 + HTTP→HTTPS redirect):

```bash
sudo ln -s /etc/nginx/sites-available/tomu.example.com /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tomu.example.com --redirect -m you@example.com --agree-tos -n
```

## 7. Harden (single-user instance)

Registration is public by default. On a personal instance, create your account once,
then block signups and throttle login at the edge:

```nginx
# in the server block:
location = /api/v1/auth/register { return 404; }
location = /api/v1/auth/login {
    limit_req zone=tomu_auth burst=5 nodelay;
    proxy_pass http://127.0.0.1:3456;
    proxy_set_header Host $host;
}
```

```nginx
# in http{} (e.g. /etc/nginx/conf.d/tomu-ratelimit.conf):
limit_req_zone $binary_remote_addr zone=tomu_auth:10m rate=5r/m;
```

Also run a firewall allowing only 22/80/443 (`ufw allow OpenSSH,80,443`) — Postgres and
both Node services are loopback-only.

## 8. Connect Claude

Add the MCP endpoint as a custom connector, by URL, in any Claude client:

```
https://tomu.example.com/<TOMU_MCP_PATH_SECRET>/mcp
```

The path secret authenticates it; treat the URL like a password. (Bearer-token auth via
`TOMU_MCP_TOKEN` also works if your client sends `Authorization: Bearer …`.)

## 9. Backups

Set up the nightly dump→git-push per [../RESTORE.md](../RESTORE.md). With that in place,
losing the box costs at most a day, and rebuilding is steps 1–6 again.

## 10. Updating

From your workstation, after setting `.deploy.env`:

```bash
npm run deploy            # rsync -> build -> pm2 reload
npm run deploy:migrate    # same, plus a schema push
```
