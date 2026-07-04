#!/usr/bin/env bash
# Запуск «Фабрики гипотез» одной командой: бэкенд + фронтенд.
# Использование: ./start.sh   (остановка: Ctrl+C)
set -euo pipefail
cd "$(dirname "$0")"

# --- бэкенд ---------------------------------------------------------------
if [ ! -d backend/.venv ]; then
  echo "[setup] создаю виртуальное окружение и ставлю зависимости…"
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements.txt
fi

echo "[run] бэкенд: http://localhost:8000"
(cd backend && .venv/bin/uvicorn app.main:app --port 8000) &
BACK_PID=$!

# --- фронтенд ---------------------------------------------------------------
if [ ! -d frontend/node_modules ]; then
  echo "[setup] ставлю npm-зависимости…"
  (cd frontend && npm install --no-fund --no-audit)
fi

echo "[run] фронтенд: http://localhost:5173"
(cd frontend && npm run dev) &
FRONT_PID=$!

trap 'echo; echo "[stop] останавливаю…"; kill $BACK_PID $FRONT_PID 2>/dev/null' EXIT
wait
