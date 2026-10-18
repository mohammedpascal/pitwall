#!/usr/bin/env bash
# Pitwall installer for a cloud machine (Ubuntu or Debian).
#
#   curl -fsSL https://raw.githubusercontent.com/__PITWALL_REPO__/main/install.sh | sudo bash
#
# Sets up Pitwall at https://pitwall.<your dev domain>, each service at
# https://<project>-<service>.<your dev domain>, Caddy for HTTPS, a firewall,
# Node, bun and Claude Code, and prints a generated password.
# Running it again updates Pitwall and keeps your domain, password and data.
#
# Optional settings:  PITWALL_DOMAIN=dev.example.com   (skip the question)
#                     PITWALL_VERSION=v0.2.0           (default: latest release)
#                     PITWALL_SKIP_DNS_CHECK=1         (don't wait for DNS)
#                     PITWALL_TARBALL=<url>            (install this build instead)
set -euo pipefail

REPO="${PITWALL_REPO:-__PITWALL_REPO__}"
APP=/opt/pitwall
DATA=/var/lib/pitwall
USER_NAME=pitwall
HOME_DIR=/home/pitwall
UI_PORT=3000
GATEWAY_PORT=3001

bold=$'\e[1m'; dim=$'\e[2m'; red=$'\e[31m'; green=$'\e[32m'; reset=$'\e[0m'
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$reset"; }
die()  { printf '%sError:%s %s\n' "$red" "$reset" "$*" >&2; exit 1; }
# Prompts read the terminal, so they work under `curl | bash`.
ask()  { local answer; read -r -p "$1" answer </dev/tty; printf '%s' "$answer"; }

# ── Checks ──────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL … | sudo bash"
[ "$(uname -s)" = Linux ] || die "Pitwall's installer is for Linux servers."
command -v apt-get >/dev/null || die "This installer needs Ubuntu or Debian (apt)."
case "$(uname -m)" in x86_64|aarch64) ;; *) die "Unsupported CPU: $(uname -m)";; esac
[[ "$REPO" != *__PITWALL_REPO__* ]] || [ -n "${PITWALL_TARBALL:-}" ] || die "Set PITWALL_REPO=owner/repo (this copy of the installer wasn't published)."

for port in 80 443; do
  if ss -ltnH "sport = :$port" 2>/dev/null | grep -q . && ! ss -ltnpH "sport = :$port" | grep -q caddy; then
    die "Port $port is already in use. Pitwall needs ports 80 and 443 for HTTPS."
  fi
done

say "${bold}Pitwall${reset} ${dim}installer${reset}"

