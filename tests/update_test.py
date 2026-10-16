import json
from common import *

REL = {"tag_name": "v0.2.0", "assets": [{"name": "workhub-v0.2.0.apk", "browser_download_url": "https://github.com/Yalnoog/workhub-app/releases/download/v0.2.0/workhub-v0.2.0.apk"}]}
calls = {"gh": 0}

def gh(r):
    calls["gh"] += 1
    r.fulfill(status=200, headers={"access-control-allow-origin": "*", "content-type": "application/json"}, body=json.dumps(REL))

FAKE = """(cur) => { window.__inst = []; window.Capacitor = { isNativePlatform: () => true, Plugins: { WorkhubUpdate: {
  version: async () => ({ versionName: cur }),
  addListener: async (n, f) => { window.__pf = f; return { remove: () => {} }; },
  install: async (o) => { window.__inst.push(o.url); window.__pf && window.__pf({ percent: 50 }); if (window.__needPerm) { const e = new Error('p'); e.code = 'NEED_PERMISSION'; throw e; } },
} } }; }"""

with sync_playwright() as p:
    br, ctx, pg, errs = open_app(p, "cover")
    ctx.route("https://api.github.com/**", gh)
    # 버전 비교
    r = pg.evaluate("[Updater.cmp('0.1.1','v0.2.0'), Updater.cmp('v0.2.0','0.2.0'), Updater.cmp('0.10.0','0.9.0'), Updater.cmp('1.0','0.9.9')]")
    ok(r == [-1, 0, 1, 1], f"버전 비교 {r}")
    ok(pg.evaluate("Updater.available()") is False and pg.locator("#updateBanner").is_hidden(), "브라우저에서는 업데이트 확인을 하지 않음")
    pg.evaluate(FAKE, "v0.1.1")
    pg.evaluate("Settings.remove('updChecked')")
    pg.evaluate("window.__r = Updater.check(false)"); pg.wait_for_timeout(500)
    ok(calls["gh"] == 1 and pg.evaluate("Updater.latest.version") == "0.2.0" and pg.evaluate("Updater.latest.current") == "0.1.1", "새 버전을 감지")
    # 열 때마다 확인하되 1분 안의 중복 호출은 한 번만
    pg.evaluate("Updater.check(false)"); pg.wait_for_timeout(300)
    ok(calls["gh"] == 1, "1분 안의 중복 호출은 조회하지 않음")
    pg.evaluate("Settings.set('updChecked', Date.now() - 120000)"); pg.evaluate("Updater.check(false)"); pg.wait_for_timeout(400)
    ok(calls["gh"] == 2, "1분이 지나면 열 때마다 다시 확인")
    pg.evaluate("Promise.all([Updater.check(true), Updater.check(true)])"); pg.wait_for_timeout(500)
    ok(calls["gh"] == 3, f"동시에 두 번 불려도 조회는 한 번 ({calls['gh']})")
    # 화면: 배너 + 업데이트 실행
    pg.reload(); pg.wait_for_function("window.DB"); pg.evaluate(FAKE, "v0.1.1"); pg.evaluate("Settings.remove('updChecked')")
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(800)
    ok(pg.locator("#updateBanner").is_visible() and "0.2.0" in pg.text_content("#updateText"), f"배너 표시: {pg.text_content('#updateText')!r}")
    pg.screenshot(path=f"{SHOTS}/update_banner.png")
    pg.click("#updateGo"); pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__inst") == [REL["assets"][0]["browser_download_url"]], "업데이트 버튼 → APK 주소로 설치 요청")
    ok("설치 화면" in pg.text_content("#updateText"), "설치 화면 안내 문구")
    # 설치 허용 필요
    pg.evaluate("window.__needPerm = true"); pg.click("#updateGo"); pg.wait_for_timeout(500)
    ok(pg.locator(".toast").filter(has_text="출처 허용").count() == 1, "설치 허용이 필요하면 안내")
    # 나중에
    pg.click("#updateLater"); ok(pg.locator("#updateBanner").is_hidden(), "'나중에'로 배너 닫힘")
    # 최신이면 배너 없음
    REL["tag_name"] = "v0.1.1"; pg.evaluate("Settings.remove('updChecked')"); pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(600)
    ok(pg.locator("#updateBanner").is_hidden(), "최신 버전이면 배너 없음")
    # 설정 > 업데이트 확인 버튼
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(300)
    ok(pg.locator("#updCheck").is_visible(), "설정에 업데이트 확인 버튼(앱에서만)")
    pg.wait_for_timeout(300)
    ok("v0.1.1" in pg.text_content("#appInfo"), f"앱 정보에 실제 설치 버전 표시: {pg.text_content('#appInfo')[:30]!r}")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    br.close()
finish()
