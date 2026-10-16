#!/usr/bin/env bash
# 독립형 앱 테스트: www/ 를 임시 정적 서버로 띄우고 Playwright 컨테이너에서 실행. Gemini는 모두 모의(mock) 응답을 쓴다.
# 사용법: bash tests/run.sh [테스트파일...]   (없으면 전체)
set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PW=mcr.microsoft.com/playwright/python:v1.63.0-jammy
SHOTS="${SHOTS:-$ROOT/tests/shots}"; mkdir -p "$SHOTS"
if [ "$#" -gt 0 ]; then TESTS="$*"; else TESTS=$(cd tests && ls *_test.py | tr '\n' ' '); fi
FAIL=0
CMDS=""
for t in $TESTS; do CMDS="$CMDS echo \"=== $t\"; python /app/tests/$t || FAIL=1;"; done
docker run --rm --network host -e TZ=Asia/Seoul -e WH_BASE=http://127.0.0.1:10077 -e SHOTS=/shots \
  -v "$ROOT":/app:ro -v "$SHOTS":/shots --ipc=host "$PW" \
  bash -c "pip install -q playwright==1.63.0 2>&1 | grep -v WARNING; (cd /app/www && python -m http.server 10077 --bind 127.0.0.1 >/dev/null 2>&1 &); sleep 1; cd /app/tests; FAIL=0; $CMDS exit \$FAIL"