# ── Domain ──────────────────────────────────────────────────────────────────
existing_domain=""
if [ -f "$DATA/pitwall.config.json" ]; then
  existing_domain=$(sed -n 's/.*"domain"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$DATA/pitwall.config.json" | head -1)
fi
DOMAIN="${PITWALL_DOMAIN:-$existing_domain}"
if [ -z "$DOMAIN" ]; then
  say ""
  say "Pick a dev domain. Pitwall will be at pitwall.<domain>, and each service"
  say "at <project>-<service>.<domain>. For example: dev.example.com"
  DOMAIN=$(ask "Dev domain: ")
fi
DOMAIN=$(printf '%s' "$DOMAIN" | tr 'A-Z' 'a-z' | sed 's/^\.*//; s/\.*$//; s#^https\?://##')
[[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "\"$DOMAIN\" isn't a domain name."

IP=$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || true)
[ -n "$IP" ] || IP="<this server's public IP>"

step "DNS"
say "Add this record where ${DOMAIN#*.}'s DNS is managed (once):"
say ""
say "    ${bold}*.${DOMAIN}   A   ${IP}${reset}"
say ""
# A random name checks the wildcard, not just one record.
probe="check-$RANDOM.$DOMAIN"
while [ -z "${PITWALL_SKIP_DNS_CHECK:-}" ]; do
  resolved=$(getent ahostsv4 "$probe" 2>/dev/null | awk 'NR==1{print $1}')
  if [ -n "$resolved" ] && { [ "$resolved" = "$IP" ] || [[ "$IP" == \<* ]]; }; then
    say "${green}✓${reset} *.$DOMAIN points at $resolved"
    break
  fi
  if [ -n "$resolved" ]; then
    say "*.$DOMAIN points at $resolved, not $IP."
  else
    say "*.$DOMAIN doesn't resolve yet."
  fi
  reply=$(ask "Press Enter to check again, or type skip to continue anyway: ")
  [ "$reply" = skip ] && break
done

# ── Packages ────────────────────────────────────────────────────────────────
step "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg openssl ufw unzip debian-keyring debian-archive-keyring apt-transport-https >/dev/null

node_major=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)
if [ "${node_major:-0}" -lt 20 ]; then
  say "Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi

if ! command -v caddy >/dev/null; then
  say "Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ── User and folders ────────────────────────────────────────────────────────
step "Setting up the pitwall user"
if ! id "$USER_NAME" >/dev/null 2>&1; then
  useradd --create-home --home-dir "$HOME_DIR" --shell /bin/bash "$USER_NAME"
fi
install -d -o "$USER_NAME" -g "$USER_NAME" "$HOME_DIR/projects" "$DATA"
# runuser is always there; sudo isn't on minimal images.
as_pitwall() { runuser -u "$USER_NAME" -- env HOME="$HOME_DIR" bash -lc "$1"; }

if [ ! -x "$HOME_DIR/.bun/bin/bun" ]; then
  say "bun"
  as_pitwall 'curl -fsSL https://bun.sh/install | bash' >/dev/null
fi
if [ ! -x "$HOME_DIR/.local/bin/claude" ]; then
  say "Claude Code"
  as_pitwall 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null
fi

# ── Pitwall ─────────────────────────────────────────────────────────────────
step "Installing Pitwall"
if [ -n "${PITWALL_TARBALL:-}" ]; then
  url="$PITWALL_TARBALL"
elif [ -n "${PITWALL_VERSION:-}" ]; then
  url="https://github.com/$REPO/releases/download/$PITWALL_VERSION/pitwall.tar.gz"
else
  url="https://github.com/$REPO/releases/latest/download/pitwall.tar.gz"
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url" -o "$tmp/pitwall.tar.gz" || die "Couldn't download $url"
mkdir -p "$tmp/app"
tar -xzf "$tmp/pitwall.tar.gz" -C "$tmp/app"
[ -f "$tmp/app/server.mjs" ] || die "The download doesn't look like a Pitwall release."
# Dependencies are installed here, so native parts match this machine.
(cd "$tmp/app" && npm ci --omit=dev --no-audit --no-fund --no-update-notifier --loglevel=error)
rm -rf "$APP.old"
[ -d "$APP" ] && mv "$APP" "$APP.old"
mv "$tmp/app" "$APP"
chown -R root:root "$APP"
chmod -R a+rX "$APP"
rm -rf "$APP.old"

if [ ! -f "$DATA/pitwall.config.json" ]; then
  printf '{\n  "domain": "%s",\n  "projects": []\n}\n' "$DOMAIN" >"$DATA/pitwall.config.json"
  chown "$USER_NAME:$USER_NAME" "$DATA/pitwall.config.json"
elif [ -z "$existing_domain" ] || [ "$existing_domain" != "$DOMAIN" ]; then
  say "Keeping the domain in $DATA/pitwall.config.json; edit it there to change it."
fi

PASSWORD=""
if [ ! -f "$DATA/.pitwall/auth.json" ]; then
  PASSWORD=$(cd "$DATA" && runuser -u "$USER_NAME" -- node "$APP/scripts/set-password.mjs")
fi

# The pitwall command: reset-password, logs, restart, status, update.
cat >/usr/local/bin/pitwall <<EOF
#!/usr/bin/env bash
set -euo pipefail
case "\${1:-help}" in
  reset-password)
    [ "\$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
    # Read on every sign-in, so no restart (which would stop your running services).
    pw=\$(cd $DATA && runuser -u $USER_NAME -- node $APP/scripts/set-password.mjs)
    echo "New password (everyone is signed out): \$pw" ;;
  logs)    journalctl -u pitwall -f -n 100 ;;
  restart) systemctl restart pitwall ;;
  status)  systemctl status pitwall --no-pager ;;
  update)  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | PITWALL_REPO=$REPO bash ;;
  *) echo "Usage: pitwall reset-password | logs | restart | status | update" ;;
