# Using WAHA (unofficial) instead of the Meta Cloud API

For testing only. WAHA is not endorsed by WhatsApp; the number can be banned,
especially with mass sends. Switch back to the official API for production.

## How it works

Setting `WAHA_URL` turns on "WAHA mode":

- Outbound: the helpers in `src/lib/whatsapp/meta-api.ts` send through WAHA
  (`src/lib/whatsapp/waha.ts`) instead of `graph.facebook.com`.
- Inbound: WAHA calls `/api/whatsapp/waha-webhook`, which converts events to the
  Meta webhook shape and feeds the regular webhook handler. Inbox, contacts,
  automations, flows and AI replies work unchanged.

Remove `WAHA_URL` to go back to the official API.

## Environment variables

| Variable | Description |
| --- | --- |
| `WAHA_URL` | WAHA base URL, e.g. `https://waha.example.com` |
| `WAHA_API_KEY` | Sent as `X-Api-Key` (leave empty if WAHA has no key) |
| `WAHA_SESSION` | Session name (default `default`) |
| `WAHA_WEBHOOK_SECRET` | Shared secret WAHA must send in the webhook URL |
| `WAHA_INTERACTIVE_MODE` | How buttons/lists are sent: `poll` (default), `buttons` or `text` |
| `META_APP_SECRET` | Required by the shared handler; any non-empty value works in WAHA mode |

Also required as before: Supabase vars and the encryption key.

## Setup

1. Start and pair a WAHA session (scan the QR) until its status is `WORKING`.
2. Configure the WAHA session webhook. There is **no `/webhooks` endpoint** on
   the builds we run (`GET /api/sessions/{session}/webhooks` is 404,
   `GET /api/sessions/webhooks` is 403, `GET /api/webhooks` is 404) — the only
   supported path is updating the session config, which is what the script does:

   ```bash
   # show the session status and the webhook list it currently has
   node scripts/waha-webhook.mjs --base https://<your-crm> --status

   # preview the payload without touching WAHA
   node scripts/waha-webhook.mjs --base https://<your-crm> --register --dry-run

   # apply it
   node scripts/waha-webhook.mjs --base https://<your-crm> --register
   ```

   The script `PUT`s `/api/sessions/{session}` with the whole `config`, setting:

   - URL: `https://<your-crm>/api/whatsapp/waha-webhook?token=<WAHA_WEBHOOK_SECRET>`
   - Events: `message`, `message.ack`, `message.reaction`, `poll.vote`

   Things worth knowing before you run it:

   - **It replaces the session's webhook list by default** — the CRM becomes the
     only receiver. Pass `--append` to keep whatever else is configured.
   - The previous list is always written to `.waha-webhooks.backup-<timestamp>.json`
     (git-ignored, mode `600`) so the change can be reverted with one more `PUT`.
   - Re-running the command is safe: it drops any earlier entry pointing at the
     same URL instead of duplicating it.
   - `PUT /api/sessions/{session}` stops, re-upserts and restarts the session, so
     it briefly leaves `WORKING`. Credentials persist on disk and it reconnects by
     itself; the script polls the status and only reports success once it is back
     to `WORKING`. If it lands on `SCAN_QR_CODE`/`FAILED`, pair the number again in
     the dashboard — the webhook is already saved either way.
   - The token is masked in every line the script prints. `--reveal` shows the full
     URL (it contains `WAHA_WEBHOOK_SECRET`), `--write` saves it to
     `.waha-webhook-url.txt` (git-ignored).

3. In the CRM, go to Settings → WhatsApp and fill in:
   - **Phone number ID**: the paired number, digits only with country code
     (e.g. `5511999999999`). It must match the number WAHA reports in `me.id`.
   - **Access token**: any text (e.g. `waha`); it is not used.
   - **WABA ID**, **PIN**: leave empty.
4. Click Save, then Test connection (it checks that the WAHA session is `WORKING`).

