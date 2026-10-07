# Yealink visual voicemail for NetSapiens

Give Yealink desk phones a visual voicemail menu backed by **NetSapiens API v2**. Users can browse New, Saved and Trash, view caller/date/duration, play messages, save/restore, delete and forward to another extension in the same domain.

The phone's mailbox comes from NetSapiens Endpoints provisioning tokens. You do not hardcode customer domains or extensions in the application code.

## How it works

```text
Yealink XML Browser -> HTTPS reverse proxy -> Node app -> NetSapiens API v2
Yealink audio player ---------------------------------> NetSapiens signed audio URL
```

The app generates XML screens and calls the voicemail API. **The phone downloads audio directly from NetSapiens.** The app does not stream recordings. Phones therefore need network access and trusted HTTPS certificates for both the app and the audio-serving core.

## Before you start

You need:

- A Linux host with Node.js 22 or newer, npm, and an HTTPS reverse proxy. This can be a separate server or an existing NetSapiens web host. Keep its existing portal/API configuration intact.
- A Yealink model/firmware supporting XML Browser and `Wav.Play`. The pilot used a **SIP-T57W, firmware 96.87.0.22**.
- NetSapiens **API v2 on platform major 45**. API v2 is the API generation; 45 is the platform major. Other majors are unverified and the included checker rejects them.
- A dedicated bearer API key with permission to read and manage voicemail in the intended domain. The pilot used domain-scoped **Office Manager** keys. Keep bearer keys on the server.
- Voicemail-enabled source/destination users with a **nonempty voicemail PIN**. On the tested v45 build, a mailbox without a PIN could receive/list messages while audio playback failed with HTTP 403.
- A public app hostname, phone-trusted certificate, and firewall/proxy rules permitting your phone networks or VPN.

## 1. Get the code

Commands below use Bash; Git Bash also works for local preparation on Windows.

```bash
git clone https://github.com/seancgill/ns-yealink-vv.git
cd ns-yealink-vv
npm ci
cp .env.example .env
npm run generate-key
```

Copy the generated key into `PHONE_ACCESS_TOKEN` in `.env`. It is a separate app access key, not your NetSapiens bearer token. Do not commit `.env`, generated phone URLs, or provisioning files containing keys.

## 2. Configure your environment

For a single-domain installation, edit `.env`:

```dotenv
NS_API_BASE_URL=https://core1.example.com/ns-api/v2
NS_API_TOKEN=YOUR_DOMAIN_SCOPED_API_KEY
PUBLIC_BASE_URL=https://voicemail.example.com
PHONE_ACCESS_TOKEN=YOUR_GENERATED_APP_KEY
MEDIA_PUBLIC_ORIGIN=
LISTEN_HOST=127.0.0.1
PORT=5000
API_TIMEOUT_MS=10000
DISPLAY_TIMEZONE=America/New_York
```

| Setting | What to enter |
| --- | --- |
| `NS_API_BASE_URL` | Reachable NetSapiens API origin ending in `/ns-api/v2`. Use a core that can consistently list, retrieve and serve the intended voicemail. |
| `NS_API_TOKEN` | Your dedicated bearer key. Never put it into a phone override. |
| `PUBLIC_BASE_URL` | Phone-facing app origin, including `https://`, with no path. |
| `PHONE_ACCESS_TOKEN` | Random key from `npm run generate-key`. Rotating it requires reprovisioning phones. |
| `MEDIA_PUBLIC_ORIGIN` | Leave blank normally. Only use when the API returns loopback audio URLs; then supply the public origin of the same audio-serving core. |
| `LISTEN_HOST`, `PORT` | Defaults keep Node on loopback port 5000 behind the reverse proxy. |
| `API_TIMEOUT_MS` | Upstream request timeout, default 10000 ms. |
| `DISPLAY_TIMEZONE` | IANA display timezone; UTC if unset. |

**Check cluster consistency:** during the pilot, one core listed a message while the other returned an empty mailbox. Using a load-balanced API hostname caused an intermittent 404 when selecting messages. Temporarily pointing the app at the core holding the voicemail avoided that error. The underlying file-replication SSH keys were then repaired, new messages replicated successfully, and load-balanced API access was restored. Verify replication before rollout; core pinning alone does not provide failover.

### Multiple domains

Instead of one API key, use a JSON map of domains to their scoped keys:

```dotenv
NS_API_TOKEN=
NS_API_TOKENS_BY_DOMAIN='{"tenant-a.example":"TENANT_A_KEY","tenant-b.example":"TENANT_B_KEY"}'
```

The phone still supplies its extension/domain dynamically. In map mode, unlisted domains are denied and there is no fallback to `NS_API_TOKEN`. Each key must authorize its mapped domain.

The app access key is shared across the instance and **does not bind a handset to one mailbox**. Someone with that key can request other mailboxes permitted by the configured API keys. Restrict access to trusted networks; use separate app instances and scoped keys where tenant isolation is required.

## 3. Check the API and start locally

```bash
npm test
npm run check-api
npm run check-api -- 1000 tenant-a.example
npm start
```

