# Linux deployment

Use Node.js 22 or newer on a supported release. Keep the app unprivileged and behind the existing HTTPS web server. Examples use `/opt/ns-yealink-vv` and a dedicated `yealink-vv` account. Adapt paths to the operator's standards.

These Bash commands change the chosen host. Review them and obtain host-specific authorization before running them on somebody else's system.

## Install

Upload/clone the application into `/opt/ns-yealink-vv`. Run `npm ci --omit=dev` there as the deployment owner. Do not copy `node_modules`, old logs, or your local `.env` from Windows.

Create a system account if it does not exist:

```bash
sudo useradd --system --home /opt/ns-yealink-vv --shell /usr/sbin/nologin yealink-vv
sudo install -o root -g yealink-vv -m 0640 /opt/ns-yealink-vv/.env.example /etc/yealink-vv.env
```

Edit `/etc/yealink-vv.env` with the real URLs and private keys. Use raw `NAME=value` assignments compatible with systemd's EnvironmentFile; do not use shell substitutions. The service account needs read access to the source and installed dependencies, not write access.

Choose an API core/origin that consistently serves the pilot mailbox. A load-balanced hostname is suitable only after verifying voicemail consistency across its cores. The pilot temporarily pinned one core while file replication was broken, then restored its load-balanced API hostname after repairing replication and verifying fresh-message access on both cores. Set `PUBLIC_BASE_URL` to the actual host chosen to serve this app. Leave `MEDIA_PUBLIC_ORIGIN` empty unless a read proves loopback URLs; then use the same media core's public origin.

## systemd

Copy `deploy/yealink-vv.service` to `/etc/systemd/system/yealink-vv.service`. Verify the Node executable path with `command -v node`; change ExecStart if it is not `/usr/bin/node`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now yealink-vv
sudo systemctl status yealink-vv --no-pager
curl --fail http://127.0.0.1:5000/healthz
```

Use `journalctl -u yealink-vv` for sanitized app logs. Service shutdown drains in-flight requests for up to 15 seconds.

## Existing Apache host

Many NetSapiens cores already run Apache. Integrate `deploy/apache-location.conf` into the chosen HTTPS virtual host after backing it up; do not install a competing web server on ports 80/443. Confirm proxy/proxy_http modules are available.

The example proxies `/v` plus `/yealink_vv` and descendants. Both are required for compact entry URLs and subsequent navigation. Access-log suppression requires editing the virtual host's existing CustomLog to honor `env=!yealink_vv`; adding a second log directive will not suppress the original log. Also check global logs.

Run the host's Apache config test before a reload. Confirm the existing portal/API still responds after integration. Restrict this location to the trusted phone networks or VPN.

## Nginx alternative

Use `deploy/nginx-location.conf` inside an existing HTTPS server block, or a separate app host with its own DNS and certificate. Replace its example subnet with the real phone network. `access_log off` prevents the app key from entering this location's access log; audit other proxy/load-balancer logs independently.

Test configuration before reloading. Node should continue listening on loopback.

## Pilot and rollback

Before rollout, record the existing web-server config, service state, app version, phone overrides and mailbox folder counts. Test folder reads and direct media download from the actual phone network first.

For write tests, create disposable source messages and identify a disposable destination mailbox. Save should move the source to Saved; normal Delete should move it to Trash; Restore should move it to Saved; Forward should deliver to the destination. Verify exact live behavior. Delete-from-Trash cannot be undone; test it only with an explicitly disposable message.

Rollback: restore the previous phone key/overrides and web-server config, stop/disable the new service, restore the previous app release if replacing one, and reload only after a successful web config test. Keep credentials outside release directories. Retain evidence of write tests and remove test artifacts only with authorization.
