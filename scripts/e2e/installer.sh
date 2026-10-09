#!/bin/sh
# Installer e2e for Linux/macOS (CI and local): runs docs/install.sh the way users do (`cat | sh`)
# in a fresh HOME with NO node on PATH, then interactively through a real pseudo-terminal.
#   usage: scripts/e2e/installer.sh path/to/hamyad.tgz
set -eu
TGZ=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT

# a PATH with every system tool except node/npm, like a clean machine
mkdir -p "$T/bin"
for d in /usr/local/bin /usr/bin /bin /usr/sbin /sbin /opt/homebrew/bin; do
  [ -d "$d" ] || continue
  for f in "$d"/*; do
    b=$(basename "$f")
    case "$b" in node|nodejs|npm|npx|corepack|hamyad) continue;; esac
    [ -e "$T/bin/$b" ] || ln -s "$f" "$T/bin/$b" 2>/dev/null || true
  done
done
CLEAN="HOME=$T/home PATH=$T/bin TERM=dumb"
mkdir -p "$T/home" "$T/proj" "$T/home2" "$T/proj2"
env -i HOME="$T/home" PATH="$T/bin" sh -c 'command -v node' && { echo "node still on PATH"; exit 1; }

echo "== 1. non-interactive: cat install.sh | sh  (HAMYAD_YES=1, no node installed)"
( cd "$T/proj" && git init -q && cat "$ROOT/docs/install.sh" | env -i HOME="$T/home" PATH="$T/bin" HAMYAD_YES=1 HAMYAD_TARBALL="$TGZ" sh )
test -x "$T/home/.hamyad/node/bin/node"
test -x "$T/home/.local/bin/hamyad"
test -f "$T/proj/.brain/config.json"
test -f "$T/proj/.mcp.json" && test -f "$T/proj/.cursor/mcp.json" && test -f "$T/proj/.codex/config.toml" && test -f "$T/proj/.gemini/settings.json"
grep -q '.local/bin' "$T/home/.profile"
V=$(env -i HOME="$T/home" PATH="$T/bin" "$T/home/.local/bin/hamyad" --version)
echo "installed hamyad $V"
( cd "$T/proj" && env -i HOME="$T/home" PATH="$T/home/.local/bin:$T/bin" sh -c 'hamyad add decision "Installer works" >/dev/null && hamyad context | grep -q "Installer works"' )

echo "== 2. re-run is idempotent and reuses the portable Node"
( cd "$T/proj" && cat "$ROOT/docs/install.sh" | env -i HOME="$T/home" PATH="$T/bin" HAMYAD_YES=1 HAMYAD_TARBALL="$TGZ" sh ) > "$T/r2.log" 2>&1
grep -q "Using portable Node.js" "$T/r2.log" || { cat "$T/r2.log"; exit 1; }

echo "== 3. interactive through a pseudo-terminal (questions read from /dev/tty)"
( cd "$T/proj2" && git init -q )
env -i HOME="$T/home2" PATH="$T/bin" TERM=xterm HAMYAD_TARBALL="$TGZ" \
  python3 "$ROOT/scripts/e2e/installer_tty.py" "$ROOT/docs/install.sh" "$T/proj2" \
  'Set up hamyad for every AI tool=y' 'Pre-approve=y' 'Choose \[1-4\]=3' 'Public base URL=https://brain.example.com' 'Open the Claude.ai=n' > "$T/tty.log" 2>&1 || { cat "$T/tty.log"; exit 1; }
grep -q "brain.example.com/mcp/" "$T/tty.log"
grep -q "claude.ai/customize/connectors" "$T/tty.log"
test -f "$T/proj2/.brain/config.json"
test -f "$T/proj2/.claude/settings.local.json" || true

echo "== 4. running from \$HOME without a project only installs"
( cd "$T/home" && cat "$ROOT/docs/install.sh" | env -i HOME="$T/home" PATH="$T/bin" HAMYAD_YES=1 HAMYAD_TARBALL="$TGZ" sh ) > "$T/r4.log" 2>&1
grep -q "cd into a project" "$T/r4.log" || { cat "$T/r4.log"; exit 1; }
test ! -d "$T/home/.brain"
echo "installer e2e: all good"
