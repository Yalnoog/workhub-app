import json
from common import *

AI_PEOPLE = ["박OO", "김OO"]
def handler(model, body):
    txt = json.dumps(body, ensure_ascii=False)
    if "agenda" in txt:
        return json.dumps({"title": "AI 제목", "project": "", "summary": "요약", "participants": AI_PEOPLE, "agenda": ["안건"], "discussion": "논의", "decisions": [], "actionItems": []}, ensure_ascii=False)
    return "{}"

def open_composer(pg):
    pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()"); pg.wait_for_timeout(400)
    if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
    pg.wait_for_timeout(200)

with sync_playwright() as p:
    for size in ("cover", "inner"):
        S = size + ": "
        br, ctx, pg, errs = open_app(p, size, handler=handler)
        open_composer(pg)
        ok(pg.locator("#mParticipants").is_visible(), S + "참석자 입력 칸이 AI 정리 전에도 기본으로 보임")
        box = pg.locator("#mParticipants").bounding_box()
        ok(box["x"] >= 0 and box["x"] + box["width"] <= SIZES[size][0] + 1, S + "입력 칸이 화면 안")
        wt, wp = pg.locator("#mTitle").bounding_box()["width"], pg.locator("#mParticipants").bounding_box()["width"]
        ok(abs(wt - wp) <= 2, S + f"참석자 칸 폭이 회의명 칸과 같음 ({round(wt)} / {round(wp)}px)")
        order = pg.evaluate("""() => { const ids = ['mTitle','mDate','mKind','mParticipants','userNotes','rawNotes']; const y = ids.map(i => document.getElementById(i).getBoundingClientRect().top + window.scrollY); return ids.filter((_, i) => i === 0 || true).map((id, i) => [id, Math.round(y[i])]); }""")
        pg.screenshot(path=f"{SHOTS}/participants_{size}.png")

        # 임시저장: 새로고침해도 유지
        pg.fill("#mParticipants", "김OO, 이OO"); pg.fill("#userNotes", "메모 내용"); pg.wait_for_timeout(700)
        pg.reload(); pg.wait_for_function("window.DB && window.Settings"); pg.wait_for_timeout(900)
        if pg.locator("#onboardModal").is_visible(): pg.click("#obSkip")
        open_composer(pg)
        ok(pg.input_value("#mParticipants") == "김OO, 이OO", S + "참석자 입력이 임시저장되어 새로고침 후에도 남음")

        # AI 정리: 프롬프트에 참석자 전달 + 결과 병합(사용자 입력이 앞)
        GEMINI_CALLS.clear()
        pg.click("#aiBtn"); pg.wait_for_selector("#saveRow:not([hidden])", timeout=8000)
        prompt = json.dumps(GEMINI_CALLS[-1]["body"], ensure_ascii=False)
        ok("김OO" in prompt and "이OO" in prompt and "참석자는 사용자가 이미 입력했습니다" in prompt, S + "AI 요청에 입력한 참석자가 전달됨")
        val = pg.evaluate("document.querySelector('#preview [data-f=participants]').value")
        ok(val == "김OO, 이OO, 박OO", S + f"미리보기 참석자 = 입력 + AI가 추가로 찾은 이름(중복 제거): {val!r}")
        # 저장
        pg.click("#saveMeetingBtn"); pg.wait_for_timeout(1000)
        m = pg.evaluate("DB.all('meetings')[0]")
        ok(m["participants"] == ["김OO", "이OO", "박OO"], S + f"저장된 회의록의 참석자: {m['participants']}")
        ok(pg.input_value("#mParticipants") == "", S + "저장하면 참석자 입력 칸이 비워짐")
        ok(pg.evaluate("Settings.get('draft')") is None, S + "저장 후 임시저장도 삭제")

        # 참석자를 안 적으면 AI 결과만
        open_composer(pg)
        pg.fill("#userNotes", "두번째 메모"); pg.click("#aiBtn"); pg.wait_for_selector("#saveRow:not([hidden])", timeout=8000)
        prompt = json.dumps(GEMINI_CALLS[-1]["body"], ensure_ascii=False)
        ok("참석자는 사용자가 이미 입력했습니다" not in prompt, S + "비워 두면 참석자 안내 문구가 프롬프트에 없음")
        ok(pg.evaluate("document.querySelector('#preview [data-f=participants]').value") == "박OO, 김OO", S + "비워 두면 AI가 찾은 이름만")
        ok(not errs, S + f"자바스크립트 오류 없음 {errs}")
        br.close()
finish()
