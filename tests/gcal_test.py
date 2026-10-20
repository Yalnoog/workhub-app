import json
from drive_fake import *
from cal_fake import *

def add(pg, title, **kw):
    return pg.evaluate("([t,k]) => LocalApi.request('/tasks',{method:'POST',body:JSON.stringify(Object.assign({title:t},k))}).then(r => r.id)", [title, kw])
def patch(pg, tid, **kw):
    pg.evaluate("([id,k]) => LocalApi.request('/tasks/'+id,{method:'PATCH',body:JSON.stringify(k)})", [tid, kw])
def gdevice(p, key=True):
    br, pg, errs = device(p, key=key)
    pg.context.route("https://www.googleapis.com/calendar/**", cal_route)
    pg.evaluate("GCal.cfg.sleep = () => Promise.resolve()")
    return br, pg, errs
def run(pg): return pg.evaluate("GCal.run({force:true}).then(r => r, e => ({err: e.code + ':' + e.message}))")
def enable(pg):
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(500)
    pg.click("#calToggle"); pg.wait_for_timeout(1500)

with sync_playwright() as p:
    # 0) 브라우저(앱이 아님)에서는 쓸 수 없음
    br0, ctx0, pg0, e0 = open_app(p, "cover")
    pg0.click("#settingsBtn"); pg0.click("#menuSettings"); pg0.wait_for_timeout(400)
    ok("안드로이드 앱에서만" in pg0.text_content("#calStatus") and pg0.locator("#calToggle").is_hidden(), "브라우저에서는 캘린더 내보내기 비활성 안내")
    br0.close()

    reset()
    A_br, A, errsA = gdevice(p)
    t1 = add(A, "견적서 발송", due="2030-05-01", dueTime="14:30", location="3층", category="A라인")
    t2 = add(A, "종일 할일", due="2030-05-02")
    t3 = add(A, "기한 없음")
    t4 = add(A, "완료된 할일", due="2030-05-03"); patch(A, t4, status="done")
    t5 = add(A, "밤 늦은 일정", due="2030-05-04", dueTime="23:50")
    enable(A)
    ok(A.evaluate("Settings.get('calOn')") is True and "켜짐" in A.text_content("#calStatus"), "켜기: 구글 동의 후 켜짐 " + A.text_content("#calStatus")[:40])
    ok(len(CAL["cals"]) == 1 and list(CAL["cals"].values())[0]["summary"] == "업무 워크벤치" and list(CAL["cals"].values())[0]["timeZone"] == "Asia/Seoul", "보조 캘린더 '업무 워크벤치' 1개 생성(시간대 Asia/Seoul)")
    cid = next(iter(CAL["cals"]))
    ok(A.evaluate("Settings.get('calId')") == cid, "캘린더 ID 저장")
    ev = live()
    ok(sorted(ev.keys()) == sorted([t1, t2, t5]), f"기한 있는 미완료 할일만 일정으로: {len(ev)}건 (기한 없음·완료 제외)")
    e1 = ev[t1]
    ok(e1["summary"] == "견적서 발송" and e1["location"] == "3층" and "프로젝트: A라인" in e1["description"], "제목·장소·프로젝트 전달")
    ok(e1["start"]["dateTime"] == "2030-05-01T14:30:00" and e1["end"]["dateTime"] == "2030-05-01T15:00:00" and e1["start"]["timeZone"] == "Asia/Seoul", f"시각 일정은 30분: {e1['start']} ~ {e1['end']}")
    ok(ev[t5]["end"]["dateTime"] == "2030-05-05T00:20:00", "자정을 넘기는 일정의 종료 시각")
    ok(ev[t2]["start"] == {"date": "2030-05-02"} and ev[t2]["end"] == {"date": "2030-05-03"} and ev[t2]["transparency"] == "transparent", "시각 없는 할일은 종일 일정")
    ok(ev[t1]["extendedProperties"]["private"]["wh"] == "1" and ev[t1]["extendedProperties"]["private"]["sig"], "앱이 만든 일정 표시와 서명")
    ok(ev[t1]["reminders"] == {"useDefault": False}, "구글 캘린더 자체 알림은 끔")

    # 1) 변경 없으면 쓰지 않음, 바뀐 것만 쓰기
    n = len(writes()); r = run(A)
    ok(r["made"] == 0 and r["removed"] == 0 and len(writes()) == n, "달라진 것이 없으면 아무것도 쓰지 않음")
    patch(A, t1, title="견적서 발송(수정)"); n = len(writes()); r = run(A)
    ok(r["made"] == 1 and len(writes()) == n + 1 and live()[t1]["summary"] == "견적서 발송(수정)", "제목을 고치면 그 일정만 갱신")
    # 2) 완료 -> 삭제, 다시 열기 -> 복원
    patch(A, t1, status="done"); r = run(A)
    ok(t1 not in live() and r["removed"] == 1, "완료하면 일정에서 삭제")
    patch(A, t1, status="open"); r = run(A)
    ok(t1 in live() and live()[t1]["summary"] == "견적서 발송(수정)", "완료를 되돌리면 같은 ID로 일정 복원")
    # 3) 삭제, 기한 제거
    A.evaluate("id => LocalApi.request('/tasks/'+id,{method:'DELETE'})", t2); r = run(A)
    ok(t2 not in live(), "할일을 지우면 일정도 삭제")
    patch(A, t5, due=""); r = run(A)
    ok(t5 not in live(), "기한을 지우면 일정에서 빠짐")
    patch(A, t5, due="2030-05-06", dueTime=""); r = run(A)
    ok(live()[t5]["start"] == {"date": "2030-05-06"}, "기한을 다시 주면 일정 생성")
    # 4) 제목 가리기
    A.click("#calMask") if A.locator("#calMask").is_visible() else A.evaluate("Settings.set('calMask', true)")
    A.wait_for_timeout(800); r = run(A)
    ev = live()
    ok(all(e["summary"] == "일정" and "location" not in e and "프로젝트" not in e["description"] for e in ev.values()), "제목 가리기: 모든 일정이 '일정'(장소·프로젝트 제외)")
    A.evaluate("Settings.set('calMask', false)"); r = run(A)
    ok(live()[t1]["summary"] == "견적서 발송(수정)", "가리기를 끄면 원래 제목으로")
    A.screenshot(path=f"{SHOTS}/gcal_settings.png")

    # 5) 끄기: 일정 그대로 두기 / 캘린더 삭제
    A.evaluate("GCal.disable(false)")
    ok(A.evaluate("Settings.get('calOn')") is False and cid in CAL["cals"], "끄기(그대로 두기): 캘린더는 남음")
    n = len(CAL["log"]); patch(A, t1, title="꺼진 뒤 수정"); A.evaluate("GCal.schedule(0)"); A.wait_for_timeout(500)
    ok(len(CAL["log"]) == n, "꺼져 있으면 구글에 아무것도 보내지 않음")
    A.evaluate("GCal.enable()"); A.wait_for_timeout(1200)
    ok(len(CAL["cals"]) == 1 and live()[t1]["summary"] == "꺼진 뒤 수정", "다시 켜면 기존 캘린더를 재사용하고 최신으로 맞춤")
    A.evaluate("GCal.disable(true)"); A.wait_for_timeout(500)
    ok(len(CAL["cals"]) == 0 and A.evaluate("Settings.get('calId')") == "", "끄기(삭제): 캘린더 삭제 + 저장된 ID 비움")

    # 6) 캘린더가 밖에서 삭제된 경우: 멋대로 다시 만들지 않고 끔
    A.evaluate("GCal.enable()"); A.wait_for_timeout(1200)
    cid2 = next(iter(CAL["cals"])); del CAL["cals"][cid2]; del CAL["events"][cid2]
    r = run(A)
    ok("err" in r and r["err"].startswith("GONE") and A.evaluate("Settings.get('calOn')") is False and len(CAL["cals"]) == 0, f"캘린더가 사라지면 다시 만들지 않고 끔: {r}")
    # 7) 오류 안내
    reset(); A.evaluate("Settings.set('calId', ''); Settings.set('calOn', false); Settings.remove('calErr')")
    CAL["mode"] = "api_off"; r = run(A); A.evaluate("GCal.enable().catch(()=>0)")
    A.evaluate("document.getElementById('menuSettings')"); 
    r = A.evaluate("GCal.enable().then(()=>'ok', e => e.code + ':' + e.message)")
    ok(r.startswith("API_OFF") and "Google Calendar API" in r, f"API 미설정 안내: {r}")
    CAL["mode"] = "ok"; A.evaluate("window.__mode = 'consent'")
    r = A.evaluate("GCal.enable().then(()=>'ok', e => e.code + ':' + e.message)")
    ok(r.startswith("NEED_CONSENT"), f"동의가 필요하면 안내: {r}")
    A.evaluate("window.__mode = 'ok'")
    # 8) 속도 제한 재시도, 페이지 나눠 받기
    reset(); A.evaluate("Settings.set('calId', '')"); A.evaluate("GCal.enable().catch(()=>0)"); A.wait_for_timeout(1200)
    CAL["rate"] = 1; CAL["page"] = 2
    for i in range(5): add(A, f"추가{i}", due="2030-06-0%d" % (i + 1))
    r = run(A)
    ok(len(live()) == len([t for t in A.evaluate("DB.all('tasks')") if t["due"] and t["status"] != "done"]) and "err" not in r, f"속도 제한(429)을 재시도로 넘기고 {len(live())}건 반영")
    n = len(writes()); r = run(A)
    ok(r["made"] == 0 and len(writes()) == n, "여러 페이지로 나뉜 일정 목록도 올바로 비교(중복 생성 없음)")
    ok(not errsA, f"자바스크립트 오류 없음 {errsA}")
    A_br.close()

    # 9) 폰과 태블릿이 같은 캘린더를 씀(구글 드라이브 동기화로 캘린더 ID 공유)
    reset()
    P_br, P, errsP = gdevice(p); T_br, T, errsT = gdevice(p, key=False)
    add(P, "공유 할일", due="2030-07-01", dueTime="09:00")
    ok(sync(P) == "ok", "폰 드라이브 연결"); P.evaluate("Settings.set('driveOn', true)")
    ok(sync(T) == "ok", "태블릿 드라이브 연결"); T.evaluate("Settings.set('driveOn', true)")
    P.evaluate("GCal.enable()"); P.wait_for_timeout(1500); sync(P)
    sync(T)
    ok(T.evaluate("Settings.get('calId')") == P.evaluate("Settings.get('calId')") != "", "캘린더 ID가 드라이브로 태블릿에 전달됨")
    creates = len([x for x in CAL["log"] if x == ("POST", "/calendars")])
    T.evaluate("GCal.enable()"); T.wait_for_timeout(1500)
    ok(len(CAL["cals"]) == 1 and len([x for x in CAL["log"] if x == ("POST", "/calendars")]) == creates, "태블릿은 새 캘린더를 만들지 않고 같은 캘린더 사용")
    ok(len(live()) == 1, f"일정 중복 없음: {len(live())}건")
    add(T, "태블릿에서 추가", due="2030-07-02"); sync(T); T.evaluate("GCal.run({force:true})"); T.wait_for_timeout(800)
    P.evaluate("GCal.run({force:true})"); P.wait_for_timeout(800)
    ok(len(live()) == 2 and any(e["summary"] == "태블릿에서 추가" for e in live().values()), "폰이 먼저 최신 할일을 받아 온 뒤 맞추므로, 태블릿이 만든 일정을 지우지 않음")
    # 드라이브 동기화를 확인하지 못하면(예: 연결이 풀림) 캘린더를 지우지 않고 미룬다
    before = dict(live()); n = len(writes())
    P.evaluate("window.__mode = 'consent'"); P.evaluate("Settings.set('driveOn', true)")
    P.evaluate("id => LocalApi.request('/tasks/'+id,{method:'DELETE'})", P.evaluate("DB.all('tasks').find(t => t.title === '공유 할일').id"))
    r = run(P)
    ok("err" in r and r["err"].startswith("SYNC") and len(writes()) == n and live() == before, f"동기화를 확인하지 못하면 캘린더를 건드리지 않고 미룸: {r}")
    P.evaluate("window.__mode = 'ok'")
    ok(not errsP and not errsT, f"자바스크립트 오류 없음 {errsP} {errsT}")
    P_br.close(); T_br.close()
finish()
