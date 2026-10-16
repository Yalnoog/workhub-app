import json, re
from common import *

STRUCT = {"title": "킥오프 회의", "project": "A라인 개조", "summary": "일정 확정", "participants": ["김대리"], "agenda": ["일정"],
          "discussion": "일정을 논의했다.", "decisions": ["10/30 출하"], "actionItems": [{"text": "견적서 발송", "owner": "김대리", "due": "2030-01-15"}]}

def handler(model, body):
    txt = json.dumps(body, ensure_ascii=False)
    if "inline_data" in txt or "file_data" in txt: return "안녕하세요 회의를 시작하겠습니다"
    if "회의록" in txt and "agenda" in txt: return json.dumps(STRUCT, ensure_ascii=False)
    if "tasks" in txt: return json.dumps({"tasks": [{"title": "견적서 보내기", "due": "2030-01-10", "time": "14:30", "location": "3층 회의실"}]}, ensure_ascii=False)
    return "{}"

with sync_playwright() as p:
    for size in ("cover", "inner"):
        br, ctx, pg, errs = open_app(p, size, handler=handler)
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=tasks]').click()")
        # 1) 자유 입력 -> AI 파싱 -> 할일 생성
        pg.fill("#tTitle", "다음주 금요일 오후 2시반에 견적서 보내기"); pg.click("#taskAddBtn"); pg.wait_for_timeout(800)
        t = pg.evaluate("LocalApi.request('/tasks')")
        t = t if isinstance(t, list) else []
        ok(any(x["title"] == "견적서 보내기" and x["due"] == "2030-01-10" and x["dueTime"] == "14:30" and x["location"] == "3층 회의실" for x in t), f"{size}: 자유 입력이 AI로 파싱돼 할일로 저장됨")
        ok(any(c["key"] == "AIzaTESTKEY00000000" for c in GEMINI_CALLS), f"{size}: 호출에 내 API 키가 쓰임")
        ok("견적서 보내기" in pg.inner_text("#taskList"), f"{size}: 목록에 표시")
        # 2) 새로고침 후에도 유지(IndexedDB)
        pg.reload(); pg.wait_for_function("window.DB && window.DB.all('tasks').length>0"); pg.wait_for_timeout(600)
        ok("견적서 보내기" in pg.inner_text("#taskList"), f"{size}: 새로고침 후 데이터 유지")
        # 3) 회의록 AI 정리 -> 저장 -> 할일 추가
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()"); pg.wait_for_timeout(300)
        if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
        pg.fill("#userNotes", "킥오프 회의 메모"); pg.fill("#rawNotes", "일정을 논의했습니다")
        pg.wait_for_timeout(700)
        ok(pg.evaluate("Settings.get('draft')") is not None, f"{size}: 작성 중 내용이 자동 임시저장됨")
        pg.click("#aiBtn"); pg.wait_for_selector("#saveRow:not([hidden])", timeout=8000)
        pg.screenshot(path=f"{SHOTS}/preview_{size}.png")
        pg.click("#saveMeetingBtn"); pg.wait_for_timeout(1000)
        m = pg.evaluate("LocalApi.request('/meetings')")
        ok(len(m) == 1 and m[0]["project"] == "A라인 개조", f"{size}: 회의록 저장(프로젝트 자동 생성) {[x['title'] for x in m]}")
        t = pg.evaluate("LocalApi.request('/tasks')")
        ok(any(x["title"] == "견적서 발송" and x["category"] == "A라인 개조" for x in t), f"{size}: 액션아이템이 할일로 추가됨")
        ok(pg.evaluate("Settings.get('draft')") is None, f"{size}: 저장 후 임시저장 삭제")
        # 4) 음성 파일 변환
        pg.set_input_files("#audioFile", {"name": "음성 260101.m4a", "mimeType": "audio/mp4", "buffer": b"\x00" * 3000})
        pg.wait_for_function("document.getElementById('rawNotes').value.includes('회의를 시작')", timeout=8000)
        ok("변환 완료" in pg.text_content("#fileStatus"), f"{size}: 음성 파일 받아쓰기 → 메모에 추가")
        # 5) 백업/삭제/복원
        dump = pg.evaluate("JSON.stringify(DB.dump(false))")
        ok("apiKey" not in dump and "AIzaTEST" not in dump, f"{size}: 백업에 API 키가 들어가지 않음")
        pg.evaluate("DB.wipeData()"); pg.reload(); pg.wait_for_function("window.DB"); pg.wait_for_timeout(500)
        ok(pg.evaluate("DB.all('tasks').length") == 0 and pg.evaluate("Settings.get('apiKey')"), f"{size}: 전체 삭제 후에도 키는 유지")
        pg.evaluate("d => DB.restore(JSON.parse(d))", dump)
        ok(pg.evaluate("DB.all('tasks').length") == 2 and pg.evaluate("DB.all('meetings').length") == 1, f"{size}: 백업 복원")
        ok(not errs, f"{size}: 자바스크립트 오류 없음 {errs}")
        br.close()
finish()