`WAHA_WEBHOOK_SECRET` must be the same value in the CRM's environment and in the
webhook URL registered with WAHA — the route compares them with a timing-safe
`crypto.timingSafeEqual` and answers 401 otherwise. The route sits behind the
session-cookie middleware, but `/api/whatsapp/waha-webhook` is explicitly
exempted there (`PUBLIC_WEBHOOK_PATHS` in `src/middleware.ts`); a new
self-authenticating webhook route has to be added to that list.


## Deploying behind a Cloudflare Tunnel

The reference deployment runs the CRM on a homelab behind NAT while WAHA lives
on a public VPS. WAHA has to reach the webhook, and the homelab has no public
IP, so a Cloudflare Tunnel carries the traffic. No port forwarding, no certbot:
Cloudflare terminates TLS and speaks plain HTTP to the container.

```
WAHA (VPS)  --POST-->  https://crm.example.com  -->  Cloudflare edge
                                                      |
                                              tunnel (cloudflared)
                                                      |
                                            http://127.0.0.1:3100 (homelab)
```

Steps:

1. In Cloudflare Zero Trust → Networks → Tunnels, create a **remotely-managed**
   tunnel and add a **Public Hostname**: subdomain → zone, service type `HTTP`,
   URL `127.0.0.1:<HOST_PORT>`. Use `http://`, not `https://` — the origin is
   plain HTTP. Creating the public hostname is also what creates the DNS record.
2. Run the connector on the homelab. `--network host` is required, otherwise
   `127.0.0.1` inside the container is the container itself and every request
   returns 502:

   ```bash
   docker run -d --name cloudflared-wacrm \
     --network host --restart unless-stopped --memory 128m \
     -e TUNNEL_TOKEN="$(cat ~/.cloudflared/token)" \
     cloudflare/cloudflared:latest tunnel --no-autoupdate run
   ```

   Keep the token in a file with mode `600` and pass it through `TUNNEL_TOKEN`.
   `--token` on the command line leaks it into shell history and `ps`.
3. Run the CRM with `HOST_BIND=127.0.0.1` and a `HOST_PORT` the host does not
   already use (see `docs/docker.md`).
4. Do **not** put a Cloudflare Access policy on the hostname unless you also add
   a bypass for `/api/whatsapp/*`. WAHA delivers the webhook as a server-to-server
   POST with no browser, so an Access policy answers with a login redirect and
   the events never arrive.

Verify, in this order — each one isolates a different layer:

```bash
curl -o /dev/null -w '%{http_code}\n' https://crm.example.com/login
# 200 -> tunnel + container are fine

curl -X POST https://crm.example.com/api/whatsapp/waha-webhook -d '{}'
# 401 -> middleware exempts the route and the token check is doing its job

curl -X POST "https://crm.example.com/api/whatsapp/waha-webhook?token=$WAHA_WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' -d 'not-json'
# 400 -> the request reached the handler
```

A `530` from Cloudflare means the tunnel has no connector running; `502` means the
connector is up but the origin URL/port is wrong.

## Behavior differences

- Templates are not required: template sends and broadcasts go out as plain text
  rendered from the local template body. Creating or syncing templates still
  calls Meta and will not work.
- Buttons and lists (Flows `send_buttons` / `send_list`) are sent according to
  `WAHA_INTERACTIVE_MODE`:
  - `poll` (default): a WhatsApp poll; the customer's vote advances the flow.
    Works on every engine. Needs the `poll.vote` webhook event.
  - `buttons`: native `/api/sendButtons` and `/api/sendList`. WAHA marks them as
    unreliable; if the server rejects the call the CRM falls back to text.
  - `text`: numbered menu; the customer answers `1`, `2` or the option name.
  In every mode a typed answer ("2", "Sim") to the last prompt also advances the
  flow. A number is only interpreted that way when the latest message in the
  conversation is our prompt.
- No 24h-window restriction, no quality rating or messaging limits.
- Group chats, status and channel messages are ignored. Messages you send from
  the phone itself are ignored.
- Contacts that WAHA identifies only by `@lid` are resolved to a phone number
  through WAHA; if that is not possible the message is skipped (see server logs).
