/* 구글 캘린더 내보내기(안드로이드 앱 전용). 기한이 있는 미완료 할일을 앱이 만든 보조 캘린더("업무 워크벤치")의 일정으로 맞춰 둔다.
 * 그 캘린더의 "iCal 형식 비공개 주소"를 회사 캘린더에 등록하면 회사 캘린더에도 보인다(주소는 사용자가 구글 캘린더 설정에서 한 번 복사).
 * 권한은 앱이 만든 캘린더만 다루는 calendar.app.created 하나뿐이다(기본 캘린더·다른 캘린더는 읽지도 쓰지도 못한다).
 * 방식: 기기에 상태를 두지 않고 [캘린더의 현재 일정 목록 ↔ 지금 할일]을 비교해 다른 것만 만들고·고치고·지운다 → 폰·태블릿이 함께 써도 중복되지 않는다.
 * 일정 ID는 할일 ID와 같다(구글이 허용하는 글자: 소문자 a-v, 숫자). */
(function () {
  "use strict";
  var BASE = "https://www.googleapis.com/calendar/v3";
  var SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
  var NAME = "업무 워크벤치";
  var cfg = { sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); }, durationMin: 30 };

  function S() { return window.Settings; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function GErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function enabled() { return !!S().get("calOn"); }
  function available() { return !!(window.Sync && window.Sync.isNative && window.Sync.isNative()); }

  // ---------- 순수 변환 (테스트 대상) ----------
  function eventId(taskId) {   // 구글 일정 ID 규칙: 5~1024자, 소문자 a-v와 숫자
    var id = String(taskId || "").toLowerCase().replace(/[^a-v0-9]/g, "");
    return id.length >= 5 ? id : ("00000" + id).slice(-8);
  }
  function addMinutes(due, hm, min) {   // 벽시계 시각에 분을 더한다(시간대 변환 없이)
    var p = due.split("-"), t = hm.split(":");
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], +t[0], +t[1] + min));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()) + "T" + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":00";
  }
  function nextDay(due) {
    var p = due.split("-"), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + 1));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }
  function sigOf(o) { var s = JSON.stringify(o), h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + "." + s.length; }

  // 할일 -> 구글 일정 본문. mask면 제목·장소·프로젝트를 빼고 시간만 보낸다.
  function toEvent(t, tz, mask, durMin) {
    var timed = /^\d{2}:\d{2}$/.test(t.dueTime || "");
    var ev = { id: eventId(t.id), status: "confirmed", summary: mask ? "일정" : (t.title || "(제목 없음)"), reminders: { useDefault: false } };
    if (!mask && t.location) ev.location = t.location;
    var desc = [];
    if (!mask && t.category) desc.push("프로젝트: " + t.category);
    desc.push("업무 워크벤치에서 내보낸 일정");
    ev.description = desc.join("\n");
    if (timed) {
      ev.start = { dateTime: t.due + "T" + t.dueTime + ":00", timeZone: tz };
      ev.end = { dateTime: addMinutes(t.due, t.dueTime, durMin || 30), timeZone: tz };
      ev.transparency = "opaque";
    } else {
      ev.start = { date: t.due }; ev.end = { date: nextDay(t.due) };
      ev.transparency = "transparent";   // 종일 할일이 회의 가능 시간을 막지 않게
    }
    var sig = sigOf([ev.summary, ev.location || "", ev.description, ev.start, ev.end, ev.transparency]);
    ev.extendedProperties = { private: { wh: "1", sig: sig } };
    return ev;
  }
  function desiredEvents(tasks, tz, mask, durMin) {
    var out = {};
    tasks.forEach(function (t) {
      if (!t.due || !/^\d{4}-\d{2}-\d{2}$/.test(t.due) || t.status === "done") return;
      var ev = toEvent(t, tz, mask, durMin); out[ev.id] = ev;
    });
    return out;
  }

  // ---------- 구글 캘린더 API ----------
  async function call(method, path, tok, body) {
    for (var i = 0; i < 3; i++) {
      var res;
      try {
        res = await fetch(BASE + path, { method: method, headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      } catch (e) { throw GErr("NETWORK", "인터넷 연결을 확인해 주세요."); }
      var json = null; try { json = await res.json(); } catch (e) { /* 204 등 본문 없음 */ }
      var reason = json && json.error && json.error.errors && json.error.errors[0] && json.error.errors[0].reason;
      if (res.status === 429 || res.status >= 500 || (res.status === 403 && /rateLimit/i.test(reason || ""))) { await cfg.sleep(700 * (i + 1)); continue; }
      return { status: res.status, json: json, reason: reason || "", message: (json && json.error && json.error.message) || "" };
    }
    throw GErr("BUSY", "구글 캘린더가 잠시 바쁩니다. 나중에 다시 시도합니다.");
  }
  function fail(r, what) {
    if (r.status === 401) return GErr("AUTH", "구글 인증이 만료되었습니다. 설정에서 다시 켜 주세요.");
    if (r.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(r.reason + " " + r.message + " " + JSON.stringify(r.json || {}))) return GErr("API_OFF", "구글 클라우드에서 Google Calendar API를 사용 설정해야 합니다.");
    if (r.status === 403) return GErr("SCOPE", "캘린더 권한이 없습니다. 설정에서 다시 켜 주세요. (" + (r.reason || r.status) + ")");
    return GErr("HTTP", what + " 실패 (HTTP " + r.status + (r.message ? ": " + r.message.slice(0, 80) : "") + ")");
  }
  async function listEvents(calId, tok) {
    var out = {}, token = "";
    for (var page = 0; page < 20; page++) {
      var r = await call("GET", "/calendars/" + encodeURIComponent(calId) + "/events?maxResults=2500&showDeleted=false&singleEvents=false" + (token ? "&pageToken=" + encodeURIComponent(token) : ""), tok);
      if (r.status !== 200) throw r.status === 404 ? GErr("GONE", "캘린더를 찾을 수 없습니다.") : fail(r, "일정 목록 조회");
      ((r.json && r.json.items) || []).forEach(function (e) {
        var p = e.extendedProperties && e.extendedProperties.private;
        if (e.status !== "cancelled" && p && p.wh === "1") out[e.id] = p.sig || "";
      });
      token = r.json && r.json.nextPageToken; if (!token) break;
    }
    return out;
  }
  async function upsert(calId, ev, tok) {
    var base = "/calendars/" + encodeURIComponent(calId) + "/events";
    var r = await call("PUT", base + "/" + ev.id, tok, ev);   // 이미 있거나 지워진 일정이면 갱신(복원)
    if (r.status === 200) return;
    if (r.status === 404 || r.status === 410) {
      r = await call("POST", base, tok, ev);
      if (r.status === 200) return;
      if (r.status === 409) { r = await call("PUT", base + "/" + ev.id, tok, ev); if (r.status === 200) return; }   // 지워진 ID와 겹치면 복원
    }
    throw fail(r, "일정 저장");
  }
  async function remove(calId, id, tok) {
    var r = await call("DELETE", "/calendars/" + encodeURIComponent(calId) + "/events/" + id, tok);
    if (r.status === 204 || r.status === 200 || r.status === 404 || r.status === 410) return;
    throw fail(r, "일정 삭제");
  }

  // ---------- 실행 ----------
  var chain = Promise.resolve(), timer = null, dirty = false, lastRun = 0, state = { running: false };

  async function ensureCalendar(tok, create) {
    var calId = S().get("calId");
    if (calId) {
      var g = await call("GET", "/calendars/" + encodeURIComponent(calId), tok);
      if (g.status === 200) { await S().set("calTz", (g.json && g.json.timeZone) || S().get("calTz") || "Asia/Seoul"); return calId; }
      if (g.status !== 404 && g.status !== 410) throw fail(g, "캘린더 확인");
    }
    if (!create) throw GErr("GONE", "구글 캘린더의 '" + NAME + "' 캘린더를 찾을 수 없습니다(다른 기기에서 삭제했을 수 있습니다). 설정에서 다시 켜 주세요.");
    var tz = (window.Intl && Intl.DateTimeFormat().resolvedOptions().timeZone) || "Asia/Seoul";
    var c = await call("POST", "/calendars", tok, { summary: NAME, description: "업무 워크벤치가 내보낸 할일 일정입니다. 이 캘린더의 일정은 앱이 자동으로 관리합니다.", timeZone: tz });
    if (c.status !== 200 || !c.json || !c.json.id) throw fail(c, "캘린더 만들기");
    await S().set("calId", c.json.id); await S().set("calTz", c.json.timeZone || tz);
    return c.json.id;
  }

  async function runOnce(opts) {
    // 다른 기기에서 만든 할일을 아직 못 받은 상태로 맞추면 그 일정들을 "할일이 없다"고 보고 지워 버린다.
    // 그래서 드라이브 동기화를 쓰는 중이면 먼저 최신으로 받고, 확인하지 못하면 지우지 않고 미룬다.
    if (window.Sync && window.Sync.enabled()) {
      try { await window.Sync.run(); }
      catch (e) { throw GErr("SYNC", "구글 드라이브 동기화를 확인하지 못해 캘린더 갱신을 미뤘습니다. (" + ((e && e.message) || "") + ")"); }
    }
    var tok = await window.Sync.getToken(!!opts.interactive, SCOPE).catch(function (e) {
      if (e && e.code === "NEED_CONSENT") throw GErr("NEED_CONSENT", "구글 캘린더 연결이 필요합니다. 설정에서 다시 켜 주세요.");
      throw e;
    });
    var calId = await ensureCalendar(tok, !!opts.create);
    var tz = S().get("calTz") || "Asia/Seoul", mask = !!S().get("calMask");
    var want = desiredEvents(window.DB.all("tasks"), tz, mask, Number(S().get("calDuration")) || cfg.durationMin);
    var have = await listEvents(calId, tok), made = 0, removed = 0;
    var ids = Object.keys(have);
    for (var i = 0; i < ids.length; i++) if (!want[ids[i]]) { await remove(calId, ids[i], tok); removed++; }
    var wk = Object.keys(want);
    for (var j = 0; j < wk.length; j++) {
      var ev = want[wk[j]];
      if (have[ev.id] === ev.extendedProperties.private.sig) continue;   // 달라진 것만
      await upsert(calId, ev, tok); made++;
    }
    await S().set("calLast", Date.now()); await S().remove("calErr");
    lastRun = Date.now();
    return { made: made, removed: removed, total: wk.length };
  }

  function run(opts) {
    opts = opts || {};
    var p = chain.then(function () {
      if (!available() || (!opts.force && !enabled())) return null;
      state.running = true; dirty = false; if (state.onState) state.onState();
      return runOnce(opts);
    });
    chain = p.catch(function () {});
    return p.catch(async function (e) {
      var fatal = e && (e.code === "GONE" || e.code === "AUTH" || e.code === "NEED_CONSENT" || e.code === "SCOPE");
      if (e && e.code === "GONE") await S().set("calOn", false);   // 캘린더가 사라졌으면 멋대로 다시 만들지 않고 끈다
      await S().set("calErr", { code: e.code || "ERR", msg: e.message || String(e), t: Date.now(), fatal: !!fatal });
      throw e;
    }).finally(function () { state.running = false; if (state.onState) state.onState(); });
  }
  function schedule(ms) { if (!available() || !enabled()) return; dirty = true; clearTimeout(timer); timer = setTimeout(function () { run().catch(function () {}); }, ms == null ? 10000 : ms); }
  function flush() { if (!available() || !enabled() || !dirty) return Promise.resolve(null); clearTimeout(timer); return run(); }
  // 앱을 열거나 돌아올 때: 오래 안 맞췄으면 한 번 맞춘다
  function maybeRun() { if (available() && enabled() && Date.now() - lastRun > 60000) return run().catch(function () {}); return Promise.resolve(null); }

  async function enable() {
    var r = await run({ interactive: true, create: true, force: true });
    await S().set("calOn", true);
    return r;
  }
  // deleteCalendar=true면 구글 캘린더의 '업무 워크벤치' 캘린더와 일정을 모두 지운다
  async function disable(deleteCalendar) {
    clearTimeout(timer);
    var calId = S().get("calId");
    if (deleteCalendar && calId) {
      var tok = await window.Sync.getToken(false, SCOPE);
      var r = await call("DELETE", "/calendars/" + encodeURIComponent(calId), tok);
      if (!(r.status === 204 || r.status === 200 || r.status === 404 || r.status === 410)) throw fail(r, "캘린더 삭제");
      await S().set("calId", "");   // 빈 값으로 두어야 다른 기기에도 '지워짐'이 전달된다
    }
    await S().set("calOn", false); await S().remove("calErr");
  }

  window.GCal = { available: available, enabled: enabled, run: run, schedule: schedule, flush: flush, maybeRun: maybeRun, enable: enable, disable: disable, state: state,
    cfg: cfg, SCOPE: SCOPE, NAME: NAME, toEvent: toEvent, desiredEvents: desiredEvents, eventId: eventId, addMinutes: addMinutes };
})();
