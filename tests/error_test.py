import json
from common import *

state = {"mode": "ok"}
def handler(model, body):
    m = state["mode"]
    if m == "badkey": return (400, {"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT", "details": [{"reason": "API_KEY_INVALID"}]}})
    if m == "429": return (429, {"error": {"code": 429, "message": "quota", "status": "RESOURCE_EXHAUSTED"}})
    if m == "fallback": return (503, {"error": {"code": 503, "message": "overloaded", "status": "UNAVAILABLE"}}) if model == "gemini-3.5-flash-lite" else "OK"
    return "OK"

with sync_playwright() as p:
    for size in ("cover", "inner"):
        br, ctx, pg, errs = open_app(p, size, key=False, handler=handler)
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()")
        if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
        pg.click("#obSkip") if pg.locator("#onboardModal").is_visible() else None
        # 키 없음
        pg.fill("#userNotes", "메모"); pg.click("#aiBtn"); pg.wait_for_timeout(600)
        ok("키가 설정되지" in pg.text_content("#aiStatus"), f"{size}: 키 없으면 안내 문구 {pg.text_content('#aiStatus')!r}")
        ok(pg.locator(".toast, #toast").filter(has_text="설정 열기").count() >= 1, f"{size}: 토스트에 '설정 열기' 동작이 있음")
        # 설정에서 잘못된 키
        state["mode"] = "badkey"
        pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.fill("#keyInput", "AIzaBADBADBADBADBADBAD"); pg.click("#keySave"); pg.wait_for_timeout(1500)
        ok("올바르지 않" in pg.text_content("#keyStatus"), f"{size}: 잘못된 키 안내 {pg.text_content('#keyStatus')!r}")
        ok(pg.evaluate("Settings.get('apiKey')") is None, f"{size}: 잘못된 키는 저장되지 않음")
        # 올바른 키
        state["mode"] = "ok"
        pg.fill("#keyInput", "AIzaGOODGOODGOODGOODGOODGOOD0000"); pg.click("#keySave"); pg.wait_for_timeout(1500)
        ok(pg.evaluate("Settings.get('apiKey')") == "AIzaGOODGOODGOODGOODGOODGOOD0000", f"{size}: 올바른 키 저장")
        ok("●●●●" in pg.text_content("#keyStatus") and "GOOD0000"[-4:] in pg.text_content("#keyStatus"), f"{size}: 키는 마지막 4자리만 표시")
        pg.fill("#profileInput", "반도체 설비 엔지니어"); pg.dispatch_event("#profileInput", "change"); pg.wait_for_timeout(300)
        ok(pg.evaluate("Settings.get('profile')") == "반도체 설비 엔지니어", f"{size}: 직무 설명 저장")
        # 프롬프트에 직무가 반영되는지
        ok("반도체 설비 엔지니어" in pg.evaluate("AI.buildStructurePrompt('r', [], '', 'n')"), f"{size}: 직무 설명이 프롬프트에 반영")
        # 모델 폴백(503 -> 다음 모델)
        state["mode"] = "fallback"; GEMINI_CALLS.clear(); AI_ok = pg.evaluate("AI.generate([{text:'hi'}],{purpose:'t'}).then(r=>r.text)")
        ok(AI_ok == "OK" and len({c['model'] for c in GEMINI_CALLS}) >= 2, f"{size}: 503이면 다른 모델로 자동 전환 {[c['model'] for c in GEMINI_CALLS]}")
        # 429
        state["mode"] = "429"
        r = pg.evaluate("AI.generate([{text:'hi'}],{purpose:'t', retries:1}).then(()=>'ok',e=>e.code+':'+e.message)")
        ok("한도" in r or "429" in r or "잠시" in r, f"{size}: 한도 초과 안내 {r!r}")
        # 사용량 화면
        state["mode"] = "ok"
        pg.click("#settingsClose"); pg.wait_for_timeout(300)
        pg.click("#settingsBtn"); pg.click("#menuUsage"); pg.wait_for_timeout(600)
        txt = pg.text_content("#usageBody")
        ok("오늘 요청" in txt and "gemini-" in txt, f"{size}: 사용량 화면 표시")
        ok("실패·거절" in txt, f"{size}: 실패 기록이 사용량에 집계됨")
        pg.screenshot(path=f"{SHOTS}/usage_{size}.png")
        ok(not errs, f"{size}: 자바스크립트 오류 없음 {errs}")
        br.close()

    # 첫 실행 안내 -> 키 입력 -> 시작
    state["mode"] = "ok"
    br, ctx, pg, errs = open_app(p, "cover", key=False, handler=handler)
    ok(pg.locator("#onboardModal").is_visible(), "첫 실행 안내 표시")
    pg.fill("#obKey", "AIzaONBOARDONBOARDONBOARD0000"); pg.wait_for_timeout(100)
    ok(pg.locator("#obOk").is_disabled(), "동의 체크 전에는 시작 불가")
    pg.check("#obAgree"); pg.fill("#obProfile", "영업 사원"); ok(not pg.locator("#obOk").is_disabled(), "동의+키 입력하면 시작 가능")
    pg.click("#obOk"); pg.wait_for_timeout(1500)
    ok(not pg.locator("#onboardModal").is_visible() and pg.evaluate("Settings.get('apiKey')") == "AIzaONBOARDONBOARDONBOARD0000" and pg.evaluate("Settings.get('profile')") == "영업 사원", "시작하면 키·직무 저장되고 닫힘")
    pg.reload(); pg.wait_for_function("window.DB"); pg.wait_for_timeout(1200)
    ok(not pg.locator("#onboardModal").is_visible(), "다시 열어도 안내가 반복되지 않음")
    br.close()
finish()
