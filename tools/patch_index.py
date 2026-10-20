# 서버판 index.html(원본) -> 독립형 www/index.html 변환. 원본은 tools/index.server.html 로 보관하고 항상 거기서 다시 생성한다.
import re, sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / "tools" / "index.server.html").read_text(encoding="utf-8")
ui_block = (root / "tools" / "ui_block.js").read_text(encoding="utf-8")
s = src

def sub1(old, new, count=1):
    global s
    if s.count(old) != count:
        sys.exit("앵커 불일치(%d건): %s" % (s.count(old), old[:70]))
    s = s.replace(old, new)

def cut(start, end, new=""):
    """start 문자열부터 end 문자열 직전까지를 new로 교체"""
    global s
    i = s.index(start); j = s.index(end, i)
    s = s[:i] + new + s[j:]

# --- HTML: 메뉴 / 배너 / 새 모달 ---
sub1('      <button type="button" role="menuitem" id="menuReload">페이지 새로고침</button>\n', '      <button type="button" role="menuitem" id="menuSettings">설정</button>\n')
sub1('      <button type="button" role="menuitem" id="menuAccount">비밀번호 변경</button>\n      <button type="button" role="menuitem" id="menuLogout">로그아웃</button>\n', '')
cut('<div class="notify-banner" id="installBanner" hidden>', '<div class="modal-back" id="vocabModal" hidden>', '''<div class="notify-banner" id="updateBanner" hidden>
  <span id="updateText"></span>
  <button type="button" class="ghost" id="updateLater">나중에</button>
  <button type="button" class="primary" id="updateGo">업데이트</button>
</div>

<div class="notify-banner" id="quotaBanner" hidden>
  <span id="quotaText"></span>
  <button type="button" class="ghost" id="quotaClose">닫기</button>
  <a class="primary" id="quotaGo" href="https://one.google.com/storage" target="_blank" rel="noopener" style="padding:8px 12px;border-radius:8px;text-decoration:none;background:var(--accent);color:#fff;font-weight:600;flex-shrink:0">용량 관리</a>
</div>

<div class="modal-back" id="settingsModal" hidden>
  <div class="modal" role="dialog" aria-modal="true" aria-label="설정">
    <h3>설정</h3>
    <div class="mlist set-list">
      <section class="set-sec">
        <h4>Gemini API 키</h4>
        <div class="mdesc2" id="keyStatus"></div>
        <div class="set-row"><input id="keyInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza... 로 시작하는 키 붙여넣기"><button type="button" class="primary" id="keySave">확인·저장</button></div>
        <div class="mdesc2">키는 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 무료로 만들 수 있습니다. 기본적으로 이 기기에만 저장되며, Google에 AI 요청을 보낼 때만 사용됩니다.</div>
        <label class="ob-agree"><input type="checkbox" id="syncKeyBox"><span>이 키를 구글 드라이브로 다른 기기와 동기화 <span class="mdesc2" id="syncKeyHint"></span></span></label>
      </section>
      <section class="set-sec">
        <h4>내 직무 설명 (선택)</h4>
        <input id="profileInput" type="text" maxlength="120" placeholder="예: 반도체 장비 제어 엔지니어">
        <div class="mdesc2">회의록을 정리할 때 AI가 용어를 더 정확히 이해하도록 돕습니다. 구글 드라이브 동기화를 켜면 다른 기기에도 같이 적용됩니다.</div>
      </section>
      <section class="set-sec" id="notifySec" hidden>
        <h4>마감일 알림</h4>
        <div class="mdesc2" id="notifyStatus"></div>
        <div class="set-pick"><label for="leadSel">시간이 정해진 일정</label><select id="leadSel"></select></div>
        <div class="set-pick"><label for="hourSel">시간 없이 날짜만 있는 할일</label><select id="hourSel"></select></div>
        <div class="set-row"><button type="button" class="ghost" id="notifyPerm">알림 권한 확인·요청</button><button type="button" class="ghost" id="notifyTest">테스트 알림</button></div>
      </section>
      <section class="set-sec" id="driveSec">
        <h4>구글 드라이브 동기화</h4>
        <div class="mdesc2" id="driveStatus"></div>
        <div id="driveUsage" hidden>
          <div class="qrow"><span id="qTotalText"></span></div>
          <div class="qbar" id="qBar" role="img"><i id="qUsed"></i><b id="qApp"></b></div>
          <div class="qrow muted2" id="qAppText"></div>
        </div>
        <div class="set-row"><button type="button" class="primary" id="driveConnect">구글 계정 연결</button><button type="button" class="ghost" id="driveNow" hidden>지금 동기화</button><button type="button" class="ghost" id="driveOff" hidden>연결 해제</button></div>
        <div class="mdesc2">같은 구글 계정으로 연결한 기기끼리 할일·회의록·프로젝트·용어 사전과 직무 설명·알림 설정이 맞춰집니다. 데이터는 내 드라이브의 앱 전용 숨김 폴더에만 저장되고 다른 곳에는 전송되지 않습니다. API 키는 기본적으로 동기화되지 않으며, 위 "API 키 동기화" 스위치를 켠 경우에만 올라갑니다.</div>
      </section>
      <section class="set-sec" id="calSec">
        <h4>구글 캘린더로 일정 내보내기 (회사 캘린더 연동용)</h4>
        <div class="mdesc2" id="calStatus"></div>
        <div class="set-row"><button type="button" class="primary" id="calToggle">켜기</button><button type="button" class="ghost" id="calNow" hidden>지금 맞추기</button></div>
        <label class="ob-agree" id="calMaskRow" hidden><input type="checkbox" id="calMask"><span>제목 가리기 <span class="mdesc2">(제목·장소·프로젝트를 빼고 "일정"과 시간만 보냅니다)</span></span></label>
        <div class="mdesc2" id="calGuide" hidden>
          <b>회사 캘린더에 연결하는 방법 (처음 한 번, PC 브라우저)</b><br>
          1. 구글 캘린더(calendar.google.com) → ⚙ 설정 → 왼쪽 <b>"업무 워크벤치"</b> 캘린더 클릭<br>
          2. <b>"캘린더 통합"</b> → <b>"iCal 형식의 비공개 주소"</b> 복사<br>
          3. 그 주소를 회사 캘린더의 외부 캘린더 URL 칸에 등록<br>
          <a href="https://calendar.google.com/calendar/u/0/r/settings" target="_blank" rel="noopener">구글 캘린더 설정 열기</a>
        </div>
        <div class="mdesc2">기한이 있는 미완료 할일을 앱이 만든 보조 캘린더의 일정으로 맞춥니다(시각이 있으면 30분, 없으면 종일). 완료하거나 지운 할일은 일정에서도 사라집니다. 앱은 이 보조 캘린더만 다루며 기본 캘린더나 다른 일정은 읽거나 바꾸지 못합니다. 비공개 주소를 아는 사람은 일정을 볼 수 있으니 주소를 공유하지 마세요.</div>
      </section>
      <section class="set-sec">
        <h4>백업</h4>
        <div class="mdesc2">데이터는 이 기기에만 있습니다. 기기를 바꾸거나 앱을 지우기 전에 백업 파일을 저장해 두세요. (API 키는 백업에 포함되지 않습니다)</div>
        <div class="set-row"><button type="button" class="ghost" id="backupExport">백업 파일 저장</button><button type="button" class="ghost" id="backupImport">백업 불러오기</button></div>
        <input type="file" id="backupFile" accept="application/json,.json" hidden>
      </section>
      <section class="set-sec">
        <h4>앱 정보</h4>
        <div class="mdesc2" id="appInfo"></div>
        <div class="mdesc2" id="widgetHint" hidden></div>
        <div class="set-row"><button type="button" class="ghost" id="updCheck" hidden>업데이트 확인</button><button type="button" class="danger" id="wipeAll">모든 데이터 삭제</button></div>
      </section>
    </div>
    <div class="mfoot"><button type="button" class="ghost" id="settingsClose">닫기</button></div>
  </div>
</div>

<div class="modal-back" id="onboardModal" hidden>
  <div class="modal" role="dialog" aria-modal="true" aria-label="처음 설정">
    <h3>업무 워크벤치에 오신 것을 환영합니다</h3>
    <div class="mlist set-list">
      <div class="mdesc2">할일·캘린더·회의록을 한 곳에서 관리합니다. 모든 데이터는 <b>이 휴대폰에만</b> 저장됩니다.</div>
      <section class="set-sec">
        <h4>1. Gemini API 키</h4>
        <div class="mdesc2">음성 받아쓰기, 회의록 정리, 할일 자동 분류에 필요합니다. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>에서 무료로 만들 수 있습니다. 키 없이도 할일·캘린더·직접 쓰는 메모는 쓸 수 있고, 나중에 설정에서 넣어도 됩니다.</div>
        <input id="obKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="AIza... 키 붙여넣기">
      </section>
      <section class="set-sec">
        <h4>2. 내 직무 (선택)</h4>
        <input id="obProfile" type="text" maxlength="120" placeholder="예: 반도체 장비 제어 엔지니어">
      </section>
      <section class="set-sec">
        <label class="ob-agree"><input type="checkbox" id="obAgree"><span>녹음한 음성과 입력한 메모가 <b>내 API 키로 Google Gemini에 전송되어 처리</b>되는 것에 동의합니다. 회사 보안 규정상 사내 회의 내용을 외부에 보낼 수 없다면 음성·AI 기능을 쓰지 마세요.</span></label>
        <div class="mdesc2" id="obMsg" style="color:var(--danger)"></div>
      </section>
    </div>
    <div class="mfoot"><button type="button" class="ghost" id="obSkip">나중에</button><button type="button" class="primary" id="obOk" disabled>시작하기</button></div>
  </div>
</div>

''')

