#!/bin/bash
# Aidem pitch show on macOS: double-click. If macOS refuses to open it: open Terminal, type «bash », drag this file
# into the window and press Enter. Finds Node.js 18+ or downloads a portable copy once from nodejs.org (SHA-256 checked).
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
xattr -dr com.apple.quarantine "$HERE" 2>/dev/null
printf '\033]0;Aidem: показ питча (не закрывайте это окно)\007'

node_ok() { [ -n "$1" ] && [ -x "$1" ] && "$1" -e 'process.exit(+process.versions.node.split(".")[0] >= 18 ? 0 : 1)' 2>/dev/null; }
stop() { echo; echo "$1"; echo "Что делать: README.txt, раздел «Если не запускается». Нажмите Enter, чтобы закрыть."; read -r; exit 1; }

DEST="$HOME/Library/Application Support/aidem-pitch"
NODE=""
for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$DEST/node/bin/node"; do
  if node_ok "$c"; then NODE="$c"; break; fi
done
if [ -z "$NODE" ]; then
  echo "Node.js не найден. Скачиваю переносную версию с nodejs.org (около 45 МБ, один раз)…"
  ARCH=$(uname -m); [ "$ARCH" = "arm64" ] || ARCH=x64
  BASE=https://nodejs.org/dist/latest-v22.x
  LINE=$(curl -fsSL "$BASE/SHASUMS256.txt" | grep -E "node-v[0-9.]+-darwin-$ARCH\.tar\.gz$" | head -1)
  [ -n "$LINE" ] || stop "Не удалось открыть nodejs.org: нужен интернет."
  SUM=${LINE%% *}; FILE=${LINE##* }
  mkdir -p "$DEST"
  curl -fL --progress-bar "$BASE/$FILE" -o "$DEST/$FILE" || stop "Node.js не скачался: нужен интернет."
  [ "$(shasum -a 256 "$DEST/$FILE" | cut -d' ' -f1)" = "$SUM" ] || { rm -f "$DEST/$FILE"; stop "Контрольная сумма Node.js не совпала: файл удалён."; }
  rm -rf "$DEST/node"
  tar -xzf "$DEST/$FILE" -C "$DEST" && mv "$DEST/${FILE%.tar.gz}" "$DEST/node"
  rm -f "$DEST/$FILE"
  NODE="$DEST/node/bin/node"
  node_ok "$NODE" || stop "Node.js скачался, но не запускается."
fi
if [ ! -f app/node_modules/playwright-core/package.json ]; then
  echo "Ставлю playwright-core (один раз, нужен интернет)…"
  (cd app && PATH="$(dirname "$NODE"):$PATH" npm install --no-audit --no-fund) || stop "playwright-core не поставился."
fi
"$NODE" app/show.mjs "$@"
CODE=$?
[ $CODE -eq 0 ] || stop "Показ остановился с ошибкой (код $CODE)."
exit 0
