#!/bin/bash
# Installed outside the checkout. Only main is fetched; no repository scripts run as root.
set -euo pipefail
exec 9>/run/rootnode-games-sync.lock
flock -n 9 || exit 0
base=/var/lib/rootnode-games-sync
repo=$base/repo
origin=https://github.com/glinko/rootnode-games.git
if [ ! -d "$repo/.git" ]; then
    runuser -u games-sync -- git clone --branch main --single-branch "$origin" "$repo"
fi
[ "$(runuser -u games-sync -- git -C "$repo" remote get-url origin)" = "$origin" ] || { echo 'Unexpected origin'; exit 1; }
runuser -u games-sync -- git -c protocol.file.allow=never -C "$repo" fetch --prune origin main
commit=$(runuser -u games-sync -- git -C "$repo" rev-parse origin/main)
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
if [ -f /srv/games/deployed-commit ] && [ "$(cat /srv/games/deployed-commit)" = "$commit" ]; then
    echo "Already deployed $commit"
    exit 0
fi
runuser -u games-sync -- python3 /usr/local/lib/rootnode-games/check-ci.py "$commit"
work=$(mktemp -d "$base/work/build.XXXXXXXX")
chown games-sync:games-sync "$work"
trap 'rm -rf -- "$work"' EXIT
runuser -u games-sync -- git -C "$repo" archive --format=tar "$commit" | runuser -u games-sync -- tar -xf - -C "$work"
# This builder is root-owned and installed separately; checkout code is never executed.
runuser -u games-sync -- python3 /usr/local/lib/rootnode-games/build.py --root "$work" --output "$work/dist"
release=/srv/games/releases/git-$commit
[ ! -e "$release" ] || { echo 'Release path already exists; inspect previous failed deployment'; exit 1; }
install -d -m 755 "$release"
cp -a "$work/dist/public" "$release/public"
install -m 644 /usr/local/lib/rootnode-games/server.py "$release/server.py"
chown -R root:root "$release"
chmod -R a+rX "$release"
printf '{"commit":"%s","deployed_at":"%s"}\n' "$commit" "$(date -u +%FT%TZ)" > "$release/public/version.json"
old=$(readlink -f /srv/games/current)
backup=/srv/games/backups/levels-$(date -u +%Y%m%d-%H%M%S).json
install -m 600 /srv/games/data/angry-balls-levels.json "$backup"
ln -s "$release" /srv/games/current.next
mv -Tf /srv/games/current.next /srv/games/current
if systemctl restart games.service && curl --retry 6 --retry-delay 1 --retry-connrefused -fsS http://127.0.0.1:8090/ -o /dev/null && curl -fsS http://127.0.0.1:8090/api/hungry-balls/levels -o /dev/null; then
    printf '%s\n' "$commit" > /srv/games/deployed-commit.next
    mv /srv/games/deployed-commit.next /srv/games/deployed-commit
    echo "Deployed $commit to https://games.rootnode.cv/"
else
    ln -s "$old" /srv/games/current.rollback
    mv -Tf /srv/games/current.rollback /srv/games/current
    systemctl restart games.service
    mv "$release" "$release.failed.$(date -u +%Y%m%d-%H%M%S)"
    echo 'Health check failed; previous release restored' >&2
    exit 1
fi