cut('  document.getElementById("menuReload").addEventListener', '  document.getElementById("menuVocab").addEventListener')

# --- 문구: 개인 저장 안내 / 예시에서 사람·프로젝트 이름 제거 ---
sub1('이 서버(우리 집 홈서버)에만 데이터가 저장됩니다.', '데이터는 개별 모바일에 저장됩니다.')
sub1('담당 김대리 / 견적 회신 대기', '담당 OOO / OOO 회신 대기')
sub1('예: A라인 설비 개조 킥오프', '예: OOO 프로젝트 킥오프')
sub1('예: A라인 설비 개조 (없으면', '예: OOO 프로젝트 (없으면')

# --- 녹음 안내 문구: 받아쓰기 간격 안내 ---
sub1('녹음 버튼을 눌러 시작 (화면을 켠 채로)', '10분마다 끊어서 받아쓰기합니다. 글은 10분 단위로 추가됩니다.')
sub1("setRecStatus('녹음 중... 다시 누르면 종료' +", "setRecStatus('녹음 중... ' + segLabel() + '마다 글로 변환되어 메모에 추가됩니다. 화면을 켠 채로 두세요. 다시 누르면 종료' +")
sub1("setRecStatus('변환 완료. 메모에 추가됐습니다.');\n  }", "setRecStatus('변환 완료. 메모에 추가됐습니다.');\n  }\n  function idleHint() { return segLabel() + '마다 끊어서 받아쓰기합니다. 글은 ' + segLabel() + ' 단위로 추가됩니다.'; }")

