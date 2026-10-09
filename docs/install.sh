#!/bin/sh
# hamyad one-line installer (Linux, macOS, WSL):
#   curl -fsSL https://mrzroot.github.io/hamyad/install.sh | sh
#
# What it does, step by step (nothing needs sudo):
#   1. uses your Node.js 20+ if you have one, otherwise downloads the official Node.js 24 LTS
#      into ~/.hamyad/node (portable, removable: rm -rf ~/.hamyad)
#   2. installs the latest hamyad release from GitHub into ~/.hamyad and links ~/.local/bin/hamyad
#   3. asks before setting up the current folder, then runs `hamyad setup`:
#      init --all, pre-approve the AI tools, optional public URL for chat apps
#
# Options (environment variables):
#   HAMYAD_YES=1          answer yes to every question (non-interactive)
#   HAMYAD_DIR=/path      project to set up (default: the current folder)
#   HAMYAD_NO_SETUP=1     only install the CLI
#   HAMYAD_SETUP_ARGS=…   extra arguments for `hamyad setup` (e.g. "--tunnel" or "--no-chat")
#   HAMYAD_VERSION=v0.2.1 install a specific release (default: latest)
#   HAMYAD_TARBALL=…      install from this .tgz path/URL instead (testing)
#   HAMYAD_NODE=portable  always use the portable Node, even if one is installed
#   HAMYAD_HOME=~/.hamyad install location
set -eu

REPO="mrzroot/hamyad"
NODE_VERSION="${HAMYAD_NODE_VERSION:-24.21.0}"
HOME_DIR="${HAMYAD_HOME:-$HOME/.hamyad}"
BIN_DIR="${HAMYAD_BIN_DIR:-$HOME/.local/bin}"
YES="${HAMYAD_YES:-0}"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then B=$(printf '\033[1m'); G=$(printf '\033[32m'); Y=$(printf '\033[33m'); R=$(printf '\033[31m'); D=$(printf '\033[2m'); N=$(printf '\033[0m'); else B=; G=; Y=; R=; D=; N=; fi
say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s%s%s\n' "$G" "$N" "$B" "$*" "$N"; }
warn() { printf '%s!%s %s\n' "$Y" "$N" "$*" >&2; }
die() { printf '%sx%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

# Questions read from the terminal even when this script itself arrives on stdin (curl | sh).
TTY=""
if [ "$YES" != "1" ] && (exec 3</dev/tty) 2>/dev/null; then TTY=/dev/tty; fi
ask() { # ask "question" default -> echoes answer
  if [ -z "$TTY" ]; then printf '%s' "$2"; return; fi
  printf '%s ' "$1" >/dev/tty
  read -r a </dev/tty || a=""
  [ -n "$a" ] && printf '%s' "$a" || printf '%s' "$2"
}
is_yes() { case "$1" in y|Y|yes|YES|Yes|1) return 0;; *) return 1;; esac; }

fetch() { # fetch URL DEST
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then wget -q -O "$2" "$1"
  else die "need curl or wget"; fi
}

say "${B}hamyad${N} ${D}· one shared brain for every AI tool · https://mrzroot.github.io/hamyad/${N}"

# ------------------------------------------------------------------ 1. Node.js
node_ok() { # node_ok /path/to/node
  [ -x "$1" ] || return 1
  v=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$v" -ge 20 ] 2>/dev/null
}
NODE=""
if [ "${HAMYAD_NODE:-}" != "portable" ] && command -v node >/dev/null 2>&1 && node_ok "$(command -v node)"; then
  NODE="$(command -v node)"
  step "Using Node.js $("$NODE" -v) ($NODE)"
elif node_ok "$HOME_DIR/node/bin/node"; then
  NODE="$HOME_DIR/node/bin/node"
  step "Using portable Node.js $("$NODE" -v)"
