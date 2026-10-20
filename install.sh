#!/usr/bin/env bash
# Pitwall installer for a cloud machine (Ubuntu or Debian).
#
#   curl -fsSL https://raw.githubusercontent.com/mohammedpascal/pitwall/main/install.sh | sudo bash
#
# Asks nothing. Sets up Pitwall with Caddy for HTTPS, a firewall, Node, bun,
# pnpm/yarn, Claude Code, the GitHub CLI and build tools, and prints a link that
# signs you in. Pitwall is at https://<this server's IP> until you give it a dev
# domain on its Setup screen, where you also sign in to Claude and GitHub.
# Running it again updates Pitwall and keeps your domain, data and sign-ins.
#
# Optional settings:  PITWALL_DOMAIN=dev.example.com   (use this dev domain now)
#                     PITWALL_VERSION=v0.2.0           (default: latest release)
#                     PITWALL_TARBALL=<url>            (install this build instead)
#                     PITWALL_PROJECTS=/srv/code       (default: /home/pitwall/projects)
#                     PITWALL_IP=203.0.113.7           (if it can't find its public IP)
set -euo pipefail

REPO="${PITWALL_REPO:-mohammedpascal/pitwall}"
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
# Never stop silently: say which step failed.
trap 'die "Stopped at line $LINENO: $BASH_COMMAND"' ERR

# ── Checks ──────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "Run as root: curl -fsSL … | sudo bash"
[ "$(uname -s)" = Linux ] || die "Pitwall's installer is for Linux servers."
command -v apt-get >/dev/null || die "This installer needs Ubuntu or Debian (apt)."
case "$(uname -m)" in x86_64|aarch64) ;; *) die "Unsupported CPU: $(uname -m)";; esac

for port in 80 443; do
  if ss -ltnH "sport = :$port" 2>/dev/null | grep -q . && ! ss -ltnpH "sport = :$port" | grep -q caddy; then
    die "Port $port is already in use. Pitwall needs ports 80 and 443 for HTTPS."
  fi
done

say "${bold}Pitwall${reset} ${dim}installer${reset}"