# --- CSS ---
sub1('</style>\n</head>', '''.set-list { padding-bottom: 8px; }
.set-sec { padding: 12px 0; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.set-sec:last-child { border-bottom: 0; }
.set-sec h4 { font-size: 13px; }
.set-row { display: flex; gap: 8px; flex-wrap: wrap; }
.set-row input { flex: 1 1 180px; min-width: 0; }
.mdesc2 { font-size: 12px; color: var(--muted); line-height: 1.55; overflow-wrap: anywhere; }
.ob-agree { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.55; }
.ob-agree input { margin-top: 3px; flex: 0 0 auto; width: 18px; height: 18px; }
#ptr { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 6px); left: 50%; z-index: 80; background: var(--surface); color: var(--fg); border: 1px solid var(--border); border-radius: 999px; padding: 7px 16px; font-size: 13px; box-shadow: 0 4px 14px rgba(0,0,0,.2); pointer-events: none; white-space: nowrap; transform: translate(-50%, -40px); }
#ptr.ready { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.set-pick { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-size: 13px; }
.set-pick select { min-width: 150px; }
.qrow { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.muted2 { color: var(--muted); font-size: 12px; }
.qbar { position: relative; height: 12px; border-radius: 99px; background: var(--border); overflow: hidden; margin: 6px 0; }
.qbar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
.qbar.warn i { background: #d97706; } .qbar.danger i { background: var(--danger); }
.qbar b { position: absolute; left: 0; top: 0; bottom: 0; background: #1d4ed8; min-width: 2px; }
.set-list input[type=password], .set-list input[type=text] { width: 100%; }
</style>
</head>''')

