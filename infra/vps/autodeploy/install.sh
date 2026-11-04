#!/usr/bin/env bash
# Install or update the auto-deployer on the VPS. Run as root from the repo
# checkout:  bash /opt/citramac/app/infra/vps/autodeploy/install.sh
#
# The deployer is copied out of the checkout on purpose: a push to master can
# change the app, but not the root-run script that deploys it. Re-run this
# after reviewing a change to these files.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
install -m 0755 "$here/citramac-autodeploy" /usr/local/sbin/citramac-autodeploy
install -d -m 0755 /usr/local/lib/citramac-autodeploy
install -m 0644 "$here/pod_overrides.py" /usr/local/lib/citramac-autodeploy/pod_overrides.py
install -m 0644 "$here/citramac-autodeploy.service" /etc/systemd/system/citramac-autodeploy.service
install -m 0644 "$here/citramac-autodeploy.timer" /etc/systemd/system/citramac-autodeploy.timer
install -d -m 0700 /var/lib/citramac-autodeploy
# First install: start from what is running now, so the first deploy only
# picks up commits made after it.
if [[ ! -e /var/lib/citramac-autodeploy/deployed ]]; then
  runuser -u citramac -- git -C /opt/citramac/app rev-parse HEAD >/var/lib/citramac-autodeploy/deployed
fi
systemctl daemon-reload
systemctl enable --now citramac-autodeploy.timer
echo "installed; deployed = $(cat /var/lib/citramac-autodeploy/deployed)"
systemctl list-timers citramac-autodeploy.timer --no-pager
