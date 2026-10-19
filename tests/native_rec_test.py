import json
from common import *

fail = {"on": False}
def handler(model, body):
    if "inline_data" in json.dumps(body):
        if fail["on"]: return (503, {"error": {"code": 503, "message": "x", "status": "UNAVAILABLE"}})
        return "조각텍스트"
    return "OK"

with sync_playwright() as p:
    br, ctx, pg, errs = open_app(p, "cover", handler=handler)
    ctx.route("https://native.test/**", lambda r: r.fulfill(status=200, headers={"content-type": "audio/mp4", "access-control-allow-origin": "*"}, body=b"\x00" * 3000))
    pg.evaluate("AI.cfg.sleep = () => Promise.resolve()")
    pg.evaluate("""() => {
      window.__files = []; window.__rec = false;
      window.Capacitor = { isNativePlatform: () => true, convertFileSrc: (u) => 'https://native.test/' + encodeURIComponent(u), Plugins: { WorkhubRecorder: {
        start: async (o) => { window.__rec = true; window.__seg = o.segmentSec; return { recording: true, startedAt: Date.now() }; },
        stop: async () => { window.__rec = false; window.__files.push({ name: 'rec_9.m4a', path: '/data/rec_9.m4a', size: 3000 }); },
        status: async () => ({ recording: window.__rec, startedAt: Date.now() - 5000 }),
        pending: async () => ({ files: window.__files.slice() }),
        remove: async (o) => { window.__files = window.__files.filter(f => f.name !== o.name); return { removed: true }; },
      } } };
    }""")
    pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()")
    if not pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
    pg.click("#recBtn"); pg.wait_for_timeout(500)
    ok(pg.evaluate("window.__rec") is True and pg.evaluate("window.__seg") == 600, "네이티브 녹음 시작(조각 600초)")
    ok(pg.locator("#recBtn.recording").count() == 1 and "녹음 중... 10분마다 글로 변환되어 메모에 추가됩니다. 화면을 꺼도 계속됩니다." in pg.text_content("#recStatus"), f"녹음 중 안내: {pg.text_content('#recStatus')[:70]!r}")
    PULL = """async ([x, y0, y1]) => { const tgt = document.elementFromPoint(x, y0) || document.body;
      const mk = (type, y, end) => { const t = new Touch({ identifier: 1, target: tgt, clientX: x, clientY: y }); return new TouchEvent(type, { touches: end ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }); };
      tgt.dispatchEvent(mk('touchstart', y0)); for (let i = 1; i <= 8; i++) { tgt.dispatchEvent(mk('touchmove', y0 + (y1 - y0) * i / 8)); await new Promise(r => setTimeout(r, 16)); }
      const label = document.getElementById('ptr') && !document.getElementById('ptr').hidden ? document.getElementById('ptr').textContent : '';
      tgt.dispatchEvent(mk('touchend', y1, true)); return label; }"""
    lab = pg.evaluate(PULL, [200, 100, 260]); pg.wait_for_timeout(300)
    ok("녹음 중" in lab and "화면을 꺼도" in pg.text_content("#recStatus"), f"네이티브 녹음 중에는 당겨서 새로고침 제외: {lab!r}")
    # 화면이 없는 사이 조각이 쌓인 상황
    pg.evaluate("window.__files.push({name:'rec_1.m4a', path:'/data/rec_1.m4a', size:3000}, {name:'rec_2.m4a', path:'/data/rec_2.m4a', size:3000})")
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("window.__files.length") == 0 and pg.evaluate("document.getElementById('rawNotes').value").count("조각텍스트") == 2, "쌓인 조각이 변환돼 메모에 붙고 파일이 지워짐")
    pg.click("#recBtn"); pg.wait_for_timeout(2500)
    ok(pg.evaluate("window.__rec") is False and pg.evaluate("document.getElementById('rawNotes').value").count("조각텍스트") == 3, "종료하면 마지막 조각도 변환")
    ok("변환 완료" in pg.text_content("#recStatus"), "종료 후 상태")
    # 실패하면 파일 보관 + 다시 변환
    fail["on"] = True
    pg.evaluate("window.__files.push({name:'rec_5.m4a', path:'/data/rec_5.m4a', size:3000})")
    pg.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("window.__files.length") == 1 and "다시 변환" in pg.text_content("#recStatus"), "변환 실패 시 파일을 보관하고 재시도 안내")
    fail["on"] = False; pg.click("#retryNative"); pg.wait_for_timeout(1500)
    ok(pg.evaluate("window.__files.length") == 0 and pg.evaluate("document.getElementById('rawNotes').value").count("조각텍스트") == 4, "다시 변환 성공")
    # 키 없으면 시작 거부
    pg.evaluate("Settings.remove('apiKey')"); pg.click("#recBtn"); pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__rec") is False, "API 키 없으면 녹음 시작 안 함")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    br.close()
finish()
