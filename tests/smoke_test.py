from common import *

with sync_playwright() as p:
    for size in ("cover", "inner"):
        br, ctx, pg, errs = open_app(p, size, key=False)
        ok(pg.locator("#onboardModal").is_visible(), f"{size}: 키가 없으면 첫 실행 안내가 뜬다")
        ok(pg.locator("#obOk").is_disabled(), f"{size}: 동의·키 입력 전에는 시작 버튼 비활성")
        pg.screenshot(path=f"{SHOTS}/onboard_{size}.png")
        pg.click("#obSkip"); pg.wait_for_timeout(300)
        ok(not pg.locator("#onboardModal").is_visible(), f"{size}: '나중에'로 닫힘")
        for tab in ("tasks", "projects", "meetings", "calendar"):
            pg.evaluate("t => document.querySelector('nav.bottom-nav [data-tab=\"'+t+'\"]').click()", tab)
            pg.wait_for_timeout(250)
            ov = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
            ok(ov <= 1, f"{size}/{tab}: 가로 넘침 없음 ({ov}px)")
        pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(300)
        ok(pg.locator("#settingsModal").is_visible(), f"{size}: 설정 창 열림")
        pg.screenshot(path=f"{SHOTS}/settings_{size}.png")
        box = pg.locator("#settingsModal .modal").bounding_box()
        ok(box["x"] >= 0 and box["x"] + box["width"] <= SIZES[size][0] + 1, f"{size}: 설정 창이 화면 안")
        ok(not errs, f"{size}: 자바스크립트 오류 없음 {errs}")
        br.close()
finish()
