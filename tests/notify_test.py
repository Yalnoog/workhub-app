from common import *

with sync_playwright() as p:
    br, ctx, pg, errs = open_app(p, "cover")
    # 가짜 Capacitor LocalNotifications로 예약 내용을 검증한다(브라우저에는 실제 플러그인이 없음)
    pg.evaluate("""() => {
      window.__sched = []; window.__pending = [];
      window.Capacitor = { isNativePlatform: () => true, Plugins: { LocalNotifications: {
        getPending: async () => ({ notifications: window.__pending.map(id => ({ id })) }),
        cancel: async (o) => { window.__pending = window.__pending.filter(id => !o.notifications.some(n => n.id === id)); },
        checkPermissions: async () => ({ display: 'granted' }),
        schedule: async (o) => { window.__sched = window.__sched.concat(o.notifications); window.__pending = window.__pending.concat(o.notifications.map(n => n.id)); },
        createChannel: async () => {}, requestPermissions: async () => ({ display: 'granted' }),
        checkExactNotificationSetting: async () => ({ exact_alarm: 'granted' }),
      } } };
    }""")
    ok(pg.evaluate("Notify.isNative()"), "네이티브 환경으로 인식")
    pg.evaluate("""async () => {
      await LocalApi.request('/tasks', {method:'POST', body: JSON.stringify({title:'시간있음', due:'2030-05-01', dueTime:'14:30', location:'3층'})});
      await LocalApi.request('/tasks', {method:'POST', body: JSON.stringify({title:'시간없음', due:'2030-05-02'})});
      await LocalApi.request('/tasks', {method:'POST', body: JSON.stringify({title:'과거', due:'2020-01-01'})});
      await LocalApi.request('/tasks', {method:'POST', body: JSON.stringify({title:'기한없음'})});
      const d = await LocalApi.request('/tasks', {method:'POST', body: JSON.stringify({title:'완료됨', due:'2030-06-01'})});
      await LocalApi.request('/tasks/' + d.id, {method:'PATCH', body: JSON.stringify({status:'done'})});
    }""")
    pg.wait_for_timeout(500)   # api의 변경 이벤트 -> 자동 재예약
    pg.evaluate("window.__sched = []; window.__pending = []"); pg.evaluate("Notify.sync()"); pg.wait_for_timeout(300)
    s = pg.evaluate("window.__sched")
    titles = sorted(x["title"] for x in s)
    ok(titles == ["시간없음", "시간있음"], f"기한 있는 미완료 할일만 예약: {titles}")
    a = next(x for x in s if x["title"] == "시간있음")
    ok(pg.evaluate("d => new Date(d).getHours()*60 + new Date(d).getMinutes()", a["schedule"]["at"]) == 14 * 60, "시간 있는 할일은 30분 전(14:00)에 알림") if False else None
    import datetime
    at = pg.evaluate("window.__sched.find(x=>x.title==='시간있음').schedule.at")
    ok(pg.evaluate("a => { const d = new Date(a); return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate()+' '+d.getHours()+':'+d.getMinutes(); }", at) == "2030-5-1 14:0", "시간 있는 할일은 마감 30분 전(14:00)에 알림")
    at2 = pg.evaluate("window.__sched.find(x=>x.title==='시간없음').schedule.at")
    ok(pg.evaluate("a => { const d = new Date(a); return d.getDate()+' '+d.getHours(); }", at2) == "2 9", "시간 없는 할일은 마감일 오전 9시에 알림")
    ok(a["body"] == "마감 14:30 · 3층", f"알림 본문 {a['body']!r}")
    # 재동기화는 중복 예약을 만들지 않는다
    n1 = pg.evaluate("window.__pending.length"); pg.evaluate("Notify.sync()"); pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__pending.length") == n1 == 2, f"여러 번 동기화해도 예약 수 유지 ({n1})")
    # 시간 변경/삭제 반영
    tid = pg.evaluate("DB.all('tasks').find(t=>t.title==='시간있음').id")
    pg.evaluate("id => LocalApi.request('/tasks/'+id, {method:'DELETE'})", tid); pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__pending.length") == 1, "할일을 지우면 알림도 취소")
    # 알림 시각이 이미 지났지만 마감 전이면 곧바로 알림, 이미 알린 건 제외
    now_in = pg.evaluate("""() => { const d = new Date(Date.now()+10*60000); const p = n=>String(n).padStart(2,'0');
       return {due: d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()), time: p(d.getHours())+':'+p(d.getMinutes())}; }""")
    r = pg.evaluate("t => Notify._plan([{id:'x', title:'임박', due:t.due, dueTime:t.time, status:'open'}], new Date()).length", now_in)
    ok(r == 1, "마감 10분 전에 등록하면 바로(1분 뒤) 알림")
    r = pg.evaluate("t => Notify._plan([{id:'x', title:'임박', due:t.due, dueTime:t.time, status:'open', notified:1}], new Date()).length", now_in)
    ok(r == 0, "이미 알린 임박 할일은 다시 알리지 않음")

    # --- 알림 시각 선택(설정 화면) ---
    pg.evaluate("window.__sched = []; window.__pending = []")
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.getElementById('leadSel').value") == "30" and pg.evaluate("document.getElementById('hourSel').value") == "9", "기본값: 30분 전 / 오전 9시")
    ok("하루 전" in pg.text_content("#leadSel") and "오후 6시" in pg.text_content("#hourSel"), "선택지 표시")
    pg.select_option("#leadSel", "60"); pg.wait_for_timeout(700)
    ok(pg.evaluate("Settings.get('notifyLeadMin')") == 60, "사전 알림 시간을 1시간 전으로 저장")
    at = pg.evaluate("window.__sched.find(x=>x.title==='시간있음' || x.title==='킥오프') ? 1 : 0")
    pg.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'시각확인', due:'2030-07-01', dueTime:'14:30'})})"); pg.wait_for_timeout(500)
    got = pg.evaluate("(() => { const d = new Date(window.__sched.filter(x=>x.title==='시각확인').pop().schedule.at); return d.getHours()+':'+d.getMinutes(); })()")
    ok(got == "13:30", f"1시간 전 설정이 예약에 반영 (14:30 마감 → {got})")
    pg.select_option("#leadSel", "1440"); pg.wait_for_timeout(700)
    got = pg.evaluate("(() => { const d = new Date(window.__sched.filter(x=>x.title==='시각확인').pop().schedule.at); return d.getDate()+' '+d.getHours()+':'+d.getMinutes(); })()")
    ok(got == "30 14:30", f"하루 전 설정 (7/1 14:30 → 6/30 {got})")
    pg.select_option("#hourSel", "18"); pg.wait_for_timeout(700)
    pg.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'날짜만', due:'2030-08-01'})})"); pg.wait_for_timeout(500)
    got = pg.evaluate("(() => { const d = new Date(window.__sched.filter(x=>x.title==='날짜만').pop().schedule.at); return d.getHours(); })()")
    ok(got == 18, f"날짜만 있는 할일은 선택한 시각(오후 6시)에 알림 ({got}시)")
    pg.screenshot(path=f"{SHOTS}/notify_pick.png")
    pg.evaluate("Settings.set('notifyLeadMin', 45)"); pg.click("#settingsClose"); pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(400)
    ok(pg.evaluate("document.getElementById('leadSel').value") == "45" and "45분 전" in pg.text_content("#leadSel"), "목록에 없는 값(다른 기기에서 넘어온 값)도 그대로 표시")
    pg.click("#settingsClose")
    # --- 이미 지난 알림 시각: 곧바로 한 번만, 앱을 열 때마다 다시 울리지 않음 ---
    pg.evaluate("Settings.set('notifyLeadMin', 30); Settings.remove('notifFired'); window.__sched = []; window.__pending = [];")
    now_in = pg.evaluate("""() => { const d = new Date(Date.now()+10*60000); const p = n=>String(n).padStart(2,'0');
       return {due: d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()), time: p(d.getHours())+':'+p(d.getMinutes())}; }""")
    pg.evaluate("t => LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'임박함', due:t.due, dueTime:t.time})})", now_in); pg.wait_for_timeout(500)
    first = pg.evaluate("window.__sched.filter(x=>x.title==='임박함').map(x=>x.schedule.at)")
    pg.evaluate("Notify.sync()"); pg.wait_for_timeout(300); pg.evaluate("Notify.sync()"); pg.wait_for_timeout(300)
    allj = pg.evaluate("window.__sched.filter(x=>x.title==='임박함').map(x=>x.schedule.at)")
    ok(len(set(allj)) == 1, f"여러 번 동기화해도 즉시 알림 시각은 그대로 유지 ({len(allj)}회 예약, 서로 다른 시각 {len(set(allj))}개)")
    pg.evaluate("""() => { const f = Settings.get('notifFired'); Object.keys(f).forEach(k => f[k] = Date.now() - 1000); return Settings.set('notifFired', f); }""")
    pg.evaluate("window.__sched = []"); pg.evaluate("Notify.sync()"); pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__sched.filter(x=>x.title==='임박함').length") == 0, "이미 울린 뒤에는 다시 예약하지 않음")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    br.close()
finish()
