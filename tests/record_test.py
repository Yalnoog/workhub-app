import json
from common import *

mode = {"fail": False, "n": 0}
def handler(model, body):
    if "inline_data" in json.dumps(body):
        if mode["fail"]: return (503, {"error": {"code": 503, "message": "x", "status": "UNAVAILABLE"}})
        mode["n"] += 1
        return "구간%d" % mode["n"]
    return "OK"

with sync_playwright() as p:
    br, ctx, pg, errs = open_app(p, "cover", handler=handler)
    pg.evaluate("AI.cfg.sleep = () => Promise.resolve(); Settings.set('segmentMin', 0.02)")
    pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()")
    if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
    pg.click("#recBtn"); pg.wait_for_timeout(3800)
    ok(pg.locator("#recBtn.recording").count() == 1, "녹음 중 표시")
    pg.click("#recBtn"); pg.wait_for_function("document.getElementById('rawNotes').value.includes('구간2')", timeout=10000)
    v = pg.evaluate("document.getElementById('rawNotes').value")
    ok(v.index("구간1") < v.index("구간2"), f"구간 결과가 순서대로 이어 붙음: {v!r}")
    ok(mode["n"] >= 2, f"짧은 조각으로 나뉘어 여러 번 변환됨 ({mode['n']}회)")
    # 실패 -> 보관 -> 다시 변환
    mode["fail"] = True; pg.evaluate("document.getElementById('rawNotes').value=''")
    pg.click("#recBtn"); pg.wait_for_timeout(1800); pg.click("#recBtn"); pg.wait_for_function("DB.all('segments').length>=1 && document.getElementById('recStatus').textContent.includes('다시 변환')", timeout=30000)
    n = pg.evaluate("DB.all('segments').length")
    ok(n >= 1, f"변환 실패한 녹음 조각이 보관됨 ({n}개)")
    ok("다시 변환" in pg.text_content("#recStatus"), f"실패 안내와 재시도 링크: {pg.text_content('#recStatus')!r}")
    mode["fail"] = False
    pg.click("#retrySegs"); pg.wait_for_function("DB.all('segments').length===0", timeout=15000)
    ok(pg.evaluate("document.getElementById('rawNotes').value").count("구간") >= 1, "다시 변환하면 메모에 들어가고 보관분 삭제")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    br.close()
finish()
