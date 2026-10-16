import json
from drive_fake import *

BACKUP = {"app": "workhub-standalone", "version": 1, "data": {
  "projects": [{"id": "pB1", "name": "회의 ", "created": "2026-01-01T00:00:00"}, {"id": "pB2", "name": "새 프로젝트", "created": "2026-01-02T00:00:00"}],
  "tasks": [{"id": "t1", "title": "서버 할일1", "due": "2030-01-01", "dueTime": "", "location": "", "priority": "mid", "category": "새 프로젝트", "status": "open", "created": "2026-01-01T00:00:00", "notified": 0},
            {"id": "t2", "title": "서버 할일2", "due": "", "dueTime": "", "location": "", "priority": "high", "category": "", "status": "done", "created": "2026-01-02T00:00:00", "notified": 0}],
  "meetings": [{"id": "m1", "title": "서버 회의록", "date": "2026-01-03", "raw": "원문", "participants": [], "agenda": [], "discussion": "", "decisions": [], "actionItems": [], "created": "2026-01-03T00:00:00", "projectId": "pB1", "kind": "meeting", "summary": "", "notes": ""}],
  "vocab": [{"id": "v1", "wrong": "에이비씨", "right": "ABC-100", "created": "x"}], "settings": []}}

def do_import(pg, mode):
    pg.click("#settingsBtn"); pg.click("#menuSettings"); pg.wait_for_timeout(300)
    pg.set_input_files("#backupFile", {"name": "b.json", "mimeType": "application/json", "buffer": json.dumps(BACKUP).encode()})
    pg.wait_for_selector("#cfOk"); pg.check(f"input[name=mode][value={mode}]"); pg.click("#cfOk"); pg.wait_for_timeout(900)
    pg.click("#settingsClose"); pg.wait_for_timeout(300)

with sync_playwright() as p:
    A_br, A, errsA = device(p)
    B_br, B, errsB = device(p, key=False)
    A.evaluate("LocalApi.request('/projects',{method:'POST',body:JSON.stringify({name:'회의'})})")
    A.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'이 기기 할일'})})")
    lid = A.evaluate("DB.all('projects').find(p=>p.name==='회의').id")
    do_import(A, "merge")
    titles = sorted(t["title"] for t in A.evaluate("DB.all('tasks')"))
    ok(titles == ["서버 할일1", "서버 할일2", "이 기기 할일"], f"합치기: 기존 할일 유지 + 백업 할일 추가 {titles}")
    ok(A.evaluate("DB.all('projects').length") == 2, "같은 이름('회의')의 프로젝트는 새로 만들지 않음")
    ok(A.evaluate("DB.all('meetings')[0].projectId") == lid, "백업 회의록이 기존 '회의' 프로젝트에 연결됨")
    ok(A.evaluate("DB.all('vocab').length") == 1, "용어 사전 추가")
    ok(A.locator(".toast").filter(has_text="추가").count() >= 1, "추가 건수 안내")
    do_import(A, "merge")
    ok(A.evaluate("DB.all('tasks').length") == 3 and A.evaluate("DB.all('meetings').length") == 1 and A.evaluate("DB.all('vocab').length") == 1, "같은 파일을 다시 합쳐도 중복되지 않음")
    # 합친 데이터가 드라이브를 통해 다른 기기로 전달
    ok(sync(A) == "ok", "A 동기화"); A.evaluate("Settings.set('driveOn', true)")
    ok(sync(B) == "ok", "B 연결")
    ok(sorted(t["title"] for t in B.evaluate("DB.all('tasks')")) == titles and B.evaluate("DB.all('meetings').length") == 1, "합친 데이터가 다른 기기에 동기화됨")
    # 대체 모드
    do_import(A, "replace")
    ok(sorted(t["title"] for t in A.evaluate("DB.all('tasks')")) == ["서버 할일1", "서버 할일2"], "대체: 이 기기 데이터를 지우고 백업으로 바꿈")
    ok(not errsA and not errsB, f"자바스크립트 오류 없음 {errsA} {errsB}")
    A_br.close(); B_br.close()
finish()
