from drive_fake import *

LN = """() => { window.__ln = []; window.Capacitor.Plugins.LocalNotifications = {
  checkPermissions: async () => ({ display: 'granted' }),
  schedule: async (o) => { window.__ln = window.__ln.concat(o.notifications); },
  getPending: async () => ({ notifications: [] }), cancel: async () => {}, createChannel: async () => {}, requestPermissions: async () => ({ display: 'granted' }) }; }"""

def open_settings(pg):
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(900)

with sync_playwright() as p:
    A_br, A, errs = device(p)
    A.evaluate(LN)
    A.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'용량 테스트'})})")
    ok(sync(A) == "ok", "연결"); A.evaluate("Settings.set('driveOn', true)")
    open_settings(A)
    txt = A.text_content("#qTotalText"); at = A.text_content("#qAppText")
    ok("15.0GB 중 4.2GB 사용 (28%)" in txt, f"계정 전체 사용률 표시: {txt!r}")
    ok("이 앱" in at and "KB" in at or "B (" in at, f"이 앱 사용량 표시: {at!r}")
    ok(A.evaluate("getComputedStyle(document.getElementById('qBar')).display") != "none" and A.locator("#quotaBanner").is_hidden(), "80% 미만이면 경고 없음")
    A.screenshot(path=f"{SHOTS}/quota_ok.png")
    A.click("#settingsClose"); A.wait_for_timeout(300)
    # 80% 이상: 배너 + 알림(하루 한 번)
    DRIVE["about"]["usage"] = str(int(12.5 * GB))
    A.evaluate("Sync.refreshUsage(true)"); A.wait_for_timeout(600)
    ok(A.locator("#quotaBanner").is_visible() and "83%" in A.text_content("#quotaText"), f"80% 이상이면 경고 배너: {A.text_content('#quotaText')!r}")
    ok(len(A.evaluate("window.__ln")) == 1 and "83%" in A.evaluate("window.__ln[0].title"), "저장공간 경고 알림 발송")
    A.screenshot(path=f"{SHOTS}/quota_warn.png")
    A.evaluate("Sync.refreshUsage(true)"); A.wait_for_timeout(500)
    ok(len(A.evaluate("window.__ln")) == 1, "알림은 하루에 한 번만")
    A.click("#quotaClose"); ok(A.locator("#quotaBanner").is_hidden(), "배너 닫기")
    A.evaluate("Sync.refreshUsage(true)"); A.wait_for_timeout(500)
    ok(A.locator("#quotaBanner").is_hidden(), "닫은 날에는 다시 뜨지 않음")
    open_settings(A)
    ok(A.evaluate("document.getElementById('qBar').classList.contains('warn')"), "막대가 경고 색으로 바뀜")
    A.click("#settingsClose"); A.wait_for_timeout(300)
    # 다시 여유가 생기면 배너 사라짐
    DRIVE["about"]["usage"] = str(2 * GB); A.evaluate("Settings.remove('quotaDismiss')"); A.evaluate("Sync.refreshUsage(true)"); A.wait_for_timeout(500)
    ok(A.locator("#quotaBanner").is_hidden(), "사용률이 내려가면 배너 없음")
    # 전체 사용량 권한이 없을 때
    DRIVE["about_status"] = 403; A.evaluate("Sync.refreshUsage(true)"); A.wait_for_timeout(600)
    open_settings(A)
    txt = A.text_content("#qTotalText")
    ok("읽지 못했습니다" in txt and "권한" in txt and "이 앱" in A.text_content("#qAppText"), f"권한이 없으면 사유 표시 + 앱 사용량만: {txt!r}")
    ok(A.locator("#quotaBanner").is_hidden(), "읽지 못하면 경고하지 않음")
    A.screenshot(path=f"{SHOTS}/quota_noperm.png")
    A.click("#settingsClose"); A.wait_for_timeout(300)
    # 용량 제한이 없는 계정
    DRIVE["about_status"] = 200; DRIVE["about"] = {"usage": str(3 * GB)}
    A.evaluate("Sync.refreshUsage(true)"); A.wait_for_timeout(500); open_settings(A)
    ok("제한 없음" in A.text_content("#qTotalText"), f"무제한 계정 표시: {A.text_content('#qTotalText')!r}")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    A_br.close()
finish()