else
  os=$(uname -s); arch=$(uname -m)
  case "$os" in Linux) os=linux;; Darwin) os=darwin;; *) die "unsupported OS $os (on Windows use: irm https://mrzroot.github.io/hamyad/install.ps1 | iex)";; esac
  case "$arch" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; armv7l) arch=armv7l;; *) die "unsupported CPU $arch";; esac
  step "Node.js 20+ not found: downloading portable Node.js v$NODE_VERSION ($os-$arch) into $HOME_DIR/node"
  command -v tar >/dev/null 2>&1 || die "need tar"
  tmp=$(mktemp -d)
  name="node-v$NODE_VERSION-$os-$arch"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/$name.tar.gz" "$tmp/node.tgz" || die "could not download Node.js (check your connection or install Node 20+ yourself)"
  if fetch "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" "$tmp/SHASUMS256.txt" 2>/dev/null; then
    want=$(grep " $name.tar.gz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
    if command -v sha256sum >/dev/null 2>&1; then got=$(sha256sum "$tmp/node.tgz" | cut -d' ' -f1); else got=$(shasum -a 256 "$tmp/node.tgz" | cut -d' ' -f1); fi
    [ -n "$want" ] && [ "$want" = "$got" ] || die "Node.js checksum mismatch"
    say "  ${D}checksum ok${N}"
  fi
  mkdir -p "$HOME_DIR"
  rm -rf "$HOME_DIR/node"
  tar -xzf "$tmp/node.tgz" -C "$tmp"
  mv "$tmp/$name" "$HOME_DIR/node"
  rm -rf "$tmp"
  NODE="$HOME_DIR/node/bin/node"
  node_ok "$NODE" || die "portable Node.js does not run on this system"
fi
NODE_BIN_DIR=$(dirname "$NODE")
NPM="$NODE_BIN_DIR/npm"
[ -x "$NPM" ] || NPM=$(command -v npm || true)
[ -n "$NPM" ] || die "npm not found next to $NODE"

# ------------------------------------------------------------------ 2. hamyad
if [ -n "${HAMYAD_TARBALL:-}" ]; then SRC="$HAMYAD_TARBALL"
elif [ -n "${HAMYAD_VERSION:-}" ]; then SRC="https://github.com/$REPO/releases/download/$HAMYAD_VERSION/hamyad.tgz"
else SRC="https://github.com/$REPO/releases/latest/download/hamyad.tgz"; fi
step "Installing hamyad from ${SRC}"
mkdir -p "$HOME_DIR/cli"
NPM_CONFIG_UPDATE_NOTIFIER=false PATH="$NODE_BIN_DIR:$PATH" "$NPM" install --prefix "$HOME_DIR/cli" --global --no-fund --no-audit --loglevel=error "$SRC" >/dev/null \
  || die "npm install failed"
HAMYAD_JS="$HOME_DIR/cli/lib/node_modules/hamyad/dist/src/cli.js"
[ -f "$HAMYAD_JS" ] || die "install finished but $HAMYAD_JS is missing"

# launcher that always uses the right Node, even if PATH has an older one
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/hamyad" <<LAUNCH
#!/bin/sh
exec "$NODE" "$HAMYAD_JS" "\$@"
LAUNCH
chmod +x "$BIN_DIR/hamyad"
say "  ${G}✓${N} hamyad $("$BIN_DIR/hamyad" --version) → $BIN_DIR/hamyad"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    line="export PATH=\"$BIN_DIR:\$PATH\""
    for rc in "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc"; do
      { [ -f "$rc" ] || [ "$rc" = "$HOME/.profile" ]; } || continue
      grep -qs "$BIN_DIR" "$rc" 2>/dev/null || printf '\n# added by the hamyad installer\n%s\n' "$line" >> "$rc"
    done
    say "  ${Y}!${N} added $BIN_DIR to PATH in your shell profile; open a new terminal (or run: $line)"
    ;;
esac
export PATH="$BIN_DIR:$PATH"

# ------------------------------------------------------------------ 3. set up the project
if [ "${HAMYAD_NO_SETUP:-0}" = "1" ]; then
  say ""; say "Done. In any project run:  ${B}hamyad setup${N}"; exit 0
fi
DIR="${HAMYAD_DIR:-$PWD}"
phys() { (cd "$1" 2>/dev/null && pwd -P) || printf '%s' "$1"; }
if [ "$(phys "$DIR")" = "$(phys "$HOME")" ] || [ "$(phys "$DIR")" = "/" ]; then
  if [ "$YES" = "1" ] || [ -z "$TTY" ]; then
    say ""; say "Installed. You are in $DIR, not a project: cd into a project and run  ${B}hamyad setup${N}"; exit 0
  fi
  DIR=$(ask "Which project folder should hamyad set up? (path, empty = skip):" "")
  [ -n "$DIR" ] || { say "Installed. Run  hamyad setup  inside a project any time."; exit 0; }
fi
case "$DIR" in "~"*) DIR="$HOME${DIR#\~}";; esac
[ -d "$DIR" ] || die "no such folder: $DIR"
DIR=$(cd "$DIR" && pwd)
if [ "$YES" != "1" ]; then
  a=$(ask "Set up hamyad for every AI tool in ${B}$DIR${N}? [Y/n]" "y")
  is_yes "$a" || { say "Skipped. Run  hamyad setup  inside a project any time."; exit 0; }
fi
cd "$DIR"
step "hamyad setup in $DIR"
# shellcheck disable=SC2086
if [ -n "$TTY" ]; then exec "$BIN_DIR/hamyad" setup --init ${HAMYAD_SETUP_ARGS:-} </dev/tty
else exec "$BIN_DIR/hamyad" setup --init -y ${HAMYAD_SETUP_ARGS:---no-chat}; fi
