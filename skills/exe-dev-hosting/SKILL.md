---
name: exe-dev-hosting
description: Deploy and operate Luan's projects on exe.dev VMs, including private owner-only apps and selectively public apps such as Tidyfiles. Use when creating an exe.dev VM service, configuring a custom domain or Cloudflare CNAME, managing exe.dev proxy visibility, setting up owner identity, deploying a release, or debugging an exe.dev-hosted site.
---

# exe.dev hosting

Use `ssh -i ~/.ssh/id_exe` for VM access and preserve host-key verification. Never use `StrictHostKeyChecking=no`. exe.dev provides TLS, custom-domain certificates, and the trusted HTTP identity proxy; the app owns its own port (normally 8000) and systemd service.

## Decide visibility first

- Default to **private**: `ssh exe.dev share show <vm> --json`. Private proxy access requires exe.dev login and suits single-owner apps.
- Do **not** use `share set-public` just to make a custom hostname work. Public/private controls HTTP access; it is unrelated to DNS or certificates.
- Public is an explicit exception for a product with an intentional anonymous surface (for example, Tidyfiles published links). Validate private behavior first, then make only that VM proxy public and repeat anonymous/spoofed-header checks.

## Custom domain

1. Create a DNS-only CNAME: `<app>.luanv.me CNAME <vm>.exe.xyz`. In Cloudflare, use the gray cloud; orange-cloud hides the target from exe.dev.
2. Register it: `ssh exe.dev domain add <vm> <domain>`.
3. Check: `ssh exe.dev domain ls <vm> --json` and `curl -I https://<domain>/`.

A `421 Misdirected Request` means DNS may be correct but the domain has not been registered. exe.dev issues TLS automatically after registration.

Set the app's canonical origin and allowed host to the custom hostname before deployment. Do not accept a second browser hostname unless its Origin behavior is deliberately handled.

## Identity and configuration

- Trust only proxy-injected `X-ExeDev-UserID`; compare it exactly to `OWNER_USER_ID`. Never authorize by email or add an auth-bypass environment flag.
- Keep `/etc/<app>.env` root-owned and `0600`; never commit, print, or log the owner ID or tokens.
- The stable owner ID is shared across the owner's apps. If an existing app already has it, transfer it directly between protected VM config files rather than exposing it in output.
- Require the canonical Origin and `Sec-Fetch-Site: same-origin` for browser mutations. Do not add CORS headers.

## Release workflow

1. Read the project's operations docs and existing VM state. Confirm proxy visibility, target port, custom-domain registration, current service, and persistence requirements.
2. Run the pinned runtime's install, checks, tests, and build locally. Build artifacts, not source tooling, go to production.
3. Stage a timestamped release below `/opt/<app>/releases/<release>/`; copy compiled output, static assets, operations files, package metadata, and docs. Exclude `.git`, `.jj`, `node_modules`, test data, and environment files.
4. Install the pinned Node tarball with its official checksum manifest if needed. Put the service config in `/etc/<app>.env` before switching traffic.
5. Preflight built JS, required assets, and config **before** stopping the current service. Atomically repoint `/opt/<app>/current`, install/reload the hardened systemd unit, then restart.
6. Run localhost and proxy smoke checks. For stateful apps, verify restart persistence and do not delete data or old releases until the new release passes.

Use a dedicated unprivileged service user, `UMask=0077`, `NoNewPrivileges`, `PrivateTmp`, `PrivateDevices`, `ProtectSystem=strict`, `ProtectHome`, empty capabilities, restricted address families, restart-on-failure, and only the necessary writable paths.

## Verify and log safely

- Confirm the expected service user owns port 8000 and `systemctl is-active <app>.service` is active.
- From outside: anonymous private access redirects to exe.dev login; a forged `X-ExeDev-UserID` is stripped and does not authorize.
- For public apps: confirm anonymous behavior only for intended routes; private APIs still reject missing identity as designed.
- Use request IDs, route templates, status, and duration in logs. Never log identity values, credentials, tokens, bodies, filenames, IDs from raw paths, query strings, or uploaded bytes.

GitHub is source/history, not deployment automation unless the project explicitly adds it. Roll back code by atomically restoring the previous `current` symlink and restarting; do not roll back persistent state blindly.
