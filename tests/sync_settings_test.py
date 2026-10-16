from drive_fake import *

def ui_toggle_key(pg, want):
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(300)
    pg.evaluate("document.getElementById('syncKeyBox').click()"); pg.wait_for_timeout(300)
    pg.click("#cfOk"); pg.wait_for_timeout(1200)
    st = pg.evaluate("document.getElementById('syncKeyBox').checked")
    pg.click("#settingsClose"); pg.wait_for_timeout(300)
    return st

with sync_playwright() as p:
    A_br, A, errsA = device(p)                 # 키 있음
    B_br, B, errsB = device(p, key=False)      # 키 없음
    A.evaluate("Settings.set('apiKey','AIzaSECRETKEY111111')")
    A.evaluate("Settings.set('profile','2차전지 설비 엔지니어')")
    ok(sync(A) == "ok", "A: 연결"); A.evaluate("Settings.set('driveOn', true)")
    ok("2차전지 설비 엔지니어" in DRIVE["body"], "직무 설명이 드라이브에 올라감")
    ok("AIzaSECRET" not in DRIVE["body"], "스위치를 켜기 전에는 API 키가 올라가지 않음")
    ok(sync(B) == "ok", "B: 연결"); B.evaluate("Settings.set('driveOn', true)")
    ok(B.evaluate("Settings.get('profile')") == "2차전지 설비 엔지니어", "B가 직무 설명을 받음")
    ok(B.evaluate("Settings.get('apiKey')") is None, "B에는 키가 오지 않음")
    # 키 동기화 스위치(UI): 연결 전에는 비활성
    C_br, C, errsC = device(p, key=False)
    C.click("#settingsBtn"); C.click("#menuSettings"); C.wait_for_timeout(300)
    ok(C.evaluate("document.getElementById('syncKeyBox').disabled"), "드라이브 연결 전에는 키 동기화 스위치 비활성")
    C_br.close()
    # A가 스위치 켬 -> 키가 올라감
    ok(ui_toggle_key(A, True) is True, "A: 스위치 켜짐")
    ok("AIzaSECRETKEY111111" in DRIVE["body"], "스위치를 켜면 키가 드라이브에 올라감")
    # B는 스위치를 끈 채로는 키를 받지 않음
    sync(B); ok(B.evaluate("Settings.get('apiKey')") is None, "B가 스위치를 켜기 전에는 키를 받지 않음")
    ok("AIzaSECRETKEY111111" in DRIVE["body"], "B가 동기화해도 드라이브의 키가 지워지지 않음")
    # B가 스위치 켬 -> 키 수신
    ok(ui_toggle_key(B, True) is True, "B: 스위치 켜짐")
    ok(B.evaluate("Settings.get('apiKey')") == "AIzaSECRETKEY111111", "B가 A의 키를 받음")
    # 직무 설명 변경이 반대로도 전달
    B.wait_for_timeout(20); B.evaluate("Settings.set('profile','영업 관리')")
    sync(B); sync(A)
    ok(A.evaluate("Settings.get('profile')") == "영업 관리", "B에서 바꾼 직무 설명이 A에 반영")
    # A가 스위치 끔 -> 드라이브에서 키 삭제, B의 키는 유지
    ok(ui_toggle_key(A, False) is False, "A: 스위치 꺼짐")
    ok("AIzaSECRETKEY111111" not in DRIVE["body"], "스위치를 끄면 드라이브에서 키가 지워짐")
    sync(B)
    ok(B.evaluate("Settings.get('apiKey')") == "AIzaSECRETKEY111111", "B의 키는 그대로 남음")
    ok(A.evaluate("Settings.get('apiKey')") == "AIzaSECRETKEY111111", "A의 키도 그대로 남음")
    # 새 기기: 첫 안내가 떠 있다가 키가 넘어오면 닫힘
    ok(ui_toggle_key(A, True) is True, "A: 다시 켬")
    D_br, D, errsD = device(p, key=False, skip=False)
    D.wait_for_timeout(700)
    ok(D.locator("#onboardModal").is_visible(), "새 기기: 첫 안내 표시")
    D.evaluate("Settings.set('syncKey', true)"); r = sync(D); D.evaluate("Settings.set('driveOn', true)"); D.wait_for_timeout(500)
    ok(D.evaluate("Settings.get('apiKey')") == "AIzaSECRETKEY111111" and not D.locator("#onboardModal").is_visible(), f"키가 넘어오면 첫 안내가 닫힘 ({r})")
    # 백업에는 기기 상태(연결 여부 등)가 들어가지 않음
    dump = json.dumps(A.evaluate("DB.dump(false)"))
    ok("driveOn" not in dump and "syncKey" not in dump and "AIzaSECRET" not in dump and "profile" in dump, "백업에는 직무 설명만 포함되고 기기 상태·키는 제외")
    ok(not errsA and not errsB and not errsD, f"자바스크립트 오류 없음 {errsA} {errsB} {errsD}")
    A_br.close(); B_br.close(); D_br.close()
finish()
