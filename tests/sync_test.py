import json, re
from common import *

from drive_fake import *

with sync_playwright() as p:
    # --- 병합 순수 로직 ---
    br0, ctx0, pg0, errs0 = open_app(p, "cover")
    r = pg0.evaluate("""() => {
      const L = {stores:{tasks:[{id:'a',title:'L',_u:5}], meetings:[], projects:[{id:'p2',name:'A 라인',_u:1}], vocab:[]}, tombs:[]};
      const R = {stores:{tasks:[{id:'a',title:'R',_u:9},{id:'b',title:'B',_u:1}], meetings:[{id:'m',projectId:'p2',_u:1}], projects:[{id:'p1',name:'a라인',_u:1}], vocab:[]}, tombs:[{id:'tasks:b',store:'tasks',rid:'b',t:3}]};
      const m = Sync.merge(L, R, 100);
      return { a: m.stores.tasks.map(x=>x.id+x.title), proj: m.stores.projects.map(x=>x.id), mp: m.stores.meetings[0].projectId, tomb: m.tombs.map(t=>t.id).sort() };
    }""")
    ok(r["a"] == ["aR"], f"최신 수정이 이기고 삭제 기록이 더 새로우면 삭제: {r['a']}")
    ok(r["proj"] == ["p1"] and r["mp"] == "p1", f"같은 이름 프로젝트는 하나로 합치고 회의록 연결을 옮김: {r['proj']} {r['mp']}")
    br0.close()

    A_br, A, errsA = device(p)
    B_br, B, errsB = device(p, key=False)
    # 1) A에서 만들고 연결 -> 드라이브에 파일 생성
    add(A, "A의 할일"); add(A, "삭제될 할일"); A.evaluate("Settings.set('apiKey','AIzaSECRETAAAAAAAAAAAA')")
    ok(sync(A) == "ok", "A: 연결·첫 동기화")
    A.evaluate("Settings.set('driveOn', true)")
    ok(DRIVE["file"] == "f1" and "A의 할일" in DRIVE["body"], "드라이브에 동기화 파일이 만들어짐")
    ok("AIzaSECRET" not in DRIVE["body"] and "apiKey" not in DRIVE["body"], "API 키는 드라이브에 올라가지 않음")
    # 2) B가 연결 -> A의 데이터를 받음
    ok(sync(B) == "ok", "B: 연결")
    B.evaluate("Settings.set('driveOn', true)")
    ok(T(B) == ["A의 할일", "삭제될 할일"], f"B가 A의 할일을 받음: {T(B)}")
    ok(B.evaluate("Settings.get('apiKey')") is None, "B에는 API 키가 전달되지 않음")
    # 3) 동시에 수정: B는 제목 수정, A는 새 할일
    tid = next(x["id"] for x in B.evaluate("LocalApi.request('/tasks')") if x["title"] == "A의 할일")
    B.wait_for_timeout(20); B.evaluate("id => LocalApi.request('/tasks/'+id,{method:'PATCH',body:JSON.stringify({title:'B가 고침'})})", tid)
    add(A, "A의 새 할일")
    sync(B); sync(A); sync(B)
    ok(T(A) == T(B) == ["A의 새 할일", "B가 고침", "삭제될 할일"], f"양쪽이 같은 내용으로 합쳐짐: A={T(A)} B={T(B)}")
    # 4) 삭제가 다른 기기에 전달
    did = next(x["id"] for x in A.evaluate("LocalApi.request('/tasks')") if x["title"] == "삭제될 할일")
    A.evaluate("id => LocalApi.request('/tasks/'+id,{method:'DELETE'})", did)
    sync(A); sync(B)
    ok(T(B) == ["A의 새 할일", "B가 고침"], f"A에서 지운 할일이 B에서도 사라짐: {T(B)}")
    # 5) 삭제 뒤 다시 수정한 항목은 살아남음(최신 수정 우선)
    nid = next(x["id"] for x in B.evaluate("LocalApi.request('/tasks')") if x["title"] == "A의 새 할일")
    A.evaluate("id => LocalApi.request('/tasks/'+id,{method:'DELETE'})", nid); sync(A)
    B.wait_for_timeout(20); B.evaluate("id => LocalApi.request('/tasks/'+id,{method:'PATCH',body:JSON.stringify({title:'지운 뒤 고침'})})", nid)
    sync(B); sync(A)
    ok("지운 뒤 고침" in T(A) and "지운 뒤 고침" in T(B), f"삭제보다 나중에 고친 항목은 유지: A={T(A)}")
    # 6) 프로젝트 중복 방지
    A.evaluate("LocalApi.request('/projects',{method:'POST',body:JSON.stringify({name:'신제품 개발'})})")
    B.evaluate("LocalApi.request('/projects',{method:'POST',body:JSON.stringify({name:'신제품  개발'})})")
    sync(A); sync(B); sync(A)
    na = A.evaluate("DB.all('projects').filter(p=>p.name.replace(/\\s/g,'')==='신제품개발').length"); nb = B.evaluate("DB.all('projects').filter(p=>p.name.replace(/\\s/g,'')==='신제품개발').length")
    ok(na == 1 and nb == 1, f"같은 이름 프로젝트가 중복되지 않음 A={na} B={nb}")
    # 7) 변경이 일어나면 자동으로 올라감(8초 대기 대신 즉시 예약 확인)
    calls = DRIVE["calls"]; A.evaluate("Sync.schedule(0)"); add(A, "자동 동기화"); A.evaluate("Sync.schedule(0)"); A.wait_for_timeout(1500)
    ok(DRIVE["calls"] > calls and "자동 동기화" in DRIVE["body"], "변경 후 자동으로 드라이브에 올라감")
    # 8) 재동기화는 변화 없으면 올리지 않음
    sync(A); b1 = DRIVE["body"]; sync(A)
    ok(DRIVE["body"] == b1, "변화가 없으면 파일을 다시 쓰지 않음")
    # 9) 화면 반영: B가 받은 변경이 목록에 즉시 보임
    B.evaluate("document.querySelector('nav.bottom-nav [data-tab=tasks]').click()"); B.evaluate("Sync.run({interactive:true})"); B.wait_for_timeout(800)
    ok("자동 동기화" in B.inner_text("#taskList"), "받은 변경이 화면에 바로 보임")
    # 10) 동의 필요 오류 안내
    B.evaluate("window.__mode = 'consent'")
    r = sync(B)
    ok(r.startswith("NEED_CONSENT"), f"연결이 풀리면 다시 연결 안내: {r}")
    B.click("#settingsBtn"); B.click("#menuSettings"); B.wait_for_timeout(300)
    ok("다시 연결" in B.text_content("#driveStatus"), f"설정 화면에 오류 표시: {B.text_content('#driveStatus')!r}")
    B.screenshot(path=f"{SHOTS}/drive_settings.png")
    ok(not errsA and not errsB, f"자바스크립트 오류 없음 {errsA} {errsB}")
    A_br.close(); B_br.close()
finish()
