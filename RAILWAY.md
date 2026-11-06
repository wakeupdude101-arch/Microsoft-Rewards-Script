# Railway deployment

This guide deploys the official `v5` Docker setup without a desktop or visible
browser. The current project root inside the image is `/app`.

## 1. Prerequisites

- A Railway account and project.
- The GitHub repository connected to Railway, using branch `v5`.
- A Railway persistent volume.
- Microsoft account details and completed initial sign-in sessions.
- Railway CLI is optional, but useful for logs and shell access.

Do not commit `.env`, `config.json`, `sessions/`, `diagnostics/`, cookies,
tokens, passwords, or TOTP secrets.

## 2. Deploy

1. Create a new Railway service from
   `https://github.com/TheNetsky/Microsoft-Rewards-Script`.
2. Select branch `v5`.
3. Railway detects the repository `Dockerfile`; do not replace it with a
   Browserless or Selenium service.
4. Add the environment variables below.
5. Add the persistent volume described in section 5.
6. Deploy and inspect the first startup logs.

The image installs the lockfile-matched Patchright Chromium browser and its
system dependencies during the image build. `FORCE_HEADLESS=1` is set in the
image, so both `CONFIG_REWARDS_MODE=browser` and `CONFIG_REWARDS_MODE=api`
run without `DISPLAY` or `WAYLAND_DISPLAY`.

## 3. Environment variables

### Required

Provide at least one numbered account:

```dotenv
ACCOUNT_1_EMAIL=account@example.com
```

Add `ACCOUNT_N_EMAIL` for each additional account. Passwords are optional:

```dotenv
ACCOUNT_1_PASSWORD=...
ACCOUNT_1_TOTP_SECRET=...
ACCOUNT_1_RECOVERY_EMAIL=...
```

Use Railway's secret variables for passwords, TOTP secrets, proxy passwords,
and notification tokens. Never print or paste their values into source files.

### Scheduler

```dotenv
TZ=Asia/Kathmandu
CRON_SCHEDULE=0 7 * * *
RUN_ON_START=false
SKIP_RANDOM_SLEEP=false
MIN_SLEEP_MINUTES=5
MAX_SLEEP_MINUTES=50
STUCK_PROCESS_TIMEOUT_HOURS=8
```

`CRON_SCHEDULE` uses standard five-field cron syntax and is evaluated in `TZ`.
`RUN_ON_START=true` performs one immediate run after startup. The scheduler
and immediate run use `/tmp/run_daily.lock`, so an overlapping run exits
instead of starting a second automation process.

### Runtime and rewards mode

```dotenv
CONFIG_REWARDS_MODE=browser
CONFIG_HEADLESS=true
CONFIG_AUTO_SYNC=true
```

Use `browser` to execute rendered web activities or `api` for the supported
HTTP task transport. `FORCE_HEADLESS=1` is supplied by the Dockerfile and
should not be disabled on Railway.

All other `CONFIG_*`, `ACCOUNT_N_*`, proxy, and notification variables are
listed in [env.example](env.example), [config.example.json](config.example.json),
and the upstream [usage guide](docs/usage.md). Only set variables needed by
your accounts and enabled features.

### Control API and Discord control bot

The API is not required for scheduled execution. If enabled:

```dotenv
API_MODE=true
API_HOST=0.0.0.0
API_PORT=3010
API_TOKEN=<long-random-secret>
```

The Discord bot runs in the same Railway service and uses the private local
Control API; no public API port is required for bot commands. Add:

```dotenv
DISCORD_BOT_TOKEN=<Discord bot token>
DISCORD_APPLICATION_ID=<Discord application ID>
DISCORD_GUILD_ID=<private Discord server ID>
DISCORD_ALLOWED_USER_IDS=<comma-separated Discord user IDs>
API_ALLOW_SCHEDULE_WRITE=true
```

Invite the application with this URL after replacing the placeholders:

```text
https://discord.com/oauth2/authorize?client_id=DISCORD_APPLICATION_ID&scope=bot%20applications.commands&permissions=0
```

The application must be invited to the same server whose ID is in
`DISCORD_GUILD_ID`. If logs say `Missing Access`, the bot is not in that
server, the application ID is wrong, or it was invited without the
`applications.commands` scope. The bot now reports this clearly and retries
registration instead of crashing the Railway container.

The bot registers `/status`, `/logs`, `/accounts`, `/run`, and
`/schedule view|set|disable`. Mutating commands require `confirm=true`.
`/accounts` exposes email addresses only. It never accepts or changes account
passwords, TOTP secrets, cookies, sessions, or Railway variables; add those
through Railway's secret-variable UI. Restrict the bot to a private guild and
allowlist trusted user IDs.

Expose the Railway-provided public port only when the API itself is needed
externally. Keep
`API_TOKEN` secret and do not enable write or reveal capabilities unless they
are required:

```dotenv
API_ALLOW_SCHEDULE_WRITE=false
API_ALLOW_ENV_OVERRIDES=false
API_ALLOW_CONFIG_REVEAL=false
API_ALLOW_CONFIG_WRITE=false
```

## 4. Docker configuration

The image is multi-stage and uses Node.js 24, Patchright Chromium, `cron`,
`tini`, and the required browser libraries. The entrypoint:

1. validates the timezone;
2. creates or synchronizes `config/config.json`;
3. applies `CONFIG_*` overrides;
4. installs the cron schedule;
5. starts cron and optionally the Control API;
6. starts the initial run when requested.

