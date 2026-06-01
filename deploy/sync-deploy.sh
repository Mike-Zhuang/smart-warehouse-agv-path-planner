#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/smart-warehouse-agv-path-planner
WEB_DIR=/www/wwwroot/agv.mikezhuang.cn
SERVICE_NAME=agv-path-planner.service
REPO_MAIN_REF=refs/heads/main
LOCK_FILE=/tmp/agv-path-planner-sync-deploy.lock
CANDIDATES=(
  https://gh-proxy.com/https://github.com/Mike-Zhuang/smart-warehouse-agv-path-planner.git
  https://gitproxy.click/https://github.com/Mike-Zhuang/smart-warehouse-agv-path-planner.git
  https://github.com/Mike-Zhuang/smart-warehouse-agv-path-planner.git
)

exec 9>"$LOCK_FILE"
flock -n 9 || { echo "[agv-sync] another deploy is running"; exit 0; }

pick_source() {
  local source_url remote_hash
  for source_url in "${CANDIDATES[@]}"; do
    remote_hash=$(timeout 25 git ls-remote "$source_url" "$REPO_MAIN_REF" 2>/dev/null | awk 'NR == 1 { print $1 }')
    if [[ -n "$remote_hash" ]]; then
      echo "$source_url|$remote_hash"
      return 0
    fi
  done
  return 1
}

install_service() {
  install -m 644 "$APP_DIR/deploy/agv-path-planner.service" "/etc/systemd/system/$SERVICE_NAME"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null
}

wait_for_api() {
  local attempt
  for attempt in {1..20}; do
    if curl -fsS http://127.0.0.1:18080/api/health >/dev/null; then
      return 0
    fi
    sleep 1
  done
  systemctl status "$SERVICE_NAME" --no-pager -l || true
  return 1
}

picked=$(pick_source) || { echo "[agv-sync] no reachable gitproxy source"; exit 1; }
REPO_URL="${picked%%|*}"
REMOTE_HASH="${picked##*|}"
echo "[agv-sync] source=$REPO_URL remote=$REMOTE_HASH"

if [[ ! -d "$APP_DIR/.git" ]]; then
  rm -rf "$APP_DIR"
  git clone --depth 1 "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"
git remote set-url origin "$REPO_URL"
LOCAL_HASH=$(git rev-parse HEAD 2>/dev/null || true)
git fetch --depth 1 origin main
FETCH_HASH=$(git rev-parse origin/main)

if [[ "$LOCAL_HASH" == "$FETCH_HASH" ]] \
  && [[ -x "$APP_DIR/cpp_core/build/agv-path-planner" ]] \
  && [[ -x "$APP_DIR/.venv/bin/uvicorn" ]] \
  && [[ -f "$WEB_DIR/index.html" ]] \
  && systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "[agv-sync] no update"
  exit 0
fi

git checkout -B main origin/main
git reset --hard origin/main

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --disable-pip-version-check --quiet -r "$APP_DIR/backend/requirements.txt"

cmake -S "$APP_DIR/cpp_core" -B "$APP_DIR/cpp_core/build"
cmake --build "$APP_DIR/cpp_core/build" --parallel 2
(cd "$APP_DIR/cpp_core/build" && ctest --output-on-failure)

npm --prefix "$APP_DIR/frontend" ci --no-audit --no-fund --loglevel=error
npm --prefix "$APP_DIR/frontend" run build

install -d "$WEB_DIR"
rsync -a --delete --exclude=.user.ini --exclude=.htaccess "$APP_DIR/frontend/dist/" "$WEB_DIR/"
install_service
systemctl restart "$SERVICE_NAME"
wait_for_api

nginx -t >/dev/null
/www/server/nginx/sbin/nginx -s reload >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1 || true

echo "[agv-sync] deployed $FETCH_HASH"
