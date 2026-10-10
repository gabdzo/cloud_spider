// First-boot script for the OpenShift Local (CRC) host. Pure, so the tests
// can read it. It installs the SSM agent and the crc binary and creates
// user `crc`. It installs an auto-stop unit that runs `shutdown -h +N` on
// EVERY boot, and with instanceInitiatedShutdownBehavior=stop that shutdown
// stops the instance, it does not terminate it. It never holds the Red Hat
// pull secret: Gabriel copies that in over SSM (docs/RUN-ME.md §12).
export const CRC_URL = "https://developers.redhat.com/content-gateway/rest/mirror/pub/openshift-v4/clients/crc/latest/crc-linux-amd64.tar.xz";
export const SSM_URL = "https://s3.eu-north-1.amazonaws.com/amazon-ssm-eu-north-1/latest/linux_amd64/amazon-ssm-agent.rpm";

export function userData({ maxHours = 4 } = {}) {
  const hours = Math.max(1, Math.min(12, Math.floor(Number(maxHours) || 4)));
  return `#!/bin/bash
set -euxo pipefail
# --- auto-stop: every boot schedules a shutdown ${hours} h later (stop, not terminate)
cat > /etc/systemd/system/cloudspider-autostop.service <<'UNIT'
[Unit]
Description=Cloud Spider: stop this OpenShift host after ${hours} hours
After=multi-user.target
[Service]
Type=oneshot
ExecStart=/usr/sbin/shutdown -h +${hours * 60} "cloudspider: auto-stop after ${hours} h (cancel with: sudo shutdown -c)"
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now cloudspider-autostop.service
# --- SSM agent: the only way in (no SSH, no inbound rules)
dnf install -y ${SSM_URL}
systemctl enable --now amazon-ssm-agent
# --- CRC prerequisites and binary
dnf install -y NetworkManager libvirt qemu-kvm tar xz jq
systemctl enable --now libvirtd
id crc >/dev/null 2>&1 || useradd -m -G wheel,libvirt crc
echo 'crc ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/crc
curl -fsSL ${CRC_URL} | tar -xJ --strip-components=1 -C /usr/local/bin --wildcards '*/crc'
sudo -iu crc crc config set consent-telemetry no
sudo -iu crc crc config set memory 24576
sudo -iu crc crc config set cpus 7
sudo -iu crc crc config set disk-size 80
echo "cloudspider: host ready. Next steps: docs/RUN-ME.md section 12 (as user crc)." > /etc/motd
`;
}
