#!/bin/bash
# Run once as root on websrv, from a reviewed checkout or uploaded installation bundle.
set -euo pipefail
source_dir=$(cd "$(dirname "$0")/.." && pwd)
getent passwd games-sync >/dev/null || useradd --system --home /var/lib/rootnode-games-sync --shell /usr/sbin/nologin games-sync
install -d -m 755 /usr/local/lib/rootnode-games
install -d -o games-sync -g games-sync -m 750 /var/lib/rootnode-games-sync /var/lib/rootnode-games-sync/work
install -m 644 "$source_dir/scripts/build.py" /usr/local/lib/rootnode-games/build.py
install -m 644 "$source_dir/server/server.py" /usr/local/lib/rootnode-games/server.py
install -m 755 "$source_dir/ops/sync-games.sh" /usr/local/sbin/rootnode-games-sync
install -m 644 "$source_dir/ops/rootnode-games-sync.service" /etc/systemd/system/rootnode-games-sync.service
install -m 644 "$source_dir/ops/rootnode-games-sync.timer" /etc/systemd/system/rootnode-games-sync.timer
systemctl daemon-reload
systemctl start rootnode-games-sync.service
systemctl enable --now rootnode-games-sync.timer
systemctl list-timers rootnode-games-sync.timer --no-pager