# --- 스크립트 포함 ---
sub1('<script>\n(function () {\n  "use strict";\n  var API = "/api";',
     '''<script src="js/config.js"></script>
<script src="js/holidays-data.js"></script>
<script src="js/localdb.js"></script>
<script src="js/settings.js"></script>
<script src="js/ai.js"></script>
<script src="js/api.js"></script>
<script src="js/notify.js"></script>
<script src="js/native.js"></script>
<script src="js/sync.js"></script>
<script src="js/gcal.js"></script>
<script src="js/updater.js"></script>
<script src="js/widget.js"></script>
<script>
(function () {
  "use strict";''')

# --- api(): 앱 안 처리로 교체 ---
cut('  // 로그인이 풀리면(401)', '  async function loadTasks()', '''  async function api(path, opts) {
    try { return await window.LocalApi.request(path, opts); }
    catch (e) { if (e && e.code) { aiFail(e); } throw e; }
  }

''')

# --- 사용량 문구 ---
sub1('"일일 한도는 태평양시 자정(한국 시각 " + d.resetKST + ")에 초기화됩니다', '"일일 한도는 태평양시 자정(내 기기 시각 " + d.resetKST + ")에 초기화됩니다')
sub1('이 수치는 <b>업무 워크벤치가 보낸 호출만</b> 집계합니다. 같은 API 키를 쓰는 다른 프로그램의 호출은 포함되지 않고, 한도는', '이 수치는 <b>이 앱이 보낸 호출만</b> 집계합니다. 같은 API 키를 다른 곳에서도 쓴다면 그 호출은 포함되지 않고, 한도는')

# --- 녹음: 서버 변환 -> 앱에서 Gemini 직접 호출 ---
sub1('  var SEG_MS = 15000;', '  function segMs() { return Math.max(0.02, Number(Settings.get("segmentMin")) || 10) * 60000; }')
sub1('}, SEG_MS);', '}, segMs());')
sub1('서버 Whisper로 보내', 'Gemini로 보내')
cut('  async function transcribeSegment(blob) {', '  // 폰 기본 녹음기 등으로', '''  async function transcribeSegment(blob) {
    // 재시도는 AI.generate 안에서 이미 처리한다. 최종 실패하면 오류를 올려 구간을 보관한다.
    return AI.transcribe(blob, (blob.type || "audio/webm").split(";")[0]);
  }

''')
sub1('    try { text = await transcribeSegment(blob); } catch (e) { text = ""; }',
     '''    try { text = await transcribeSegment(blob); }
    catch (e) {
      text = ""; rec.failed++;
      try { await DB.put("segments", { id: DB.uid(), t: Date.now(), mime: blob.type, blob: blob }); } catch (e2) {}
      aiFail(e);
    }''')
sub1('wakeLock: null, keepAlive: null, nextSeq: 0,', 'wakeLock: null, keepAlive: null, failed: 0, nextSeq: 0,')
sub1("    rec.nextSeq = 0; rec.appendSeq = 0; rec.results = {}; rec.pending = 0;", "    if (!rec.pending) { rec.nextSeq = 0; rec.appendSeq = 0; rec.results = {}; }   // 이전 녹음의 변환이 아직 진행 중이면 순번·대기 수를 건드리지 않는다\n    rec.failed = DB.all(\"segments\").length;")
sub1("    setRecStatus('변환 완료. 메모에 추가됐습니다.');", "    setRecStatus(rec.failed ? '<b>' + rec.failed + '개 구간을 변환하지 못했습니다.</b> 녹음은 보관돼 있으니 <a href=\"#\" id=\"retrySegs\">다시 변환</a>을 눌러 보세요.' : '변환 완료. 메모에 추가됐습니다.');")

