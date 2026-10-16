import json
from common import *

FAKE = """() => { window.__w = []; window.Capacitor = { isNativePlatform: () => true, Plugins: { WorkhubWidget: {
  setData: async (o) => { window.__w.push(JSON.parse(o.json)); },
  count: async () => ({ count: 2 }) } } }; }"""

with sync_playwright() as p:
    br, ctx, pg, errs = open_app(p, "cover")
    # 브라우저(네이티브 아님)에서는 아무것도 하지 않음
    ok(pg.evaluate("WidgetSync.available()") is False, "브라우저에서는 위젯 기능 비활성")
    pg.evaluate(FAKE)
    ok(pg.evaluate("WidgetSync.available()") is True, "앱에서는 위젯 기능 활성")
    pg.evaluate("""async () => {
      await LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'열린 할일', due:'2030-05-01', dueTime:'14:30', priority:'high'})});
      await LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'기한 없음'})});
      const d = await LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'오래전 완료', due:'2020-01-01'})});
      await LocalApi.request('/tasks/'+d.id,{method:'PATCH',body:JSON.stringify({status:'done'})});
      const e = await LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'최근 완료', due: AI.today()})});
      await LocalApi.request('/tasks/'+e.id,{method:'PATCH',body:JSON.stringify({status:'done'})});
    }""")
    pg.wait_for_timeout(1500)
    w = pg.evaluate("window.__w")
    ok(len(w) >= 1 and len(w) <= 2, f"여러 번 바꿔도 모아서 보냄 ({len(w)}회)")
    s = w[-1]
    titles = sorted(t["title"] for t in s["tasks"])
    ok(titles == ["기한 없음", "열린 할일", "최근 완료"], f"열린 할일 + 최근 완료만 포함, 오래된 완료는 제외: {titles}")
    t1 = next(t for t in s["tasks"] if t["title"] == "열린 할일")
    ok(t1["due"] == "2030-05-01" and t1["time"] == "14:30" and t1["pri"] == "high" and t1["done"] is False, f"필드 전달: {t1}")
    ok(next(t for t in s["tasks"] if t["title"] == "최근 완료")["done"] is True, "완료 표시 전달")
    ok("2026-10-09" in s["hol"] or len(s["hol"]) > 10, f"공휴일 목록 포함({len(s['hol'])}일)")
    n = len(w)
    # 동기화로 조용히 반영된 변경도 전달 (다른 기기에서 온 변경)
    pg.evaluate("DB.batch([{store:'tasks', put:{id:'zz', title:'다른 기기 할일', due:'2030-06-01', dueTime:'', location:'', priority:'mid', category:'', status:'open', created:'x'}}], {silent:true}).then(() => document.dispatchEvent(new Event('x')))")
    pg.evaluate("WidgetSync.push(true)"); pg.wait_for_timeout(300)
    ok(any(t["title"] == "다른 기기 할일" for t in pg.evaluate("window.__w").pop()["tasks"]), "push(true)는 바로 전송")
    # 설정 안내
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(500)
    ok("위젯" in pg.text_content("#widgetHint") and "2개" in pg.text_content("#widgetHint"), f"설정에 위젯 안내: {pg.text_content('#widgetHint')!r}")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    br.close()
finish()