Replace the example extension/domain with an authorized pilot mailbox. `check-api` verifies the platform major and, with mailbox arguments, reads folders and a message detail from each nonempty folder. It does not change messages, download audio, or prove phone playback.

In another shell:

```bash
curl --fail http://127.0.0.1:5000/healthz
```

Expected response: `{"status":"ok"}`. This checks the app only, not the API or handset.

## 4. Install the Linux service and HTTPS proxy

Follow [the Linux deployment guide](docs/DEPLOYMENT.md). It covers installation under `/opt/ns-yealink-vv`, a dedicated service account, private `/etc/yealink-vv.env`, and systemd startup.

Use the supplied examples for your web server:

- [systemd service](deploy/yealink-vv.service): check its Node executable path.
- [Apache proxy](deploy/apache-location.conf): integrate into the existing HTTPS virtual host.
- [Nginx proxy](deploy/nginx-location.conf): integrate into an HTTPS server block.

Proxy **both `/v` and `/yealink_vv` plus its action paths** to Node. `/v` is the short entry URL; subsequent screens use `/yealink_vv/...`. Replace the example allowed subnet with your actual phone networks. Configure every applicable access log to omit/redact these requests because query strings contain the app key. Test web-server configuration before reloading and confirm the existing portal/API still works.

For a systemd installation, `/etc/yealink-vv.env` is the active configuration. Edit that file for service changes, rather than assuming the checkout's `.env` controls the running service. For CLI setup/check commands, use a private `.env` with matching settings.

## 5. Add the Yealink XML Browser key in Endpoints

With `.env` configured, run:

```bash
npm run phone-url
```

This prints a **private** compact URL with the derived 32-character app key. Copy it into an XML Browser key override, keeping the mailbox tokens intact. Example for T57W idle softkey 1:

```text
programablekey.1.type="27"
programablekey.1.value="https://voicemail.example.com/v?u=[[user_1]]&d=[[domain]]&k=COMPACT_APP_KEY"
programablekey.1.label="Voicemail"
```

Replace the example URL with the output of `phone-url`. Yealink spells this parameter **`programablekey`**. Softkey 1 normally replaces History; choose the key you intend to replace and preserve existing overrides. For an available line key on supported models, use `linekey.N.type`, `.value` and `.label` with the same compact URL and type `27`.

In NetSapiens Endpoints, add the quoted overrides at the appropriate device/model/domain scope. `[[user_1]]` expands to the line-one **owner user**, and `[[domain]]` to the customer domain. Do not use `[[device_1]]` as the mailbox: its device/auth AOR may include a suffix such as `1500a`.

Before resyncing the pilot phone:

1. Inspect its authenticated generated `/cfg/<mac>.cfg` locally. Confirm the intended owner/domain and no unresolved `[[...]]` tokens; keep credentials private.
2. Measure the expanded key URL. Yealink documents a **99-character value limit**; long hostnames/domain names can still exceed it even with `/v`.
3. Confirm any existing firmware override points to the version you intend to deploy.
4. Resync the pilot, open Voicemail, and select a folder/message.

See [provisioning details and custom tokens](docs/PROVISIONING.md) for alternative configurations.

## 6. Verify before rolling out

Use disposable messages and a destination user with a voicemail PIN. Check on a real phone:

- Folders, caller details, Back, Play and Stop.
- Save moves to Saved; Delete moves to Trash; Restore moves to Saved.
- Forward prompts for an extension and the destination can **play** the forwarded message.
- Delete from Trash is permanent; test only with a disposable recording.

The T57W pilot was reported working by the operator after the API-core and destination-PIN issues were diagnosed. This is one deployment, not certification for every model/build. [Compatibility notes](docs/COMPATIBILITY.md) distinguish automated checks and operator validation.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| XML app will not open / 403 | Proxy network allowlist, resolved provisioning tokens, app key, HTTPS certificate and both proxy routes. |
| Invalid request / 400 | Owner/domain tokens, folder/filename and numeric forwarding extension. |
| List works but selecting a message fails / 404 | Whether different cores return different mailbox contents; whether the message was moved/deleted since the list opened. Reopen the folder. |
| API error / 502 | API base URL, bearer key, domain scope, connectivity and response shape. Failed API reads show an error instead of being silently treated as empty. |
| Message appears but audio returns 403 | **Set/check the mailbox's voicemail PIN**, then reopen the message for a fresh signed URL. Also check URL expiration. |
| Audio fails despite a valid URL | Phone-to-media-core connectivity, TLS trust, redirects and supported WAV format. App reachability alone does not prove audio reachability. |
| Empty folder | Intended mailbox owner, core consistency, folder and actual mailbox contents. |

The app logs sanitized status codes to stdout; use `journalctl -u yealink-vv` for the Linux service. Do not paste signed audio URLs, bearer tokens or phone configuration credentials into public issues. Older versions logged Authorization headers in `logs/app.log`; secure old logs and rotate exposed tokens when upgrading.

Phone actions follow GET links because of the XML Browser interface. Do not crawl or prefetch action URLs. The app does not automatically retry mutations.
