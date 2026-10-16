from drive_fake import *

PULL = """async ([x, y0, y1, hold]) => {
  const tgt = document.elementFromPoint(x, y0) || document.body;
  const mk = (type, y, end) => { const t = new Touch({ identifier: 1, target: tgt, clientX: x, clientY: y });
    return new TouchEvent(type, { touches: end ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }); };
  tgt.dispatchEvent(mk('touchstart', y0));
  const steps = 8;
  for (let i = 1; i <= steps; i++) { tgt.dispatchEvent(mk('touchmove', y0 + (y1 - y0) * i / steps)); await new Promise(r => setTimeout(r, 16)); }
  const label = document.getElementById('ptr') && !document.getElementById('ptr').hidden ? document.getElementById('ptr').textContent : '';
  if (hold) await new Promise(r => setTimeout(r, hold));
  tgt.dispatchEvent(mk('touchend', y1, true));
  return label;
}"""

with sync_playwright() as p:
    A_br, A, errsA = device(p)
    B_br, B, errsB = device(p, key=False)
    ok(sync(A) == "ok", "A 연결"); A.evaluate("Settings.set('driveOn', true)")
    ok(sync(B) == "ok", "B 연결"); B.evaluate("Settings.set('driveOn', true)")
    A.evaluate("document.querySelector('nav.bottom-nav [data-tab=tasks]').click()")
    A.wait_for_timeout(300)
    # B에서 새 할일 -> 드라이브로 올림
    B.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'B에서 추가'})})"); sync(B)
    ok("B에서 추가" not in A.inner_text("#taskList"), "A는 아직 모름(자동 반영 없음)")
    # 짧게 당기면 새로고침하지 않음
    calls = DRIVE["calls"]
    lab = A.evaluate(PULL, [200, 400, 430, 0]); A.wait_for_timeout(400)
    ok(DRIVE["calls"] == calls and "B에서 추가" not in A.inner_text("#taskList"), f"조금만 당기면 새로고침 안 함 (안내: {lab!r})")
    # 충분히 당기면 새로고침
    lab = A.evaluate(PULL, [200, 400, 560, 0]); A.wait_for_timeout(1200)
    ok("놓으면" in lab, f"충분히 당기면 '놓으면 새로고침' 안내: {lab!r}")
    ok("B에서 추가" in A.inner_text("#taskList"), "당겨서 새로고침하면 다른 기기의 변경이 반영됨")
    ok(A.locator(".toast").filter(has_text="새로고침했습니다").count() == 1, "완료 안내")
    ok(A.evaluate("document.getElementById('ptr').hidden"), "표시줄이 사라짐")
    A.screenshot(path=f"{SHOTS}/pull_after.png")
    # 스크롤이 내려가 있으면 동작 안 함
    A.evaluate("document.body.style.minHeight='3000px'; window.scrollTo(0, 400)"); A.wait_for_timeout(200)
    calls = DRIVE["calls"]
    A.evaluate(PULL, [200, 300, 480, 0]); A.wait_for_timeout(600)
    ok(DRIVE["calls"] == calls, "스크롤이 맨 위가 아니면 새로고침하지 않음")
    A.evaluate("window.scrollTo(0, 0)"); A.wait_for_timeout(200)
    # 팝업이 떠 있으면 동작 안 함
    A.click("#settingsBtn"); A.click("#menuSettings"); A.wait_for_timeout(300)
    calls = DRIVE["calls"]; A.evaluate(PULL, [200, 400, 560, 0]); A.wait_for_timeout(600)
    ok(DRIVE["calls"] == calls, "팝업이 열려 있으면 새로고침하지 않음")
    A.click("#settingsClose"); A.wait_for_timeout(300)
    # 녹음 중에는 새로고침하지 않고 이유를 알려 줌 (녹음은 계속됨)
    A.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()"); A.wait_for_timeout(300)
    if not A.locator("#composer").evaluate("e=>e.open"): A.click("#composer > summary")
    A.click("#recBtn"); A.wait_for_timeout(600)
    B.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'녹음 중 B 추가'})})"); sync(B)
    calls = DRIVE["calls"]
    lab = A.evaluate(PULL, [200, 100, 260, 0]); A.wait_for_timeout(700)
    ok("녹음 중" in lab, f"녹음 중에 당기면 이유를 안내: {lab!r}")
    ok(DRIVE["calls"] == calls and A.evaluate("DB.all('tasks').every(t => t.title !== '녹음 중 B 추가')"), "녹음 중에는 새로고침하지 않음")
    ok(A.locator("#recBtn.recording").count() == 1, "녹음은 계속 진행 중")
    A.click("#recBtn"); A.wait_for_timeout(1500)
    lab = A.evaluate(PULL, [200, 100, 260, 0]); A.wait_for_timeout(1200)
    ok("놓으면" in lab and A.evaluate("DB.all('tasks').some(t => t.title === '녹음 중 B 추가')"), "녹음을 끝내면 다시 새로고침 가능")
    A.evaluate("document.querySelector('nav.bottom-nav [data-tab=tasks]').click()")
    # 드라이브 미연결 기기: 목록만 다시 불러오고 오류 없이 끝남
    C_br, C, errsC = device(p, key=False)
    C.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'C 로컬'})})")
    C.evaluate(PULL, [200, 400, 560, 0]); C.wait_for_timeout(800)
    ok(C.locator(".toast").filter(has_text="새로고침했습니다").count() == 1, "연결 안 된 기기도 새로고침 동작")
    C_br.close()
    # 화면을 벗어나는 순간 바로 올림 (8초를 기다리지 않음)
    A.evaluate("LocalApi.request('/tasks',{method:'POST',body:JSON.stringify({title:'닫기 직전 추가'})})")
    ok("닫기 직전 추가" not in DRIVE["body"], "추가 직후에는 아직 안 올라감(8초 대기)")
    A.evaluate("Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true}); document.dispatchEvent(new Event('visibilitychange'))")
    A.wait_for_timeout(1200)
    ok("닫기 직전 추가" in DRIVE["body"], "화면을 벗어나는 순간 즉시 올라감")
    calls = DRIVE["calls"]
    A.evaluate("document.dispatchEvent(new Event('visibilitychange'))"); A.wait_for_timeout(600)
    ok(DRIVE["calls"] == calls, "올릴 변경이 없으면 네트워크를 쓰지 않음")
    ok(not errsA and not errsB, f"자바스크립트 오류 없음 {errsA} {errsB}")
    A_br.close(); B_br.close()
finish()