The manual-login and saved-session browser commands intentionally remain
interactive for local use. They are not used by the Railway scheduler.

## 5. Persistent volume

In the current Railway dashboard, create a **Volume** from the project canvas:
right-click an empty area and choose **Create Volume**, or use **Ctrl/Cmd+K**
and search for **New Volume**. Connect the volume to the Microsoft Rewards
service, then open the volume's **Mount Path** setting and enter:

```text
/app/config
```

The entrypoint creates these persistent subdirectories in that volume and
links the application paths to them:

```text
/app/config/config.json
/app/config/sessions/       -> application path /app/sessions
/app/config/diagnostics/    -> application path /app/diagnostics
```

This preserves the required application paths `/app/config`, `/app/sessions`,
and `/app/diagnostics` while avoiding a volume mounted over `/app` (which would
hide the application code). Do not mount the volume at `/app`.

The existing `compose.yaml` keeps separate local mounts for development:
`./config:/app/config`, `./sessions:/app/sessions`, and
`./diagnostics:/app/diagnostics`.

## 6. Initial authentication

### Local manual login

Manual login requires a graphical computer and is intentionally not forced
headless:

```bash
git clone --branch v5 https://github.com/wakeupdude101-arch/Microsoft-Rewards-Script.git
cd Microsoft-Rewards-Script
cp env.example .env
# Add ACCOUNT_N_EMAIL and any local-only sign-in settings to .env
npm ci
npm run install:browser
npm run build
node dist/config/ConfigSync.js sync --patch
npm run manual-login -- account@example.com --platform both --fresh
```

Complete Microsoft sign-in in each visible browser, including any 2FA or
security challenge. The command waits for a verified Rewards page, saves the
session database under the configured `sessionPath` (default `sessions`), and
then closes the browser. Use `--platform desktop` or `--platform mobile` when
only one session is needed.

### Transfer to Railway

Treat the generated session database and fingerprint data like credentials.
Stop the service before replacing sessions, then transfer the contents of the
local `sessions/` directory into `/app/sessions` in the Railway volume using
an encrypted, authenticated transfer method available to your Railway plan
(for example, an approved Railway shell/CLI workflow). Verify file ownership
and permissions, remove any temporary archive from both ends, and restart the
service. Do not send sessions through chat, public issue attachments, or a
public repository.

If transfer is unavailable, enable the Control API only on a protected
deployment and use its documented session-regeneration endpoint with the
account password/TOTP variables; this is a headless sign-in path and still
requires the account's 2FA method to be usable non-interactively. See
[control-api.md](docs/control-api.md) before enabling it.

2FA accounts that require an approval prompt, security key, or CAPTCHA may
still require a fresh local/manual sign-in. Do not put recovery codes in the
repository or logs.

## 7. Scheduling

Set `CRON_SCHEDULE` and `TZ` as Railway variables. Example for 07:00 Nepal
time:

```dotenv
TZ=Asia/Kathmandu
CRON_SCHEDULE=0 7 * * *
RUN_ON_START=false
```

Leave `API_MODE=false` (or unset) for the normal scheduler-only service.
Schedule changes made through the Control API are saved in
`/app/config/schedule.json` and override the initial `CRON_SCHEDULE`.

## 8. Logs

Use the Railway deployment log viewer, or the CLI:

```bash
railway link
railway logs
```

Expected startup messages include the resolved timezone, config path,
`headless=true`, and `Scheduler started`. Logs intentionally do not contain
passwords, cookies, or session contents.

## 9. Troubleshooting

- **No accounts found:** set `ACCOUNT_N_EMAIL` in Railway variables and
  redeploy.
- **Config is a directory:** the volume must be mounted at `/app/config`;
  remove an accidentally created `/app/config/config.json/` directory.
- **Unknown timezone:** use an IANA timezone such as `Asia/Kathmandu`.
- **Chromium launch failure:** rebuild the Docker image; do not add
  Browserless. Confirm the service architecture is supported by Patchright
  and that `FORCE_HEADLESS=1` remains set.
- **Session expired or login loop:** create a fresh local session and transfer
  it securely; Microsoft may require another 2FA challenge.
- **A run is skipped:** inspect logs for the run lock. A still-running
  execution or `STUCK_PROCESS_TIMEOUT_HOURS` protection prevents overlap.
- **No scheduled run:** validate all five cron fields and remember that
  `schedule.json` can override `CRON_SCHEDULE`.
- **Volume data missing after redeploy:** confirm the same Railway volume is
  attached to the same service at exactly `/app/config`; ephemeral filesystem
  changes are not persistent.

## 10. Update and redeploy

Pull the latest `v5` changes in Railway and deploy. Railway rebuilds the
Docker image; the volume is retained. Before updating, export or back up the
volume contents securely. After deployment, check the startup logs, config
sync, Chromium launch, and the next scheduled run. Recreate sessions if the
upstream project changes session compatibility.

## Railway limitations

- A Railway volume is service-local and is not a substitute for a backup.
- A volume mounted at `/app` would mask the image, so this project uses the
  `/app/config` mount and persistent subdirectories described above.
- Railway does not provide an interactive desktop for manual login.
- Browser automation remains dependent on Microsoft account challenges,
  regional availability, proxies, and upstream website changes.
