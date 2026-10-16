  // ---------- 설정 / 첫 실행 / 백업 / 임시저장 (독립형 앱) ----------
  var Settings = window.Settings, AI = window.AI, DB = window.DB;
  var APP_VERSION = "0.1.0";

  function aiMsg(err, fallback) { return (err && err.code) ? err.message : fallback; }
  function keyHint(err) {
    if (err && (err.code === "NO_KEY" || err.code === "BAD_KEY")) toast(err.message, { label: "설정 열기", fn: function () { openSettings(); } });
  }
  function aiFail(err) { toast(aiMsg(err, "AI 처리에 실패했습니다.")); keyHint(err); }

  // 작성 중인 회의록(회의명·직접 메모·음성 원문)을 자동으로 임시저장해서 앱이 꺼져도 사라지지 않게 한다
  var draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      var d = { title: document.getElementById("mTitle").value, notes: document.getElementById("userNotes").value, raw: document.getElementById("rawNotes").value };
      if (!d.title && !d.notes && !d.raw) Settings.remove("draft"); else Settings.set("draft", d);
    }, 500);
  }
  function clearDraft() { clearTimeout(draftTimer); Settings.remove("draft"); }
  function restoreDraft() {
    var d = Settings.get("draft");
    if (d && typeof d === "object") {
      document.getElementById("mTitle").value = d.title || ""; document.getElementById("userNotes").value = d.notes || ""; document.getElementById("rawNotes").value = d.raw || "";
    }
  }
  ["mTitle", "userNotes", "rawNotes"].forEach(function (id) { document.getElementById(id).addEventListener("input", saveDraft); });

  // ---- 설정 창 ----
  var settingsModalEl = document.getElementById("settingsModal");
  function hideSettings() { settingsModalEl.hidden = true; }
  function closeSettings() { hideSettings(); closeOverlayUI("settingsApp"); }
  function maskKey(k) { return k ? "●●●● " + k.slice(-4) : ""; }
  function refreshSettings() {
    var k = Settings.get("apiKey");
    document.getElementById("keyStatus").textContent = k ? "설정됨 (" + maskKey(k) + ")" : "아직 설정되지 않았습니다. 회의록 정리·음성 받아쓰기·자유 입력에 필요합니다.";
    document.getElementById("profileInput").value = Settings.get("profile") || "";
    document.getElementById("appInfo").textContent = "독립형 앱 v" + APP_VERSION + " · 할일 " + DB.all("tasks").length + "건 · 회의록 " + DB.all("meetings").length + "건 · 데이터는 이 기기에만 저장됩니다.";
    refreshDrive();
    document.getElementById("updCheck").hidden = !(window.Updater && Updater.available());
    var sec = document.getElementById("notifySec");
    if (window.Notify && window.Notify.isNative && window.Notify.isNative()) {
      sec.hidden = false;
      window.Notify.status().then(function (s) {
        document.getElementById("notifyStatus").textContent = (s.permission === "granted" ? "알림 허용됨" : "알림이 꺼져 있습니다") + " · "
          + (s.exact === false ? "정확한 시각 알람이 꺼져 있어 몇 분 늦을 수 있습니다" : "정확한 시각 알람 사용 가능") + " · 예약된 알림 " + s.pending + "개";
      });
    } else { sec.hidden = false; document.getElementById("notifyStatus").textContent = "알림은 안드로이드 앱(APK)에서 동작합니다. 지금은 브라우저 모드입니다."; }
  }
  function fmtAgo(ms) { var s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? "방금" : s < 3600 ? Math.floor(s / 60) + "분 전" : s < 86400 ? Math.floor(s / 3600) + "시간 전" : Math.floor(s / 86400) + "일 전"; }
  function refreshDrive() {
    var st = document.getElementById("driveStatus"), on = window.Sync && Sync.enabled(), err = Settings.get("driveErr");
    if (!window.Sync || !Sync.available()) { st.textContent = "구글 드라이브 동기화는 안드로이드 앱에서만 쓸 수 있습니다. 지금은 브라우저 모드입니다."; document.getElementById("driveConnect").hidden = true; return; }
    document.getElementById("driveConnect").hidden = on; document.getElementById("driveNow").hidden = !on; document.getElementById("driveOff").hidden = !on;
    st.textContent = (Sync.state.running ? "동기화 중..." : on ? "연결됨" + (Settings.get("driveLast") ? " · 마지막 동기화 " + fmtAgo(Settings.get("driveLast")) : "") : "연결되지 않았습니다.")
      + (err && on ? " · 오류: " + err.msg : "");
  }
  function openSettings() {
    if (!onboardEl.hidden) { onboardEl.hidden = true; closeOverlayUI("onboard"); }
    settingsModalEl.hidden = false; pushOverlay("settingsApp", hideSettings); refreshSettings();
  }
  document.getElementById("menuSettings").addEventListener("click", function () { hideMenu(); dropOverlay("menu"); openSettings(); });
  document.getElementById("settingsClose").addEventListener("click", closeSettings);
  settingsModalEl.addEventListener("click", function (e) { if (e.target === settingsModalEl) closeSettings(); });

  document.getElementById("keySave").addEventListener("click", async function () {
    var v = document.getElementById("keyInput").value.trim(), btn = this, st = document.getElementById("keyStatus");
    if (!v) { st.textContent = "키를 붙여넣어 주세요."; return; }
    btn.disabled = true; st.textContent = "키를 확인하는 중...";
    try { await AI.testKey(v); document.getElementById("keyInput").value = ""; toast("키를 확인했습니다"); }
    catch (e) { st.textContent = aiMsg(e, "키를 확인하지 못했습니다."); btn.disabled = false; return; }
    btn.disabled = false; refreshSettings();
  });
  document.getElementById("profileInput").addEventListener("change", function () { Settings.set("profile", this.value.trim()); toast("직무 설명을 저장했습니다"); });

  // 구글 드라이브 동기화
  if (window.Sync) {
    Sync.state.onState = function () { if (!settingsModalEl.hidden) refreshDrive(); };
    Sync.onApplied(function () { loadTasks(); loadMeetings(); loadVocab(); if (window.Notify) window.Notify.sync(); });
  }
  document.getElementById("driveConnect").addEventListener("click", async function () {
    var b = this; b.disabled = true; document.getElementById("driveStatus").textContent = "구글 계정에 연결하는 중...";
    try { await Sync.connect(); toast("구글 드라이브와 동기화했습니다"); }
    catch (e) { if (!e || e.code !== "CANCELED") toast((e && e.message) || "연결하지 못했습니다."); }
    b.disabled = false; refreshDrive();
  });
  document.getElementById("driveNow").addEventListener("click", async function () {
    var b = this; b.disabled = true;
    try { await Sync.run({ interactive: false }); toast("동기화했습니다"); }
    catch (e) { toast((e && e.message) || "동기화하지 못했습니다."); }
    b.disabled = false; refreshDrive();
  });
  document.getElementById("driveOff").addEventListener("click", async function () {
    var r = await askConfirm([{ title: "연결 해제", ok: "해제", danger: true, html: '<div class="cf-body">이 기기의 동기화를 끕니다. 이 기기의 데이터와 드라이브에 올라간 데이터는 지워지지 않고, 다른 기기와 더 이상 자동으로 맞춰지지 않습니다.</div>' }]);
    if (r.ok) { await Sync.disconnect(); refreshDrive(); }
  });

  // 알림(안드로이드 앱에서만)
  document.getElementById("notifyPerm").addEventListener("click", async function () {
    if (!window.Notify || !window.Notify.isNative()) { toast("알림은 안드로이드 앱에서 동작합니다"); return; }
    await window.Notify.requestAll(); await window.Notify.sync(); refreshSettings();
  });
  document.getElementById("notifyTest").addEventListener("click", async function () {
    if (!window.Notify || !window.Notify.isNative()) { toast("알림은 안드로이드 앱에서 동작합니다"); return; }
    await window.Notify.test(); toast("10초 뒤에 테스트 알림이 옵니다. 앱을 닫아도 됩니다.");
  });

  // 백업 내보내기/불러오기
  async function saveBackupFile(text, filename) {
    if (window.NativeFiles && window.NativeFiles.share) { await window.NativeFiles.share(text, filename); return; }
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  }
  document.getElementById("backupExport").addEventListener("click", async function () {
    var d = new Date(), pad = function (n) { return (n < 10 ? "0" : "") + n; };
    var name = "업무워크벤치-백업-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + ".json";
    try { await saveBackupFile(JSON.stringify(DB.dump(false)), name); toast("백업 파일을 만들었습니다"); } catch (e) { toast("백업 파일을 만들지 못했습니다"); }
  });
  document.getElementById("backupImport").addEventListener("click", function () { document.getElementById("backupFile").click(); });
  document.getElementById("backupFile").addEventListener("change", async function (e) {
    var f = e.target.files[0]; e.target.value = ""; if (!f) return;
    var obj; try { obj = JSON.parse(await f.text()); if (obj.app !== "workhub-standalone") throw new Error("x"); } catch (err) { toast("올바른 백업 파일이 아닙니다"); return; }
    var n = (obj.data.tasks || []).length, m = (obj.data.meetings || []).length;
    var r = await askConfirm([{ title: "백업 불러오기", ok: "불러오기", danger: true,
      html: '<div class="cf-body">백업 파일의 할일 <b>' + n + '건</b>, 회의록 <b>' + m + '건</b>으로 <span class="cf-warn">현재 데이터를 모두 대체</span>합니다. (API 키는 유지됩니다)</div>' }]);
    if (!r.ok) return;
    try { await DB.restore(obj); await loadTasks(); await loadMeetings(); await loadVocab(); refreshSettings(); toast("백업을 불러왔습니다"); if (window.Notify) window.Notify.sync(); }
    catch (err) { toast("백업을 불러오지 못했습니다"); }
  });
  document.getElementById("wipeAll").addEventListener("click", async function () {
    var r = await askConfirm([
      { title: "모든 데이터 삭제", ok: "다음", html: '<div class="cf-body">할일 ' + DB.all("tasks").length + '건, 회의록 ' + DB.all("meetings").length + '건, 프로젝트, 용어 사전을 모두 지웁니다. API 키와 설정은 남습니다.</div>' },
      { title: "정말 삭제할까요?", ok: "모두 삭제", danger: true, html: '<div class="cf-body"><span class="cf-warn">이 작업은 되돌릴 수 없습니다.</span> 필요하면 먼저 "백업 파일 저장"을 해 두세요.' + (window.Sync && Sync.enabled() ? '<br><span class="cf-warn">구글 드라이브 동기화가 켜져 있어 다른 기기의 데이터도 함께 삭제됩니다.</span>' : '') + '</div>' }]);
    if (!r.ok) return;
    await DB.wipeData(); await loadTasks(); await loadMeetings(); await loadVocab(); refreshSettings(); toast("모든 데이터를 삭제했습니다"); if (window.Notify) window.Notify.sync();
  });

  // ---- 첫 실행 안내 ----
  var onboardEl = document.getElementById("onboardModal");
  function hideOnboard() { onboardEl.hidden = true; }
  function openOnboarding() { if (!onboardEl.hidden) return; onboardEl.hidden = false; pushOverlay("onboard", hideOnboard); }
  function updateObOk() { document.getElementById("obOk").disabled = !(document.getElementById("obAgree").checked && document.getElementById("obKey").value.trim().length > 10); }
  document.getElementById("obAgree").addEventListener("change", updateObOk);
  document.getElementById("obKey").addEventListener("input", updateObOk);
  document.getElementById("obSkip").addEventListener("click", function () { hideOnboard(); closeOverlayUI("onboard"); });
  document.getElementById("obOk").addEventListener("click", async function () {
    var btn = this, msg = document.getElementById("obMsg"); btn.disabled = true; msg.textContent = "키를 확인하는 중...";
    try {
      await AI.testKey(document.getElementById("obKey").value.trim());
      var prof = document.getElementById("obProfile").value.trim(); if (prof) await Settings.set("profile", prof);
      document.getElementById("obKey").value = ""; msg.textContent = "";
      hideOnboard(); closeOverlayUI("onboard"); toast("설정이 끝났습니다. 시작해 보세요!");
    } catch (e) { msg.textContent = aiMsg(e, "키를 확인하지 못했습니다."); updateObOk(); }
  });

  // ---- 앱 업데이트 ----
  function showUpdate(u) {
    var b = document.getElementById("updateBanner");
    if (!u) { b.hidden = true; return; }
    document.getElementById("updateText").textContent = "새 버전 " + u.version + "이 있습니다 (현재 " + u.current + ")";
    b.hidden = false;
  }
  async function checkUpdate(force) {
    if (!window.Updater || !Updater.available()) return;
    try { var u = await Updater.check(force); showUpdate(u); if (force) toast(u ? "새 버전 " + u.version + "이 있습니다" : "최신 버전입니다"); }
    catch (e) { if (force) toast("업데이트를 확인하지 못했습니다."); }
  }
  document.getElementById("updateLater").addEventListener("click", function () { showUpdate(null); });
  document.getElementById("updateGo").addEventListener("click", async function () {
    var btn = this, txt = document.getElementById("updateText"), base = txt.textContent;
    btn.disabled = true; txt.textContent = "내려받는 중... 0%";
    try {
      await Updater.install(function (pct) { txt.textContent = "내려받는 중... " + pct + "%"; });
      txt.textContent = "설치 화면에서 '설치'를 눌러 주세요.";
    } catch (e) {
      txt.textContent = base;
      toast(e && e.code === "NEED_PERMISSION" ? "설정에서 '이 출처 허용'을 켠 뒤, 돌아와서 업데이트를 다시 눌러 주세요." : ((e && e.message) || "업데이트하지 못했습니다."), null);
    }
    btn.disabled = false;
  });
  document.getElementById("updCheck").addEventListener("click", function () { checkUpdate(true); });

  function bootStandalone() {
    return DB.init().then(function () {
      restoreDraft();
      loadTasks(); loadMeetings(); loadVocab();
      nativeResume();
      checkUpdate(false);
      document.getElementById("updCheck").hidden = !(window.Updater && Updater.available());
      DB.onChange(function () { Sync.schedule(); });
      Sync.run().catch(function () {});
      document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { Sync.run().catch(function () {}); checkUpdate(false); } });
      setTimeout(function () { if (!Settings.get("apiKey")) openOnboarding(); }, 500);
      if (window.Notify) { window.LocalApi.on("tasks", function () { window.Notify.sync(); }); window.Notify.init().then(function () { window.Notify.sync(); }); }
    }).catch(function (e) {
      document.body.insertAdjacentHTML("afterbegin", '<div style="padding:16px;color:#c00">저장소를 열지 못했습니다: ' + (e && e.message) + '</div>');
    });
  }

  // ---------- 안드로이드 앱: 화면이 꺼져도 계속되는 네이티브 녹음 ----------
  // 서비스가 일정 길이마다 m4a 조각 파일을 만들면, 여기서 파일을 읽어 Gemini로 변환해 메모에 이어 붙이고 파일을 지운다.
  // 화면이 없는 사이에 만들어진 조각은 파일로 남아 있다가 앱을 열 때(visibilitychange/부팅) 처리된다.
  var NR = { active: false, busy: false, failed: 0, left: 0, poll: null, timer: null, startedAt: 0 };
  function nativeRecPlugin() {
    var C = window.Capacitor;
    return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.WorkhubRecorder) || null;
  }
  function nativeStatus() {
    if (NR.failed) { setRecStatus('<b>' + NR.failed + '개 구간을 변환하지 못했습니다.</b> 녹음은 보관돼 있으니 <a href="#" id="retryNative">다시 변환</a>을 눌러 보세요.'); return; }
    if (NR.active) { setRecStatus('녹음 중... 화면을 꺼도 계속됩니다. 다시 누르면 종료' + (NR.left ? ' · 변환 대기 ' + NR.left + '건' : '')); return; }
    if (NR.busy || NR.left) { setRecStatus('<span class="thinking"><span class="spinner"></span>변환 중... (' + NR.left + '건)</span>'); return; }
    setRecStatus('변환 완료. 메모에 추가됐습니다.');
  }
  function appendTranscript(text) {
    var ta = document.getElementById("rawNotes");
    if (text) { ta.value = ta.value + (ta.value && !/\s$/.test(ta.value) ? " " : "") + text; saveDraft(); }
  }
  async function processNativePending() {
    var P = nativeRecPlugin(); if (!P || NR.busy) return;
    NR.busy = true;
    try {
      var files = (await P.pending()).files || [];
      NR.left = files.length; NR.failed = 0; nativeStatus();
      for (var i = 0; i < files.length; i++) {
        try {
          var blob = await (await fetch(window.Capacitor.convertFileSrc("file://" + files[i].path))).blob();
          var text = await AI.transcribe(blob, "audio/mp4");
          appendTranscript(text);
          await P.remove({ name: files[i].name });
          NR.left--; nativeStatus();
        } catch (e) { NR.failed = files.length - i; aiFail(e); break; }   // 실패한 조각부터는 파일이 남아 있고, '다시 변환'으로 이어서 처리
      }
    } finally { NR.busy = false; if (!NR.failed) NR.left = 0; nativeStatus(); }
  }
  async function nativeToggle() {
    var P = nativeRecPlugin();
    var btn = document.getElementById("recBtn");
    if (NR.active) {
      NR.active = false; clearInterval(NR.poll); clearInterval(NR.timer); btn.classList.remove("recording");
      try { await P.stop(); } catch (e) {}
      NR.left = 1; nativeStatus();
      setTimeout(processNativePending, 800);   // 마지막 조각이 파일로 확정될 시간을 준다
      return;
    }
    if (!Settings.get("apiKey")) { toast("음성 받아쓰기에는 Gemini API 키가 필요합니다.", { label: "설정 열기", fn: function () { openSettings(); } }); return; }
    try { await P.start({ segmentSec: Math.round((Number(Settings.get("segmentMin")) || 10) * 60) }); }
    catch (e) { setRecStatus(e && e.code === "NO_MIC" ? "마이크 권한이 필요합니다. 휴대폰 설정 > 앱 > 업무 워크벤치 > 권한에서 허용해 주세요." : "녹음을 시작하지 못했습니다."); return; }
    NR.active = true; NR.failed = 0; NR.startedAt = Date.now();
    btn.classList.add("recording"); nativeStatus();
    NR.timer = setInterval(function () { document.getElementById("recTimer").textContent = fmtTimer(Math.floor((Date.now() - NR.startedAt) / 1000)); }, 500);
    NR.poll = setInterval(processNativePending, 15000);
  }
  document.getElementById("recStatus").addEventListener("click", function (e) {
    if (e.target.id !== "retryNative") return;
    e.preventDefault(); NR.failed = 0; processNativePending();
  });
  // 화면으로 돌아왔을 때: 녹음 중이었다면 상태를 되살리고, 쌓인 조각을 처리
  async function nativeResume() {
    var P = nativeRecPlugin(); if (!P) return;
    var st = await P.status(), btn = document.getElementById("recBtn");
    if (st.recording && !NR.active) {
      NR.active = true; NR.startedAt = st.startedAt || Date.now(); btn.classList.add("recording");
      clearInterval(NR.timer); NR.timer = setInterval(function () { document.getElementById("recTimer").textContent = fmtTimer(Math.floor((Date.now() - NR.startedAt) / 1000)); }, 500);
      clearInterval(NR.poll); NR.poll = setInterval(processNativePending, 15000);
      nativeStatus();
    }
    if (Settings.get("apiKey")) processNativePending();
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") nativeResume(); });
