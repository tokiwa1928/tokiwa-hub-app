#!/usr/bin/env bash
# HUBDB-1: D1（tokiwa-hub）が無ければ作り、wrangler.toml の database_id を入れる。CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID を使う
set -euo pipefail
cd "$(dirname "$0")"
ID=$(npx --yes wrangler@4 d1 list --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((x.get('uuid') or x.get('id') for x in d if x.get('name')=='tokiwa-hub'),''))" || true)
if [ -z "$ID" ]; then
  echo "D1 tokiwa-hub を作ります"
  npx --yes wrangler@4 d1 create tokiwa-hub >/dev/null
  ID=$(npx --yes wrangler@4 d1 list --json | python3 -c "import sys,json; d=json.load(sys.stdin); print(next((x.get('uuid') or x.get('id') for x in d if x.get('name')=='tokiwa-hub'),''))")
fi
[ -n "$ID" ] || { echo "::error::D1 の ID を取れませんでした"; exit 1; }
sed -i "s/__D1_ID__/$ID/" wrangler.toml
echo "D1 tokiwa-hub: ${ID:0:8}…"