# ── Address ─────────────────────────────────────────────────────────────────
IP="${PITWALL_IP:-$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || true)}"
[[ "$IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "Couldn't find this server's public IP. Run again with PITWALL_IP=<its IPv4 address>."

DOMAIN=""
if [ -n "${PITWALL_DOMAIN:-}" ]; then
  DOMAIN=$(printf '%s' "$PITWALL_DOMAIN" | tr 'A-Z' 'a-z' | sed 's/^\.*//; s/\.*$//; s#^https\?://##')
  [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "\"$DOMAIN\" isn't a domain name."
fi

# ── Packages ────────────────────────────────────────────────────────────────
step "Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# build-essential and python3 build native npm modules; bsdutils has `script`,
# which gives Claude a terminal for Remote Control.
apt-get install -y -qq ca-certificates curl git gnupg openssl ufw unzip jq build-essential python3 bsdutils \
  debian-keyring debian-archive-keyring apt-transport-https >/dev/null

node_major=$(node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/' || echo 0)
if [ "${node_major:-0}" -lt 20 ]; then
  say "Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
# pnpm and yarn, for projects that use them; fetched the first time one does.
corepack enable

if ! command -v gh >/dev/null; then
  say "GitHub CLI"
  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /usr/share/keyrings/githubcli-archive-keyring.gpg
  chmod a+r /usr/share/keyrings/githubcli-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    >/etc/apt/sources.list.d/github-cli.list
  apt-get update -qq
  apt-get install -y -qq gh >/dev/null
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
# The projects folder: given, or the one from the last install, or the default.
# (No service file on a fresh machine: that's fine, not an error.)
existing_projects=$(sed -n 's/^Environment=PITWALL_PROJECTS=//p' /etc/systemd/system/pitwall.service 2>/dev/null | head -1 || true)
PROJECTS="${PITWALL_PROJECTS:-${existing_projects:-$HOME_DIR/projects}}"
PROJECTS="${PROJECTS%/}"
[[ "$PROJECTS" = /* ]] || die "PITWALL_PROJECTS must be a full path, like /srv/code."
install -d -o "$USER_NAME" -g "$USER_NAME" "$PROJECTS" "$DATA"
# runuser is always there; sudo isn't on minimal images.
as_pitwall() { runuser -u "$USER_NAME" -- env HOME="$HOME_DIR" bash -lc "$1"; }

if [ ! -x "$HOME_DIR/.bun/bin/bun" ]; then
  say "bun"
  as_pitwall 'curl -fsSL https://bun.sh/install | bash' >/dev/null 2>&1
fi
if [ ! -x "$HOME_DIR/.local/bin/claude" ]; then
  say "Claude Code"
  as_pitwall 'curl -fsSL https://claude.ai/install.sh | bash' >/dev/null
fi
# bun's installer only adds itself to .bashrc, which scripts don't read.
if ! grep -q '.bun/bin' "$HOME_DIR/.profile" 2>/dev/null; then
  echo 'export PATH="$HOME/.bun/bin:$HOME/.local/bin:$PATH"' >>"$HOME_DIR/.profile"
  chown "$USER_NAME:$USER_NAME" "$HOME_DIR/.profile"
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

# No domain yet is fine: Pitwall answers on the IP, and Setup adds one.
[ -f "$DATA/pitwall.config.json" ] || echo '{ "projects": [] }' >"$DATA/pitwall.config.json"
if [ -n "$DOMAIN" ]; then
  jq --arg d "$DOMAIN" '.domain = $d' "$DATA/pitwall.config.json" >"$DATA/pitwall.config.json.new"
  mv "$DATA/pitwall.config.json.new" "$DATA/pitwall.config.json"
fi
chown "$USER_NAME:$USER_NAME" "$DATA/pitwall.config.json"
new_link() { cd "$DATA" && runuser -u "$USER_NAME" -- env PITWALL_IP="$IP" node "$APP/scripts/new-link.mjs"; }

# The pitwall command: link, sign-in, logs, restart, status, update, uninstall.
# Written beside it and moved into place: a running `pitwall update` is still
# reading the old file, and bash would choke on new text at its old position.
cat >/usr/local/bin/pitwall.new <<EOF
#!/usr/bin/env bash
set -euo pipefail
as_pitwall() { runuser -u $USER_NAME -- env HOME=$HOME_DIR bash -lc "\$1"; }
case "\${1:-help}" in
  sign-in)
    [ "\$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
    # Claude for tasks; GitHub for git push and pull requests. Done steps are skipped.
    as_pitwall 'claude auth status >/dev/null 2>&1 && echo "Claude: signed in" || claude auth login'
    as_pitwall 'gh auth status >/dev/null 2>&1 && echo "GitHub: signed in" || gh auth login --hostname github.com --git-protocol https --web'
    as_pitwall 'gh auth setup-git'
    # Commits need a name and email; take them from the GitHub account.
    as_pitwall '
      if [ -z "\$(git config --global user.name)" ]; then
        git config --global user.name "\$(gh api user --jq ".name // .login")"
        git config --global user.email "\$(gh api user --jq ".email // \"\\(.id)+\\(.login)@users.noreply.github.com\"")"
        echo "Git: commits by \$(git config --global user.name) <\$(git config --global user.email)>"
      fi' ;;
  link)
    [ "\$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
    echo "Sign in with this link (works once, for 24 hours):"
    cd $DATA && runuser -u $USER_NAME -- env PITWALL_IP=$IP node $APP/scripts/new-link.mjs ;;
  logs)    journalctl -u pitwall -f -n 100 ;;
  restart) systemctl restart pitwall ;;
  status)
    echo "Version   \$(cat $APP/VERSION 2>/dev/null || echo unknown)"
    echo "Pitwall   $APP"
    echo "Projects  $PROJECTS"
    echo "Data      $DATA"
    echo
    systemctl status pitwall --no-pager ;;
  update)  exec bash -c 'curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | PITWALL_REPO=$REPO bash' ;;
  uninstall)
    [ "\$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }
    ask() { local a; read -r -p "\$1 [y/N] " a </dev/tty; [[ "\$a" =~ ^[Yy] ]]; }
    ask "Remove Pitwall (its app, settings and tasks)?" || exit 0
    # Also asked now, so nothing is half done if you say no.
    remove_user=""
    if id $USER_NAME >/dev/null 2>&1; then
      echo
      echo "The $USER_NAME user holds your projects and the Claude and GitHub sign-ins."
      [ -d "$PROJECTS" ] && ls -1 "$PROJECTS" | sed 's/^/  /'
      if ask "Also delete the $USER_NAME user, $HOME_DIR and everything in $PROJECTS?"; then remove_user=1; fi
    fi
    # Stopping the service ends everything it started: your services and Claude too.
    systemctl disable --now pitwall pitwall-update.path >/dev/null 2>&1 || true
    rm -f /etc/systemd/system/pitwall.service /etc/systemd/system/pitwall-update.path /etc/systemd/system/pitwall-update.service
    systemctl daemon-reload
    rm -rf $APP $DATA
    # Caddy goes back to what it had before Pitwall, or to serving nothing.
    if [ -f /etc/caddy/Caddyfile.before-pitwall ]; then
      mv /etc/caddy/Caddyfile.before-pitwall /etc/caddy/Caddyfile
    else
      echo "# Pitwall was uninstalled." >/etc/caddy/Caddyfile
    fi
    systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
    if [ -n "\$remove_user" ]; then
      pkill -KILL -u $USER_NAME 2>/dev/null || true
      userdel -r $USER_NAME 2>/dev/null || true
      rm -rf "$PROJECTS"
      echo "Removed Pitwall and the $USER_NAME user."
    else
      echo "Removed Pitwall. Kept the $USER_NAME user, $PROJECTS and its sign-ins."
    fi
    echo "Node, Caddy, git, the GitHub CLI and the firewall rules stay installed."
    rm -f /usr/local/bin/pitwall ;;
  *) echo "Usage: pitwall link | sign-in | logs | restart | status | update | uninstall" ;;
esac
EOF
chmod 755 /usr/local/bin/pitwall.new
mv -f /usr/local/bin/pitwall.new /usr/local/bin/pitwall

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
Environment=PITWALL_PROJECTS=$PROJECTS
# Where Pitwall looks for newer releases.
Environment=PITWALL_REPO=$REPO
# A cloud machine, with or without a dev domain; it answers on this IP until it has one.
Environment=PITWALL_CLOUD=1
Environment=PITWALL_IP=$IP
# No terminal to answer corepack's "download pnpm?" question.
Environment=COREPACK_ENABLE_DOWNLOAD_PROMPT=0
Environment=PATH=$HOME_DIR/.bun/bin:$HOME_DIR/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env node $APP/server.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

# "Update to …" in Pitwall's menu: Pitwall runs as $USER_NAME, so it leaves a file
# and this root unit runs `pitwall update`. Its own unit, so restarting Pitwall
# doesn't stop the update halfway.
cat >/etc/systemd/system/pitwall-update.path <<EOF
[Unit]
Description=Update Pitwall when it asks

[Path]
PathExists=$DATA/update-requested

[Install]
WantedBy=multi-user.target
EOF
cat >/etc/systemd/system/pitwall-update.service <<EOF
[Unit]
Description=Update Pitwall

[Service]
Type=oneshot
ExecStartPre=/bin/rm -f $DATA/update-requested
ExecStart=/usr/local/bin/pitwall update
EOF
systemctl daemon-reload
systemctl enable pitwall >/dev/null 2>&1
systemctl enable --now pitwall-update.path >/dev/null 2>&1
systemctl restart pitwall

# ── Firewall ────────────────────────────────────────────────────────────────
step "Firewall"
# Before Caddy starts: turning the firewall on drops connections in flight,
# which would cut off Caddy's first certificate request.
# Keep whatever port SSH really listens on, so this never locks you out.
ssh_ports=$(ss -ltnpH 2>/dev/null | awk '/sshd/ {n=split($4,a,":"); print a[n]}' | sort -u)
for p in ${ssh_ports:-22}; do ufw allow "$p/tcp" >/dev/null; done
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
say "Open: SSH (${ssh_ports:-22}), 80, 443. Everything else, including dev servers, stays private."

# ── HTTPS ───────────────────────────────────────────────────────────────────
step "Configuring Caddy"
# The package's sample file isn't worth keeping; one you wrote is.
if [ -f /etc/caddy/Caddyfile ] && ! grep -q 'Managed by Pitwall' /etc/caddy/Caddyfile \
  && ! grep -q '^# The Caddyfile is an easy way to configure your Caddy web server' /etc/caddy/Caddyfile; then
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

# Pitwall on the server's IP, before it has a domain (then it forwards there).
# Certificates for an IP address are short-lived ones; Caddy renews them.
https://$IP {
	tls {
		issuer acme {
			profile shortlived
		}
	}
	reverse_proxy 127.0.0.1:$UI_PORT
}

# Every name under the dev domain, whichever it is: the gateway sends pitwall.<domain>
# to Pitwall, checks the login for the rest and routes each to its service.
# Caddy never needs the domain, so it can change from Pitwall's Setup screen.
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

# ── Done ────────────────────────────────────────────────────────────────────
LINK=$(new_link)
say ""
say "${green}${bold}Pitwall is ready.${reset}"
say ""
say "  Open  ${bold}$LINK${reset}"
say "        ${dim}Signs you in. Works once, for 24 hours. A new one: sudo pitwall link${reset}"
say "        ${dim}To sign in from other devices, set a password in Setup.${reset}"
say ""
say "${dim}The first visit takes a few seconds while its certificate is issued.${reset}"
