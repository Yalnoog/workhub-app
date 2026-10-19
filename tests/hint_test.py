from common import *

IDLE = "10분마다 끊어서 받아쓰기합니다. 글은 10분 단위로 추가됩니다."

with sync_playwright() as p:
    for size in ("cover", "inner"):
        br, ctx, pg, errs = open_app(p, size)
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()")
        if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
        pg.wait_for_timeout(300)
        ok(pg.text_content("#recStatus").strip() == IDLE, f"{size}: 녹음 버튼 옆 안내 문구: {pg.text_content('#recStatus').strip()!r}")
        box = pg.locator("#recStatus").bounding_box()
        ok(box["x"] >= 0 and box["x"] + box["width"] <= SIZES[size][0] + 1, f"{size}: 안내 문구가 화면 안에 들어옴")
        ov = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        ok(ov <= 1, f"{size}: 가로 넘침 없음 ({ov}px)")
        pg.screenshot(path=f"{SHOTS}/rec_hint_{size}.png")
        # 간격 설정이 바뀌면 안내 숫자가 따라감
        pg.evaluate("Settings.set('segmentMin', 5)"); pg.reload(); pg.wait_for_function("window.DB && window.Settings"); pg.wait_for_timeout(900)
        if pg.locator("#onboardModal").is_visible(): pg.click("#obSkip")
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()"); pg.wait_for_timeout(300)
        if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
        pg.wait_for_timeout(200)
        ok("5분마다 끊어서 받아쓰기합니다. 글은 5분 단위로 추가됩니다." in pg.text_content("#recStatus"), f"{size}: 설정값(5분)이 문구에 반영: {pg.text_content('#recStatus').strip()!r}")
        # 웹 녹음 중 문구
        pg.click("#recBtn"); pg.wait_for_timeout(600)
        t = pg.text_content("#recStatus")
        ok("녹음 중... 5분마다 글로 변환되어 메모에 추가됩니다." in t, f"{size}: 녹음 중 문구: {t.strip()[:60]!r}")
        pg.click("#recBtn"); pg.wait_for_timeout(500)
        ok(not errs, f"{size}: 자바스크립트 오류 없음 {errs}")
        br.close()
finish()
