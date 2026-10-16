import json
from drive_fake import *

GIS = """
window.__gis = { mode: sessionStorage.getItem('gm') || 'ok', calls: [] };
window.google = { accounts: { oauth2: { initTokenClient: function (cfg) { return { requestAccessToken: function (o) {
  window.__gis.calls.push(o.prompt);
  setTimeout(function () {
    if (window.__gis.mode === 'ok') cfg.callback({ access_token: 'tok', expires_in: 3600 });
    else if (window.__gis.mode === 'denied') cfg.callback({ error: 'access_denied' });
    else if (o.prompt === 'none') cfg.error_callback({ type: 'popup_failed_to_open' });
    else cfg.callback({ access_token: 'tok', expires_in: 3600 });
  }, 10); } }; } } } };
"""

def web_device(p, client_id="test.apps.googleusercontent.com"):
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1200, "height": 800}); errs = []
    if client_id: ctx.add_init_script(f"window.WEB_CLIENT_ID = '{client_id}';")
    ctx.add_init_script(GIS)
    ctx.route("https://www.googleapis.com/**", drive_route)
    ctx.route("https://accounts.google.com/**", lambda r: r.fulfill(status=200, content_type="application/javascript", body="/* stub */"))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_function("window.DB && window.Sync"); pg.wait_for_timeout(800)
    if pg.locator("#onboardModal").is_visible(): pg.click("#obSkip")
    return br, pg, errs

def open_settings(pg):
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(500)

with sync_playwright() as p:
    # 클라이언트 ID가 없으면 숨김
    br0, pg0, e0 = web_device(p, client_id="")
    open_settings(pg0)
    ok(pg0.locator("#driveConnect").is_hidden() and "아직" in pg0.text_content("#driveStatus"), f"웹 클라이언트 ID가 없으면 연결 버튼이 숨겨짐: {pg0.text_content('#driveStatus')[:50]!r}")
    br0.close()

    # 앱(폰)이 올린 데이터를 웹이 받는다
    A_br, A, errsA = device(p)
    A.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'폰에서 만든 할일'})})")
    ok(sync(A) == "ok", "폰 앱 연결")
    W_br, W, errsW = web_device(p)
    open_settings(W)
    ok(W.locator("#driveConnect").is_visible(), "웹: 구글 계정 연결 버튼 표시")
    W.click("#driveConnect"); W.wait_for_timeout(1500)
    ok(W.evaluate("Settings.get('driveOn')") is True and "폰에서 만든 할일" in json.dumps(W.evaluate("DB.all('tasks')"), ensure_ascii=False), "웹: 연결하면 폰의 데이터를 받음")
    ok(W.evaluate("window.__gis.calls[0]") == "", "첫 연결은 로그인 창을 띄움(prompt 기본)")
    W.click("#settingsClose")
    # 웹에서 만든 데이터가 폰으로
    W.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'PC에서 만든 할일'})})"); W.evaluate("Sync.flush()"); W.wait_for_timeout(1000)
    sync(A)
    ok("PC에서 만든 할일" in json.dumps(A.evaluate("DB.all('tasks')"), ensure_ascii=False), "웹에서 만든 할일이 폰에 반영")
    # 토큰이 살아 있는 동안은 재로그인 없이 동기화
    n = len(W.evaluate("window.__gis.calls")); W.evaluate("Sync.run()"); W.wait_for_timeout(500)
    ok(len(W.evaluate("window.__gis.calls")) == n, "토큰이 유효하면 다시 로그인하지 않음")
    # 새로고침(토큰 소멸) 후: 조용히 재인증 시도 -> 실패하면 안내, 버튼으로 복구
    W.evaluate("sessionStorage.setItem('gm', 'silentfail')"); W.reload(); W.wait_for_function("window.DB && window.Sync"); W.wait_for_timeout(1500)
    if W.locator("#onboardModal").is_visible(): W.click("#obSkip")
    ok(W.evaluate("Settings.get('driveErr') && Settings.get('driveErr').code") == "NEED_CONSENT", "조용한 재인증이 막히면 '다시 연결 필요'로 표시")
    W.evaluate("window.__gis = { mode: 'silentfail', calls: [] }")
    open_settings(W)
    ok("다시 연결" in W.text_content("#driveStatus") or "연결이 필요" in W.text_content("#driveStatus"), f"설정에 안내: {W.text_content('#driveStatus')[:80]!r}")
    W.click("#driveNow"); W.wait_for_timeout(1500)
    ok(W.evaluate("window.__gis.calls") == [""] and W.evaluate("Settings.get('driveErr')") is None, f"'지금 동기화'를 누르면 로그인 창으로 복구: {W.evaluate('window.__gis.calls')}")
    # 사용자가 취소
    W.evaluate("window.__gis.mode = 'denied'; Settings.set('driveErr', null)")
    ok(not errsA and not errsW, f"자바스크립트 오류 없음 {errsA} {errsW}")
    A_br.close(); W_br.close()
finish()
