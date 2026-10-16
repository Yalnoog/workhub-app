/* 마감일 알림. 안드로이드 앱(Capacitor)에서는 기기 알람(정확한 시각)으로 예약하고, 브라우저에서는 아무것도 하지 않는다.
 * 규칙: 시간이 있는 할일 = 마감 시각 notifyLeadMin분 전, 시간이 없는 할일 = 마감일 notifyHour시.
 * sync()는 "전부 취소 후 현재 목록 기준으로 다시 예약"이라 몇 번을 불러도 안전하다(멱등). */
(function () {
  "use strict";
  var MAX = 60;   // 가까운 순으로 이만큼만 예약(안드로이드 알람 개수 제한 대비)

  function LN() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications; }
  function isNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && LN()); }

  function numId(s) { var h = 7; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (Math.abs(h) % 2000000000) + 1; }

  // 마감 시각 -> 알림 시각(Date) 또는 null.
  // fired: 이미 "곧바로 알림"으로 예약한 건의 기록 {키: 알림 시각(ms)}. 같은 건을 앱을 열 때마다 다시 울리지 않고, 예약된 시각은 유지한다.
  // fresh: 이번에 새로 기록할 항목을 담는 객체
  function fireAt(t, now, fired, fresh) {
    if (!t.due || t.status === "done") return null;
    var p = t.due.split("-"); if (p.length !== 3) return null;
    var lead = Number(window.Settings.get("notifyLeadMin")), hour = Number(window.Settings.get("notifyHour"));
    if (isNaN(lead)) lead = 30; if (isNaN(hour)) hour = 9;
    var at;
    if (t.dueTime && /^\d{2}:\d{2}$/.test(t.dueTime)) {
      var hm = t.dueTime.split(":");
      at = new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1] - lead, 0);
      if (at <= now) {
        // 알림 시각은 지났지만 마감 시각은 아직 안 지났으면 곧바로(1분 뒤) 한 번만 알려 준다
        var due = new Date(+p[0], +p[1] - 1, +p[2], +hm[0], +hm[1], 0);
        if (due <= now || t.notified) return null;
        var key = t.id + "|" + t.due + "|" + t.dueTime + "|" + lead;
        if (fired && fired[key] != null) return fired[key] > now.getTime() ? new Date(fired[key]) : null;
        at = new Date(now.getTime() + 60000);
        if (fresh) fresh[key] = at.getTime();
      }
    } else {
      at = new Date(+p[0], +p[1] - 1, +p[2], hour, 0, 0);
      if (at <= now) at = null;
    }
    return at;
  }

  function bodyOf(t) {
    var parts = [];
    if (t.dueTime) parts.push("마감 " + t.dueTime); else parts.push("오늘 마감");
    if (t.location) parts.push(t.location);
    return parts.join(" · ");
  }

  function plan(tasks, now, fired, fresh) {
    var out = [];
    tasks.forEach(function (t) { var at = fireAt(t, now, fired, fresh); if (at) out.push({ task: t, at: at }); });
    out.sort(function (a, b) { return a.at - b.at; });
    return out.slice(0, MAX);
  }

  var chain = Promise.resolve();   // 동시에 여러 번 불려도 한 줄로 처리
  function sync() {
    chain = chain.then(doSync).catch(function () {});
    return chain;
  }
  async function doSync() {
    if (!isNative()) return;
    var ln = LN();
    var pend = await ln.getPending();
    if (pend.notifications && pend.notifications.length) await ln.cancel({ notifications: pend.notifications.map(function (n) { return { id: n.id }; }) });
    var perm = await ln.checkPermissions();
    if (perm.display !== "granted") return;
    var now = new Date(), fired = window.Settings.get("notifFired") || {}, fresh = {};
    Object.keys(fired).forEach(function (k) { if (fired[k] < now.getTime() - 7 * 86400000) delete fired[k]; });   // 일주일 지난 기록은 정리
    var items = plan(window.DB.all("tasks"), now, fired, fresh);
    if (Object.keys(fresh).length || Object.keys(fired).length !== (window.Settings.get("notifFired") ? Object.keys(window.Settings.get("notifFired")).length : 0)) await window.Settings.set("notifFired", Object.assign(fired, fresh));
    if (!items.length) return;
    await ln.schedule({ notifications: items.map(function (it) {
      return { id: numId(it.task.id), title: it.task.title, body: bodyOf(it.task), schedule: { at: it.at, allowWhileIdle: true }, channelId: "due", extra: { taskId: it.task.id } };
    }) });
  }

  async function init() {
    if (!isNative()) return;
    var ln = LN();
    try { await ln.createChannel({ id: "due", name: "마감일 알림", description: "할일 마감 알림", importance: 4, visibility: 1, vibration: true }); } catch (e) {}
    var perm = await ln.checkPermissions();
    if (perm.display === "prompt" || perm.display === "prompt-with-rationale") { try { await ln.requestPermissions(); } catch (e) {} }
  }

  async function status() {
    if (!isNative()) return { permission: "denied", exact: false, pending: 0 };
    var ln = LN(), r = { permission: "denied", exact: true, pending: 0 };
    try { r.permission = (await ln.checkPermissions()).display; } catch (e) {}
    try { r.exact = (await ln.checkExactNotificationSetting()).exact_alarm !== "denied"; } catch (e) {}
    try { r.pending = ((await ln.getPending()).notifications || []).length; } catch (e) {}
    return r;
  }

  async function requestAll() {
    if (!isNative()) return;
    var ln = LN();
    await ln.requestPermissions();
    try { var ex = await ln.checkExactNotificationSetting(); if (ex.exact_alarm === "denied") await ln.changeExactNotificationSetting(); } catch (e) {}
  }

  async function test() {
    if (!isNative()) return;
    var ln = LN();
    await ln.schedule({ notifications: [{ id: 1999999999, title: "테스트 알림", body: "이 알림이 보이면 마감일 알림이 정상 동작합니다.", schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true }, channelId: "due" }] });
  }

  // 즉시 알림 하나(저장공간 경고 등). 같은 id는 덮어쓴다.
  async function alertNow(id, title, body) {
    if (!isNative()) return;
    var ln = LN();
    var perm = await ln.checkPermissions(); if (perm.display !== "granted") return;
    await ln.schedule({ notifications: [{ id: id, title: title, body: body, schedule: { at: new Date(Date.now() + 2000), allowWhileIdle: true }, channelId: "due" }] });
  }

  window.Notify = { alertNow: alertNow, isNative: isNative, init: init, sync: sync, status: status, requestAll: requestAll, test: test, _plan: plan, _fireAt: fireAt };
})();