esac
EOF
chmod 755 /usr/local/bin/pitwall

# ── Service ─────────────────────────────────────────────────────────────────
cat >/etc/systemd/system/pitwall.service <<EOF
[Unit]
Description=Pitwall
After=network-online.target
Wants=network-online.target

[Service]
User=$USER_NAME
WorkingDirectory=$DATA
Environment=NODE_ENV=production
Environment=PORT=$UI_PORT
Environment=HOST=127.0.0.1
Environment=PITWALL_GATEWAY_PORT=$GATEWAY_PORT
Environment=PATH=$HOME_DIR/.bun/bin:$HOME_DIR/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env node $APP/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable pitwall >/dev/null 2>&1
systemctl restart pitwall

# ── HTTPS ───────────────────────────────────────────────────────────────────
step "Configuring Caddy"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'Managed by Pitwall' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-pitwall"
  say "Saved your previous Caddyfile as /etc/caddy/Caddyfile.before-pitwall"
fi
cat >/etc/caddy/Caddyfile <<EOF
# Managed by Pitwall (install.sh). Re-running the installer rewrites this file.
{
	# Certificates only for names Pitwall knows: itself and configured services.
	on_demand_tls {
		ask http://127.0.0.1:$UI_PORT/api/caddy/ask
	}
}

pitwall.$DOMAIN {
	reverse_proxy 127.0.0.1:$UI_PORT
}

# Every other name under the domain: the gateway checks the login and routes to the service.
https:// {
	tls {
		on_demand
	}
	reverse_proxy 127.0.0.1:$GATEWAY_PORT
}
EOF
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || die "Caddy rejected the generated config. See: caddy validate --config /etc/caddy/Caddyfile"
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

# ── Firewall ────────────────────────────────────────────────────────────────
step "Firewall"
# Keep whatever port SSH really listens on, so this never locks you out.
ssh_ports=$(ss -ltnpH 2>/dev/null | awk '/sshd/ {n=split($4,a,":"); print a[n]}' | sort -u)
for p in ${ssh_ports:-22}; do ufw allow "$p/tcp" >/dev/null; done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
say "Open: SSH (${ssh_ports:-22}), 80, 443. Everything else, including dev servers, stays private."

# ── Done ────────────────────────────────────────────────────────────────────
say ""
say "${green}${bold}Pitwall is ready.${reset}"
say ""
say "  Open      ${bold}https://pitwall.$DOMAIN${reset}"
if [ -n "$PASSWORD" ]; then
  say "  Password  ${bold}$PASSWORD${reset}"
  say "            ${dim}Shown once. Store it in your password manager. New one: sudo pitwall reset-password${reset}"
else
  say "  Password  unchanged ${dim}(new one: sudo pitwall reset-password)${reset}"
fi
say ""
say "Next:"
say "  1. Sign in to Claude Code for tasks:   sudo -iu $USER_NAME claude"
say "  2. Put your projects in $HOME_DIR/projects (as the pitwall user):"
say "       sudo -iu $USER_NAME git clone <repo> projects/<name>"
say "  3. In Pitwall, open a project from that folder."
say ""
say "${dim}The first visit to each address takes a few seconds while its certificate is issued.${reset}"
