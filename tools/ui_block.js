  // ---------- 설정 / 첫 실행 / 백업 / 임시저장 (독립형 앱) ----------
  var Settings = window.Settings, AI = window.AI, DB = window.DB;
  var APP_VERSION = "";   // 안드로이드 앱에서는 실제 설치된 버전으로 채운다

  function aiMsg(err, fallback) { return (err && err.code) ? err.message : fallback; }
  function keyHint(err) {
    if (err && (err.code === "NO_KEY" || err.code === "BAD_KEY")) toast(err.message, { label: "설정 열기", fn: function () { openSettings(); } });
  }
  function aiFail(err) { toast(aiMsg(err, "AI 처리에 실패했습니다.")); keyHint(err); }

  // 작성 중인 회의록(회의명·참석자·직접 메모·음성 원문)을 자동으로 임시저장해서 앱이 꺼져도 사라지지 않게 한다
  var draftTimer = null;
  function saveDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      var d = { title: document.getElementById("mTitle").value, notes: document.getElementById("userNotes").value, raw: document.getElementById("rawNotes").value, people: document.getElementById("mParticipants").value };
      if (!d.title && !d.notes && !d.raw && !d.people) Settings.remove("draft"); else Settings.set("draft", d);
    }, 500);
  }
  function clearDraft() { clearTimeout(draftTimer); Settings.remove("draft"); }
  function restoreDraft() {
    var d = Settings.get("draft");
    if (d && typeof d === "object") {
      document.getElementById("mTitle").value = d.title || ""; document.getElementById("userNotes").value = d.notes || ""; document.getElementById("rawNotes").value = d.raw || ""; document.getElementById("mParticipants").value = d.people || "";
    }
  }
  ["mTitle", "userNotes", "rawNotes", "mParticipants"].forEach(function (id) { document.getElementById(id).addEventListener("input", saveDraft); });

  // ---- 설정 창 ----
  var settingsModalEl = document.getElementById("settingsModal");
  function hideSettings() { settingsModalEl.hidden = true; }
  function closeSettings() { hideSettings(); closeOverlayUI("settingsApp"); }
  function maskKey(k) { return k ? "●●●● " + k.slice(-4) : ""; }
  function refreshSettings() {
    var k = Settings.get("apiKey");
    document.getElementById("keyStatus").textContent = k ? "설정됨 (" + maskKey(k) + ")" : "아직 설정되지 않았습니다. 회의록 정리·음성 받아쓰기·자유 입력에 필요합니다.";
    document.getElementById("profileInput").value = Settings.get("profile") || "";
    var sk = document.getElementById("syncKeyBox"), driveOn = window.Sync && Sync.enabled();
    sk.checked = !!Settings.get("syncKey") && driveOn; sk.disabled = !driveOn;
    document.getElementById("syncKeyHint").textContent = driveOn ? "(켜면 키가 내 드라이브의 앱 전용 폴더에 저장됩니다)" : "(구글 드라이브 동기화를 먼저 연결해야 합니다)";
    var infoEl = document.getElementById("appInfo");
    if (!APP_VERSION && window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins.WorkhubUpdate) {
      Capacitor.Plugins.WorkhubUpdate.version().then(function (v) { APP_VERSION = String(v.versionName).replace(/^v/i, ""); infoEl.textContent = infoEl.textContent.replace("독립형 앱", "독립형 앱 v" + APP_VERSION); });
    }
    infoEl.textContent = "독립형 앱" + (APP_VERSION ? " v" + APP_VERSION : "") + " · 할일 " + DB.all("tasks").length + "건 · 회의록 " + DB.all("meetings").length + "건 · " + (window.Sync && Sync.enabled() ? "데이터는 이 기기와 내 구글 드라이브(앱 전용 폴더)에 저장됩니다." : "데이터는 이 기기에만 저장됩니다.");
    refreshDrive(); refreshNotifyPick(); refreshCal();
    var wh = document.getElementById("widgetHint");
    if (window.WidgetSync && WidgetSync.available()) { wh.hidden = false; WidgetSync.count().then(function (n) { wh.textContent = "홈 화면을 길게 눌러 위젯(할일 목록, 캘린더)을 추가할 수 있습니다." + (n ? " 지금 " + n + "개가 놓여 있습니다." : ""); }); } else wh.hidden = true;
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
    if (!window.Sync || !Sync.available()) { st.textContent = "구글 드라이브 동기화는 안드로이드 앱에서 쓸 수 있습니다. (웹 버전은 구글 로그인 설정이 아직 되어 있지 않습니다.)"; document.getElementById("driveConnect").hidden = true; return; }
    document.getElementById("driveConnect").hidden = on; document.getElementById("driveNow").hidden = !on; document.getElementById("driveOff").hidden = !on;
    st.textContent = (Sync.state.running ? "동기화 중..." : on ? "연결됨" + (Settings.get("driveLast") ? " · 마지막 동기화 " + fmtAgo(Settings.get("driveLast")) : "") : "연결되지 않았습니다.")
      + (err && on ? " · 오류: " + err.msg : "");
    renderUsage(on ? Settings.get("driveQuota") : null);
  }
  // ---- 구글 캘린더 내보내기 ----
  function refreshCal() {
    var sec = document.getElementById("calSec");
    if (!window.GCal || !GCal.available()) { document.getElementById("calStatus").textContent = "구글 캘린더 내보내기는 안드로이드 앱에서만 쓸 수 있습니다."; ["calToggle", "calNow", "calOpts", "calGuide"].forEach(function (i) { document.getElementById(i).hidden = true; }); return; }
    var on = GCal.enabled(), err = Settings.get("calErr"), last = Settings.get("calLast");
    document.getElementById("calToggle").hidden = false; document.getElementById("calToggle").textContent = on ? "끄기" : "켜기";
    document.getElementById("calToggle").className = on ? "ghost" : "primary";
    document.getElementById("calNow").hidden = !on; document.getElementById("calOpts").hidden = !on; document.getElementById("calGuide").hidden = !(on || Settings.get("calId"));
    document.getElementById("calMask").checked = !!Settings.get("calMask");
    document.getElementById("calTasks").checked = Settings.get("calTasks") !== false; document.getElementById("calMeets").checked = Settings.get("calMeets") !== false;
    document.getElementById("calStatus").textContent = GCal.state.running ? "맞추는 중..." : on ? "켜짐" + (last ? " · 마지막으로 맞춘 시각 " + fmtAgo(last) : "") + (err ? " · 오류: " + err.msg : "")
      : (err ? "오류: " + err.msg : "꺼져 있습니다. 켜면 구글 동의 화면이 한 번 나옵니다.");
  }
  if (window.GCal) GCal.state.onState = function () { if (!settingsModalEl.hidden) refreshCal(); };
  document.getElementById("calToggle").addEventListener("click", async function () {
    var b = this; b.disabled = true;
    try {
      if (!GCal.enabled()) {
        document.getElementById("calStatus").textContent = "구글 캘린더에 연결하는 중...";
        var r = await GCal.enable(); toast("구글 캘린더에 일정 " + r.total + "건을 맞췄습니다");
      } else {
        var c = await askConfirm([{ title: "구글 캘린더 내보내기 끄기", ok: "끄기", danger: true,
          html: '<div class="cf-body">내보내기를 끕니다.</div><label class="ob-agree" style="margin:8px 0"><input type="radio" name="calDel" value="keep" checked><span><b>일정은 그대로 두기</b><br><span class="mdesc2">구글 캘린더의 "업무 워크벤치" 캘린더와 일정이 남습니다. 더 이상 갱신되지 않습니다.</span></span></label>'
            + '<label class="ob-agree"><input type="radio" name="calDel" value="delete"><span><b>캘린더와 일정을 모두 삭제</b><br><span class="mdesc2 cf-warn">구글 캘린더에서 "업무 워크벤치" 캘린더가 삭제되고, 회사 캘린더에서도 일정이 사라집니다.</span></span></label>' }]);
        if (c.ok) { await GCal.disable((c.data.calDel || "keep") === "delete"); toast("끄기를 완료했습니다"); }
      }
    } catch (e) { toast((e && e.message) || "처리하지 못했습니다."); }
    b.disabled = false; refreshCal();
  });
  document.getElementById("calNow").addEventListener("click", async function () {
    var b = this; b.disabled = true;
    try { var r = await GCal.run({ interactive: false }); toast(r ? "맞췄습니다 (추가·수정 " + r.made + ", 삭제 " + r.removed + ")" : "맞출 내용이 없습니다"); }
    catch (e) { toast((e && e.message) || "맞추지 못했습니다."); }
    b.disabled = false; refreshCal();
  });
  document.getElementById("calMask").addEventListener("change", async function () {
    await Settings.set("calMask", this.checked); GCal.schedule(0);
  });
  document.getElementById("calTasks").addEventListener("change", async function () { await Settings.set("calTasks", this.checked); GCal.schedule(0); });
  document.getElementById("calMeets").addEventListener("change", async function () { await Settings.set("calMeets", this.checked); GCal.schedule(0); });

  // ---- 알림 시각 선택 ----
  var LEADS = [[0, "마감 시각 정각"], [5, "5분 전"], [10, "10분 전"], [15, "15분 전"], [30, "30분 전"], [60, "1시간 전"], [120, "2시간 전"], [180, "3시간 전"], [1440, "하루 전"]];
  function fillPick(sel, opts, cur) {
    var list = opts.slice();
    if (!list.some(function (o) { return o[0] === cur; })) list.push([cur, cur + (sel.id === "leadSel" ? "분 전" : "시")]);   // 다른 기기에서 넘어온 값도 보이게
    sel.innerHTML = list.map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join("");
    sel.value = String(cur);
  }
  function refreshNotifyPick() {
    var hours = []; for (var h = 0; h < 24; h++) hours.push([h, (h < 12 ? "오전 " : "오후 ") + (h % 12 === 0 ? 12 : h % 12) + "시"]);
    fillPick(document.getElementById("leadSel"), LEADS, Number(Settings.get("notifyLeadMin")));
    fillPick(document.getElementById("hourSel"), hours, Number(Settings.get("notifyHour")));
  }
  function onPick(key) {
    return async function () {
      await Settings.set(key, Number(this.value));
      if (window.Notify) { await Notify.sync(); }
      toast("알림 시각을 바꿨습니다"); refreshSettings();
    };
  }
  document.getElementById("leadSel").addEventListener("change", onPick("notifyLeadMin"));
  document.getElementById("hourSel").addEventListener("change", onPick("notifyHour"));

  // ---- 드라이브 저장공간 표시 + 80% 경고 ----
  function fmtBytes(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(1) + "GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + "MB" : n >= 1024 ? Math.round(n / 1024) + "KB" : n + "B"; }
  function fmtPct(x) { return x >= 10 ? Math.round(x) + "%" : x >= 1 ? x.toFixed(1) + "%" : x >= 0.01 ? x.toFixed(2) + "%" : "0.01% 미만"; }
  function renderUsage(q) {
    var box = document.getElementById("driveUsage");
    if (!q || !(window.Sync && Sync.enabled())) { box.hidden = true; return; }
    box.hidden = false;
    var bar = document.getElementById("qBar"), tot = document.getElementById("qTotalText"), at = document.getElementById("qAppText");
    if (q.limit && q.usage) {
      var p = q.usage / q.limit * 100, app = q.app / q.limit * 100;
      tot.textContent = "구글 계정 저장공간 " + fmtBytes(q.limit) + " 중 " + fmtBytes(q.usage) + " 사용 (" + fmtPct(p) + ")";
      bar.hidden = false; bar.className = "qbar" + (p >= 95 ? " danger" : p >= 80 ? " warn" : "");
      document.getElementById("qUsed").style.width = Math.min(100, p) + "%"; document.getElementById("qApp").style.width = Math.min(100, app) + "%";
      at.textContent = "이 앱 " + fmtBytes(q.app) + " (전체의 " + fmtPct(app) + ")  ·  파란 막대가 이 앱이 쓴 부분입니다";
    } else {
      bar.hidden = true;
      tot.textContent = q.usage ? "구글 계정 저장공간 " + fmtBytes(q.usage) + " 사용 (용량 제한 없음)" : "계정 전체 사용률을 읽지 못했습니다" + (q.totalErr ? " (" + q.totalErr + ")" : "");
      at.textContent = "이 앱 " + fmtBytes(q.app);
    }
  }
  function todayKey() { return AI.today(); }
  function checkQuotaWarn(q) {
    var b = document.getElementById("quotaBanner");
    if (!q || !q.limit || !q.usage || !(window.Sync && Sync.enabled())) { b.hidden = true; return; }
    var p = q.usage / q.limit * 100;
    if (p < 80) { b.hidden = true; return; }
    var msg = "구글 저장공간이 " + Math.round(p) + "% 찼습니다. 가득 차면 동기화가 실패하니 드라이브·Gmail·포토에서 불필요한 파일을 정리해 주세요.";
    document.getElementById("quotaText").textContent = msg;
    if (Settings.get("quotaDismiss") !== todayKey()) b.hidden = false;
    if (window.Notify && Settings.get("quotaNotify") !== todayKey()) { Settings.set("quotaNotify", todayKey()); Notify.alertNow(1999999997, "구글 저장공간 " + Math.round(p) + "% 사용 중", "용량이 가득 차기 전에 정리해 주세요. 가득 차면 동기화가 실패합니다."); }
  }
  document.getElementById("quotaClose").addEventListener("click", function () { document.getElementById("quotaBanner").hidden = true; Settings.set("quotaDismiss", todayKey()); });
  if (window.Sync) Sync.onUsage(function (q) { renderUsage(q); checkQuotaWarn(q); });

  function openSettings() {
    if (!onboardEl.hidden) { onboardEl.hidden = true; closeOverlayUI("onboard"); }
    settingsModalEl.hidden = false; pushOverlay("settingsApp", hideSettings); refreshSettings();
    if (window.Sync && Sync.enabled()) Sync.refreshUsage(false).catch(function () {});
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
  document.getElementById("syncKeyBox").addEventListener("change", async function () {
    var box = this, want = box.checked;
    box.checked = !want;   // 확인을 받은 뒤에만 바꾼다
    if (want) {
      var r = await askConfirm([{ title: "API 키 동기화", ok: "켜기", html: '<div class="cf-body">API 키를 <b>내 구글 드라이브의 앱 전용 숨김 폴더</b>에 올려 다른 기기와 맞춥니다.<br><span class="cf-warn">구글 계정이 탈취되면 키도 함께 노출될 수 있습니다.</span> 이 기기에 키가 없으면 드라이브에 올라간 키를 받아 옵니다.</div>' }]);
      if (!r.ok) return;
      await Settings.set("syncKey", true); await Settings.remove("keyWipe");
      var cur = Settings.raw("apiKey"); if (cur && cur.value) await Settings.set("apiKey", cur.value);   // 이 기기의 키를 최신으로 표시
    } else {
      var r2 = await askConfirm([{ title: "API 키 동기화 끄기", ok: "끄기", danger: true, html: '<div class="cf-body">드라이브에 올라간 키를 지웁니다. 각 기기에 저장된 키는 그대로 남습니다.</div>' }]);
      if (!r2.ok) return;
      await Settings.set("syncKey", false); await Settings.set("keyWipe", true);
    }
    try { await Sync.run({ interactive: false }); } catch (e) { toast((e && e.message) || "동기화하지 못했습니다."); }
    refreshSettings();
  });
  document.getElementById("profileInput").addEventListener("change", function () { Settings.set("profile", this.value.trim()); toast("직무 설명을 저장했습니다"); });

  // 구글 드라이브 동기화
  if (window.Sync) {
    Sync.state.onState = function () { if (!settingsModalEl.hidden) refreshDrive(); };
    Sync.onApplied(function () {
      loadTasks(); loadMeetings(); loadVocab(); if (window.Notify) window.Notify.sync(); WidgetSync.push(); if (window.GCal) GCal.schedule();
      refreshIdleHint();
      if (!settingsModalEl.hidden) refreshSettings();
      if (Settings.get("apiKey") && !onboardEl.hidden) { hideOnboard(); closeOverlayUI("onboard"); }   // 다른 기기에서 키가 넘어왔으면 첫 안내는 닫는다
    });
  }
  document.getElementById("driveConnect").addEventListener("click", async function () {
    var b = this; b.disabled = true; document.getElementById("driveStatus").textContent = "구글 계정에 연결하는 중...";
    try { await Sync.connect(); toast("구글 드라이브와 동기화했습니다"); }
    catch (e) { if (!e || e.code !== "CANCELED") toast((e && e.message) || "연결하지 못했습니다."); }
    b.disabled = false; refreshDrive();
  });
  document.getElementById("driveNow").addEventListener("click", async function () {
    var b = this; b.disabled = true;
    try { await Sync.run({ interactive: !Sync.isNative() }); await Sync.refreshUsage(true).catch(function () {}); toast("동기화했습니다"); }
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
    var r = await askConfirm([{ title: "백업 불러오기", ok: "불러오기",
      html: '<div class="cf-body">백업 파일: 할일 <b>' + n + '건</b>, 회의록 <b>' + m + '건</b><br>이 기기에는 할일 ' + DB.all("tasks").length + '건, 회의록 ' + DB.all("meetings").length + '건이 있습니다.</div>'
        + '<label class="ob-agree" style="margin:8px 0"><input type="radio" name="mode" value="merge" checked><span><b>합치기 (추천)</b><br><span class="mdesc2">이 기기의 데이터는 그대로 두고, 백업에만 있는 항목을 더합니다. 같은 파일을 다시 불러와도 중복되지 않습니다.</span></span></label>'
        + '<label class="ob-agree"><input type="radio" name="mode" value="replace"><span><b>대체</b><br><span class="mdesc2 cf-warn">현재 데이터를 모두 지우고 백업 내용으로 바꿉니다. (API 키는 유지됩니다)</span></span></label>' }]);
    if (!r.ok) return;
    try {
      if ((r.data.mode || "merge") === "merge") {
        var a = await Sync.mergeBackup(obj);
        await loadTasks(); await loadMeetings(); await loadVocab(); refreshSettings();
        toast("합쳤습니다: 할일 " + a.tasks + " · 회의록 " + a.meetings + " · 프로젝트 " + a.projects + " · 용어 " + a.vocab + "건 추가");
      } else {
        await DB.restore(obj); await loadTasks(); await loadMeetings(); await loadVocab(); refreshSettings(); toast("백업으로 바꿨습니다");
      }
      if (window.Notify) window.Notify.sync();
    }
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

  // ---- 당겨서 새로고침 (맨 위에서 아래로 쓸어내리기) ----
  async function pullRefresh() {
    var msg = "새로고침했습니다";
    if (window.Sync && Sync.enabled()) {
      try { await Sync.run(); await Sync.refreshUsage(true).catch(function () {}); }
      catch (e) { msg = (e && e.message) || "동기화하지 못했습니다."; }
    }
    await Promise.all([loadTasks(), loadMeetings(), loadVocab()]);
    if (window.GCal && GCal.enabled()) { try { await GCal.run(); } catch (e) { msg = (e && e.message) || msg; } }
    checkUpdate(false);
    toast(msg);
  }
  (function initPull() {
    var el = document.createElement("div"); el.id = "ptr"; el.hidden = true; document.body.appendChild(el);
    var st = null, busy = false, TH = 70;
    function root() { return document.scrollingElement || document.documentElement; }
    function recording() { return (typeof rec !== "undefined" && (rec.active || rec.interrupted)) || (typeof NR !== "undefined" && NR.active); }
    function blocked(t) { return !!document.querySelector(".modal-back:not([hidden])") || !!(t && t.closest && t.closest(".pi[data-taskid], textarea, input, select")); }
    function show(dy, ready, note) {
      el.hidden = false; el.style.transform = "translate(-50%, " + (Math.min(dy * 0.5, 90) - 40) + "px)";
      el.textContent = note || (busy ? "새로고침 중..." : ready ? "놓으면 새로고침" : "↓ 당겨서 새로고침"); el.classList.toggle("ready", !note && (ready || busy));
    }
    function hide() { el.hidden = true; }
    document.addEventListener("touchstart", function (e) {
      st = null; if (busy || e.touches.length !== 1 || root().scrollTop > 0 || blocked(e.target)) return;
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, pulling: false, dy: 0, rec: recording() };   // 녹음 중이면 당겨도 새로고침하지 않는다
    }, { passive: true });
    document.addEventListener("touchmove", function (e) {
      if (!st || busy) return;
      if (typeof dnd !== "undefined" && dnd.item) { st = null; hide(); return; }   // 프로젝트 화면의 길게 눌러 끌기와 겹치지 않게
      var dy = e.touches[0].clientY - st.y, dx = e.touches[0].clientX - st.x;
      if (!st.pulling) {
        if (dy > 12 && dy > Math.abs(dx) * 1.5) st.pulling = true;
        else if (dy < -6 || Math.abs(dx) > 20) { st = null; return; }
        else return;
      }
      if (root().scrollTop > 0) { st = null; hide(); return; }
      st.dy = dy; show(dy, dy >= TH, st.rec ? "녹음 중에는 새로고침하지 않습니다" : "");
    }, { passive: true });
    document.addEventListener("touchend", async function () {
      if (!st) return; var s = st; st = null;
      if (!s.pulling) return;
      if (s.rec) { hide(); return; }
      if (s.dy >= TH) { busy = true; show(TH, false); try { await pullRefresh(); } finally { busy = false; hide(); } }
      else hide();
    });
    document.addEventListener("touchcancel", function () { st = null; hide(); });
  })();

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
      refreshIdleHint();
      loadTasks(); loadMeetings(); loadVocab();
      nativeResume();
      checkUpdate(false);
      checkQuotaWarn(Settings.get("driveQuota"));
      document.getElementById("updCheck").hidden = !(window.Updater && Updater.available());
      DB.onChange(function () { Sync.schedule(); WidgetSync.push(); if (window.GCal) GCal.schedule(); });
      if (window.GCal) GCal.run().catch(function () {});
      WidgetSync.push(true);
      Sync.run().catch(function () {});
      document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") { Sync.run().catch(function () {}); checkUpdate(false); if (window.GCal) GCal.maybeRun(); }
        else { Sync.flush().catch(function () {}); if (window.GCal) GCal.flush().catch(function () {}); }   // 다른 화면으로 넘어가는 순간 밀린 변경을 바로 올린다
      });
      window.addEventListener("pagehide", function () { Sync.flush().catch(function () {}); });
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
  // 받아쓰기 간격 표시("10분"). 시험용으로 1분 미만 값이면 초로 보여 준다
  function segLabel() {
    var m = Number(Settings.get("segmentMin")) || 10;
    return m >= 1 ? (m % 1 === 0 ? m : m.toFixed(1)) + "분" : Math.max(1, Math.round(m * 60)) + "초";
  }
  function refreshIdleHint() {
    var recording = (typeof rec !== "undefined" && (rec.active || rec.interrupted || rec.pending)) || NR.active || NR.busy || NR.left || NR.failed;
    if (!recording && !document.getElementById("recStatus").querySelector(".thinking") && /받아쓰기합니다|녹음 버튼/.test(document.getElementById("recStatus").textContent)) setRecStatus(idleHint());
  }
  function nativeStatus() {
    if (NR.failed) { setRecStatus('<b>' + NR.failed + '개 구간을 변환하지 못했습니다.</b> 녹음은 보관돼 있으니 <a href="#" id="retryNative">다시 변환</a>을 눌러 보세요.'); return; }
    if (NR.active) { setRecStatus('녹음 중... ' + segLabel() + '마다 글로 변환되어 메모에 추가됩니다. 화면을 꺼도 계속됩니다.' + (NR.left ? ' · 변환 대기 ' + NR.left + '건' : '')); return; }
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
