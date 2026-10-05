#!/bin/bash
# 이 맥북의 Devotio 볼트에 플러그인을 "심볼릭 링크"로 설치합니다.
# 복사가 아니므로, 이 폴더의 main.js를 고치면 볼트에도 바로 반영됩니다.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT_PLUGINS_DIR="$HOME/Documents/Devotio/.obsidian-apple/plugins"
DEST_DIR="$VAULT_PLUGINS_DIR/devotio-bible-navigator"

mkdir -p "$VAULT_PLUGINS_DIR"

if [ -e "$DEST_DIR" ] && [ ! -L "$DEST_DIR" ]; then
  echo "이미 폴더(심볼릭 링크 아님)가 있습니다: $DEST_DIR"
  echo "직접 확인하고 지운 뒤 다시 실행해 주세요. 자동으로 지우지 않습니다."
  exit 1
fi

ln -sfn "$SRC_DIR" "$DEST_DIR"
echo "설치 완료: $DEST_DIR -> $SRC_DIR"
echo "Obsidian에서 설정 > 커뮤니티 플러그인 > '성경 찾아가기'를 켜 주세요."
