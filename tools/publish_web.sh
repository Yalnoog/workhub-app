#!/usr/bin/env bash
# www/ 를 GitHub Pages용 docs/app/ 으로 복사한다(웹 버전 배포). 실행 후 커밋·푸시하면 https://yalnoog.github.io/workhub-app/app/ 에 반영된다.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 tools/patch_index.py >/dev/null
rm -rf docs/app && mkdir -p docs/app && cp -r www/. docs/app/
echo "docs/app 갱신 완료 ($(find docs/app -type f | wc -l)개 파일)"
