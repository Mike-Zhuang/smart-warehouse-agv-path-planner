#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  kill "${BACKEND_PID:-}" "${FRONTEND_PID:-}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cmake -S cpp_core -B cpp_core/build
cmake --build cpp_core/build

python3 -m uvicorn backend.app:app --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
npm --prefix frontend run dev &
FRONTEND_PID=$!

echo "本地服务已启动：http://127.0.0.1:5173"
wait

