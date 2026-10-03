# Deployment and synchronization

Public catalogue: https://games.rootnode.cv/. Host: `alex@192.168.88.5` (`websrv`). Caddy proxies to the existing `games.service` on `127.0.0.1:8090`.

## Daily sync

`rootnode-games-sync.timer` starts `rootnode-games-sync.service` daily at 04:00 UTC with up to 15 minutes randomized delay. `Persistent=true` runs missed updates after a reboot. Only public `https://github.com/glinko/rootnode-games.git`, branch `main`, is fetched. No GitHub token or private SSH key is stored on the sync server.

Git fetch, source extraction and the static packaging step run as unprivileged `games-sync`. The server uses a separately installed, root-owned validator rather than executing scripts from a contributed checkout. Root then installs an immutable release, switches `/srv/games/current`, restarts `games.service`, and checks HTTP and the level API. If startup or health checks fail, it restores the previous release. An unchanged commit is skipped. A failed build leaves the running release untouched.

The runtime backend and validator under `/usr/local/lib/rootnode-games/` are trusted operations files. Changes to them in GitHub require a reviewed manual reinstall via `ops/install-sync.sh`; daily sync does not execute or replace backend/deployment code from the checkout.

User-created Angry Balls levels remain in `/srv/games/data/angry-balls-levels.json`; each deployment backs them up under `/srv/games/backups/levels-<timestamp>.json`. Never put this file in Git or copy a seed database over it. Releases are under `/srv/games/releases/git-<commit>`. `/version.json` reports the published commit and deployment time.

## Initial installation / trusted operations update

From a reviewed checkout uploaded to the server:

```sh
sudo bash ops/install-sync.sh
```

The initial public game service, data directory and Caddy route must already exist. Installation preserves the runtime data and existing Caddy settings. The installation adds an unprivileged user and two systemd units, installs trusted helper files and runs one initial sync before enabling the daily timer.

## Operation

```sh
sudo systemctl start rootnode-games-sync.service
sudo systemctl status rootnode-games-sync.service --no-pager
sudo systemctl list-timers rootnode-games-sync.timer --no-pager
sudo journalctl -u rootnode-games-sync.service -n 50 --no-pager
curl -fsS https://games.rootnode.cv/version.json
```

The catalogue link **Add your game** leads to CONTRIBUTING.md. GitHub branch protection requires the `catalogue-validation` check, an up-to-date branch and one code-owner approval; force pushes and branch deletion are disabled. The owner retains the standard administrator bypass for maintaining their own repository; contributors submit reviewed PRs.

To stop future updates: `sudo systemctl disable --now rootnode-games-sync.timer`. To roll back a deployed commit, point `current` to a prior release and restart `games.service`; leave the data file in place. A release that fails health checks is retained with a .failed timestamp suffix, so the next scheduled run can retry. If an interrupted deployment left an already-existing git-<commit> directory, inspect its current symlink and status before a manual retry.

## Public editor mode

The editor and level writes are deliberately public at the owner's request. The protected Caddy block is kept in `Caddyfile.games.protected`. To enable protection again, replace only the Rootnode games block in `/etc/caddy/Caddyfile`, validate Caddy and reload it. Static GitHub sync does not modify authentication policy, Caddy or other hosted sites.