# 파일 변환
cut('''      try {
        st.innerHTML = '<span class="thinking"><span class="spinner"></span>'+tag+'업로드 중''', '''    st.textContent = failed ?''', '''      try {
        st.innerHTML = '<span class="thinking"><span class="spinner"></span>'+tag+'텍스트로 변환 중... ('+(f.size/1048576).toFixed(1)+'MB, 길면 수 분 걸립니다. 이 화면을 켜 두세요)</span>';
        var text = await AI.transcribe(f, audioMime(f));
        var ta = document.getElementById("rawNotes");
        if (text) { ta.value = (ta.value ? ta.value + "\\n" : "") + text; saveDraft(); }
        done++;
      } catch (err) { failed++; aiFail(err); }
    }
''')
sub1("  document.getElementById(\"fileBtn\").addEventListener(\"click\"", '''  function audioMime(f) {
    if (f.type && /^audio\\//.test(f.type)) return f.type;
    var ext = (f.name.split(".").pop() || "").toLowerCase();
    return { m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm", "3gp": "audio/mp4", amr: "audio/amr" }[ext] || "audio/mp4";
  }
  document.getElementById("recStatus").addEventListener("click", async function(e) {
    if (e.target.id !== "retrySegs") return;
    e.preventDefault();
    var list = DB.all("segments").slice().sort(function(a, b) { return a.t - b.t; }), ok = 0;
    for (var i = 0; i < list.length; i++) {
      setRecStatus('<span class="thinking"><span class="spinner"></span>다시 변환 중... (' + (i + 1) + '/' + list.length + ')</span>');
      try {
        var text = await AI.transcribe(list[i].blob, (list[i].mime || "audio/webm").split(";")[0]);
        var ta = document.getElementById("rawNotes");
        if (text) ta.value = ta.value + (ta.value && !/\\s$/.test(ta.value) ? " " : "") + text;
        await DB.del("segments", list[i].id); ok++; saveDraft();
      } catch (err) { aiFail(err); break; }
    }
    rec.failed = DB.all("segments").length; refreshRecStatus();
  });
  document.getElementById("fileBtn").addEventListener("click"''')

# AI 정리
sub1('      statusEl.textContent = "정리에 실패했습니다. 다시 시도해보세요.";', '      statusEl.textContent = (err && err.code) ? err.message : "정리에 실패했습니다. 다시 시도해보세요."; keyHint(err);')
sub1('''      await loadMeetings(); await loadTasks();
    } catch (err) {
      document.getElementById("aiStatus").textContent = "저장에 실패했습니다.";''', '''      clearDraft();
      await loadMeetings(); await loadTasks();
    } catch (err) {
      document.getElementById("aiStatus").textContent = "저장에 실패했습니다.";''')
sub1('} catch (err) { toast("AI 제안을 받지 못했습니다. 잠시 후 다시 시도해주세요."); }', '} catch (err) { if (!(err && err.code)) toast("AI 제안을 받지 못했습니다. 잠시 후 다시 시도해주세요."); }')

sub1('''  document.getElementById("recBtn").addEventListener("click", async function() {
    var btn = document.getElementById("recBtn");''', '''  document.getElementById("recBtn").addEventListener("click", async function() {
    if (nativeRecPlugin()) { return nativeToggle(); }
    var btn = document.getElementById("recBtn");''')

# 푸시 / 설치 블록 제거 (알림은 notify.js)
cut('  // ---------- 푸시 알림(마감일 알람) ----------', '  // ---------- 프로젝트 ----------')

# 새 UI 블록 삽입 + 부팅
sub1('  // ---------- 초기화 ----------', ui_block + '\n  // ---------- 초기화 ----------')
sub1('  loadTasks();\n  loadMeetings();\n  loadVocab();\n  initPush();\n})();', '  bootStandalone();\n})();')

# 메뉴 닫힘/menuReload 참조 점검
if "menuReload" in s: sys.exit("menuReload 참조가 남아 있음")
if 'id="menuReload"' in s: sys.exit("x")
(root / "www" / "index.html").write_text(s, encoding="utf-8")
print("OK", len(s.splitlines()), "lines")
