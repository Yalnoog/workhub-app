from common import *

with sync_playwright() as p:
    for size in ("cover", "inner"):
        br, ctx, pg, errs = open_app(p, size)
        today = pg.evaluate("AI.today()")
        pg.evaluate("""async (d) => {
          await LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'킥오프 회의 소집', due:d, dueTime:'10:00', category:'회의'})});
          await LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'일반 할일', due:d, dueTime:'14:00'})});
          await LocalApi.request('/meetings',{method:'POST',body:JSON.stringify({title:'지난주 점검 회의', date:d, raw:'x', project:''})});
          await LocalApi.request('/meetings',{method:'POST',body:JSON.stringify({title:'빠른 메모', date:d, raw:'y', kind:'memo'})});
        }""", today)
        pg.reload(); pg.wait_for_function("window.DB && DB.all('meetings').length > 0"); pg.wait_for_timeout(900)
        if pg.locator('#onboardModal').is_visible(): pg.click('#obSkip')
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=calendar]').click()"); pg.wait_for_timeout(400)
        pg.click(f'#calGrid .cal-day[data-date="{today}"]') if not pg.locator(f'#calGrid .cal-day.selected[data-date="{today}"]').count() else None
        pg.wait_for_timeout(300)
        txt = pg.inner_text("#calDayList")
        secs = pg.locator("#calDayList .cal-sec").all_inner_texts()
        ok(any("회의 소집 1건" in s for s in secs), f"{size}: '회의 소집 1건' 묶음: {secs}")
        ok(any("회의록 2건" in s for s in secs), f"{size}: '회의록 2건' 묶음(회의록+메모): {secs}")
        ok(not any(s.strip().startswith("회의 2건") or s.strip().startswith("회의 3건") for s in secs), f"{size}: 예전의 합쳐진 '회의 N건'은 없음")
        rec_items = pg.locator("#calDayList .cal-item").all_inner_texts()
        recs = [r for r in rec_items if "지난주 점검 회의" in r or "빠른 메모" in r]
        ok(len(recs) == 2 and all("종일" not in r for r in recs), f"{size}: 회의록 항목에 '종일'이 없음: {recs}")
        ok(any("메모: 빠른 메모" in r for r in recs), f"{size}: 메모는 '메모:' 표시 유지")
        ok(any("10:00" in r and "킥오프 회의 소집" in r for r in rec_items), f"{size}: 회의 소집 항목은 시각 표시 유지")
        ok(any("14:00" in r and "일반 할일" in r for r in rec_items), f"{size}: 일반 할일 묶음 그대로")
        pg.screenshot(path=f"{SHOTS}/cal_day_{size}.png")
        ok(not errs, f"{size}: 자바스크립트 오류 없음 {errs}")
        br.close()
finish()
