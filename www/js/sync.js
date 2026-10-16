/* 구글 드라이브 동기화(기기 간). 내 구글 계정의 "앱 전용 숨김 폴더(appDataFolder)"에 파일 하나(workhub-sync.json)를 두고,
 * 기기마다 [받기 → 병합 → 반영 → 올리기]를 한다. 서버는 없다.
 * 병합 규칙: 같은 항목(id)은 수정 시각(_u)이 최신인 쪽, 삭제 기록(tombstone)이 항목의 수정 시각보다 새로우면 삭제.
 * API 키·화면 설정·녹음 조각은 동기화하지 않는다(기기별). */
(function () {
  "use strict";
  var STORES = ["tasks", "meetings", "projects", "vocab"];
  var FILE = "workhub-sync.json";
  var API = "https://www.googleapis.com/drive/v3", UP = "https://www.googleapis.com/upload/drive/v3";

  function norm(s) { return String(s || "").replace(/\s+/g, "").toLowerCase(); }

  // ---------- 순수 병합 (테스트 대상) ----------
  // local/remote: {stores:{tasks:[],...}, tombs:[{id,store,rid,t}]}. stamp: 새로 찍을 수정 시각(중복 프로젝트 정리용)
  function merge(local, remote, stamp) {
    var out = { v: 1, stores: {}, tombs: [], settings: {} }, tmap = {};
    // 설정: 키마다 수정 시각이 최신인 쪽. (value가 null이면 '삭제됨' 표시 - API 키 동기화를 끌 때 드라이브의 키를 지우는 데 쓴다)
    [local, remote].forEach(function (s) {
      var ss = (s && s.settings) || {};
      Object.keys(ss).forEach(function (k) { var c = out.settings[k]; if (!c || (ss[k]._u || 0) > (c._u || 0)) out.settings[k] = ss[k]; });
    });
    [local, remote].forEach(function (s) { ((s && s.tombs) || []).forEach(function (t) { if (!tmap[t.id] || tmap[t.id].t < t.t) tmap[t.id] = t; }); });
    STORES.forEach(function (st) {
      var m = {};
      [local, remote].forEach(function (s, idx) {
        (((s && s.stores) || {})[st] || []).forEach(function (r) {
          var cur = m[r.id];
          if (!cur || (r._u || 0) > (cur._u || 0)) m[r.id] = r;   // 동률이면 먼저 들어온 쪽(로컬)
        });
      });
      Object.keys(m).forEach(function (id) {
        var tb = tmap[st + ":" + id];
        if (tb && tb.t > (m[id]._u || 0)) delete m[id];
      });
      out.stores[st] = Object.keys(m).map(function (id) { return m[id]; });
    });
    // 두 기기에서 같은 이름의 프로젝트를 따로 만든 경우: id가 작은 쪽만 남기고, 회의록의 연결을 옮긴다
    var byName = {}, remap = {};
    out.stores.projects.sort(function (a, b) { return a.id < b.id ? -1 : 1; }).forEach(function (p) {
      var k = norm(p.name);
      if (!k) return;
      if (byName[k]) { remap[p.id] = byName[k]; tmap["projects:" + p.id] = { id: "projects:" + p.id, store: "projects", rid: p.id, t: stamp }; }
      else byName[k] = p.id;
    });
    if (Object.keys(remap).length) {
      out.stores.projects = out.stores.projects.filter(function (p) { return !remap[p.id]; });
      out.stores.meetings = out.stores.meetings.map(function (m) { return remap[m.projectId] ? Object.assign({}, m, { projectId: remap[m.projectId], _u: stamp }) : m; });
    }
    out.tombs = Object.keys(tmap).map(function (k) { return tmap[k]; });
    return out;
  }

  function canon(snap) {   // 같은 내용인지 비교하기 위한 정렬된 문자열
    var o = { s: {}, set: Object.keys(snap.settings || {}).sort().map(function (k) { return k + "@" + (snap.settings[k]._u || 0) + ":" + (snap.settings[k].value == null ? "x" : "v"); }), t: (snap.tombs || []).map(function (x) { return x.id + "@" + x.t; }).sort() };
    STORES.forEach(function (st) { o.s[st] = ((snap.stores || {})[st] || []).map(function (r) { return r.id + "@" + (r._u || 0); }).sort(); });
    return JSON.stringify(o);
  }

  function localSnapshot() {
    var s = { v: 1, stores: {}, tombs: window.DB.all("tombstones").slice(), settings: {} };
    var S = window.Settings;
    S.SYNC_KEYS.forEach(function (k) { var r = S.raw(k); if (r && r._u) s.settings[k] = { value: r.value, _u: r._u }; });
    var ak = S.raw("apiKey");
    if (S.get("syncKey")) { if (ak && ak.value) s.settings.apiKey = { value: ak.value, _u: ak._u || 0 }; }
    else if (S.get("keyWipe")) s.settings.apiKey = { value: null, _u: window.DB.stamp() };   // 스위치를 끈 뒤 한 번, 드라이브에 올라간 키를 지운다
    STORES.forEach(function (st) { s.stores[st] = window.DB.all(st).slice(); });
    return s;
  }

  // 병합 결과를 로컬에 반영(동기화로 받은 변경이라 silent)
  async function applyLocal(merged, snapAt) {
    // 받는 사이에 이 기기에서 새로 고친 항목(수정 시각이 스냅샷 이후)은 건드리지 않는다. 다음 동기화에 올라간다.
    var ops = [], fresh = function (r) { return r && (r._u || 0) > snapAt; };
    STORES.forEach(function (st) {
      var want = {}; merged.stores[st].forEach(function (r) { want[r.id] = r; });
      window.DB.all(st).forEach(function (r) { if (!want[r.id] && !fresh(r)) ops.push({ store: st, del: r.id }); });
      merged.stores[st].forEach(function (r) {
        var cur = window.DB.get(st, r.id);
        if (!cur || ((cur._u || 0) !== (r._u || 0) && !fresh(cur))) ops.push({ store: st, put: r });
      });
    });
    var have = {}; window.DB.all("tombstones").forEach(function (t) { have[t.id] = t.t; });
    merged.tombs.forEach(function (t) { if (have[t.id] !== t.t) ops.push({ store: "tombstones", put: t }); });
    // 설정 반영: 로컬보다 새로운 값만. apiKey는 스위치가 켜져 있고 값이 있을 때만(원격이 삭제 표시여도 이 기기의 키는 지우지 않는다)
    var S = window.Settings, nset = 0;
    Object.keys(merged.settings || {}).forEach(function (k) {
      var rm = merged.settings[k], cur = S.raw(k);
      if (!(S.SYNC_KEYS.indexOf(k) >= 0 || k === "apiKey")) return;
      if (k === "apiKey" && (!S.get("syncKey") || rm.value == null)) return;
      if (rm.value == null) return;
      if (cur && (cur._u || 0) >= (rm._u || 0)) return;
      ops.push({ store: "settings", put: { key: k, value: rm.value, _u: rm._u } }); nset++;
    });
    await window.DB.batch(ops, { silent: true });
    return ops.length;
  }

  // ---------- 백업 합치기 ----------
  // 이 기기의 데이터는 그대로 두고 백업에만 있는 항목을 더한다(같은 id는 건너뜀). 같은 이름의 프로젝트는 하나로 합치고 회의록 연결을 옮긴다.
  // 새로 들어온 항목은 일반 저장으로 수정 시각이 찍혀 구글 드라이브 동기화에 실린다.
  async function mergeBackup(obj) {
    if (!obj || obj.app !== "workhub-standalone" || !obj.data) throw new Error("올바른 백업 파일이 아닙니다.");
    var D = window.DB, d = obj.data, ops = [], add = { tasks: 0, meetings: 0, projects: 0, vocab: 0 }, pmap = {};
    var byName = {}; D.all("projects").forEach(function (p) { byName[norm(p.name)] = p.id; });
    (d.projects || []).forEach(function (p) {
      var k = norm(p.name);
      if (D.get("projects", p.id)) { pmap[p.id] = p.id; return; }
      if (byName[k]) { pmap[p.id] = byName[k]; return; }
      ops.push({ store: "projects", put: p }); byName[k] = p.id; pmap[p.id] = p.id; add.projects++;
    });
    (d.tasks || []).forEach(function (t) { if (!D.get("tasks", t.id)) { ops.push({ store: "tasks", put: t }); add.tasks++; } });
    (d.meetings || []).forEach(function (m) {
      if (D.get("meetings", m.id)) return;
      var mm = Object.assign({}, m); if (mm.projectId) mm.projectId = pmap[mm.projectId] || null;
      ops.push({ store: "meetings", put: mm }); add.meetings++;
    });
    var haveV = {}; D.all("vocab").forEach(function (v) { haveV[v.wrong + "→" + v.right] = 1; });
    (d.vocab || []).forEach(function (v) {
      var k = v.wrong + "→" + v.right;
      if (D.get("vocab", v.id) || haveV[k]) return;
      ops.push({ store: "vocab", put: v }); haveV[k] = 1; add.vocab++;
    });
    await D.batch(ops);
    return add;
  }

  // ---------- 구글 로그인(네이티브) + 드라이브 REST ----------
  function plugin() { var C = window.Capacitor; return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.WorkhubGoogle) || null; }
  function available() { return !!plugin(); }
  function SyncError(code, msg) { var e = new Error(msg); e.code = code; return e; }

  async function token(interactive) {
    var P = plugin(); if (!P) throw SyncError("NO_NATIVE", "구글 드라이브 동기화는 안드로이드 앱에서만 쓸 수 있습니다.");
    try { return (await P.getToken({ interactive: !!interactive })).accessToken; }
    catch (e) {
      var c = (e && e.code) || "";
      if (c === "NEED_CONSENT") throw SyncError("NEED_CONSENT", "구글 계정 연결이 필요합니다. 설정에서 다시 연결해 주세요.");
      if (c === "CANCELED") throw SyncError("CANCELED", "연결을 취소했습니다.");
      throw SyncError(c || "AUTH", (e && e.message) || "구글 로그인에 실패했습니다.");
    }
  }

  async function drive(url, init, tok) {
    var res = await fetch(url, Object.assign({}, init, { headers: Object.assign({ Authorization: "Bearer " + tok }, (init && init.headers) || {}) }));
    if (res.status === 401 || res.status === 403) {
      var body = ""; try { body = await res.text(); } catch (e) {}
      if (/insufficient|scope|accessNotConfigured|has not been used|disabled/i.test(body)) throw SyncError("DRIVE_API", "구글 드라이브 API 설정이 완료되지 않았습니다. (" + res.status + ")");
      throw SyncError("AUTH", "구글 인증이 만료되었습니다. 설정에서 다시 연결해 주세요.");
    }
    if (!res.ok) throw SyncError("HTTP", "구글 드라이브 응답 오류 (" + res.status + ")");
    return res;
  }

  async function findFile(tok) {
    var q = encodeURIComponent("name='" + FILE + "'");
    var r = await drive(API + "/files?spaces=appDataFolder&q=" + q + "&fields=files(id,modifiedTime)&pageSize=10", {}, tok);
    var j = await r.json();
    return (j.files && j.files[0]) || null;
  }
  async function download(id, tok) { return (await drive(API + "/files/" + id + "?alt=media", {}, tok)).json(); }
  // 드라이브 저장공간: 계정 전체(about) + 이 앱이 쓰는 용량(앱 전용 폴더의 파일 크기 합).
  // 전체 사용량을 읽는 권한이 현재 권한(drive.appdata)으로 안 되면 totalErr에 사유를 남기고 앱 사용량만 돌려준다.
  async function usage(tok) {
    var q = { t: Date.now(), limit: 0, usage: 0, app: 0, totalErr: "" };
    var r = await drive(API + "/files?spaces=appDataFolder&fields=files(size)&pageSize=100", {}, tok);
    ((await r.json()).files || []).forEach(function (f) { q.app += Number(f.size) || 0; });
    try {
      var a = await (await drive(API + "/about?fields=storageQuota(limit,usage)", {}, tok)).json(), sq = a.storageQuota || {};
      q.limit = Number(sq.limit) || 0; q.usage = Number(sq.usage) || 0;
      if (!q.usage) q.totalErr = "계정 전체 사용량 정보가 비어 있습니다.";
    } catch (e) {
      var why = (e && e.code === "DRIVE_API" || e && e.code === "AUTH") ? "현재 권한으로는 읽을 수 없습니다" : ((e && e.message) || "읽지 못했습니다");
      q.totalErr = why + (e && e.message && why !== e.message ? " - " + e.message : "");
    }
    return q;
  }

  async function upload(id, snap, tok) {
    var body = JSON.stringify(snap);
    if (id) { await drive(UP + "/files/" + id + "?uploadType=media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: body }, tok); return id; }
    var boundary = "wh" + Date.now(), meta = JSON.stringify({ name: FILE, parents: ["appDataFolder"] });
    var multi = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";
    var r = await drive(UP + "/files?uploadType=multipart", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: multi }, tok);
    return (await r.json()).id;
  }

  // ---------- 실행 ----------
  var chain = Promise.resolve(), applied = null, timer = null, dirty = false, state = { running: false };
  function enabled() { return !!window.Settings.get("driveOn"); }

  async function runOnce(interactive) {
    var tok = await token(interactive);
    var f = await findFile(tok), remote = f ? await download(f.id, tok) : null;
    var snapAt = Date.now() + 1, local = localSnapshot();
    var merged = merge(local, remote, snapAt);
    var changed = await applyLocal(merged, snapAt);
    if (!remote || canon(remote) !== canon(merged)) await upload(f && f.id, merged, tok);
    if (window.Settings.get("keyWipe") && !window.Settings.get("syncKey")) await window.Settings.remove("keyWipe");
    await window.Settings.set("driveLast", Date.now());
    await window.Settings.remove("driveErr");
    await refreshUsage(false, tok).catch(function () {});
    if (changed && applied) applied();
    return changed;
  }

  var QUOTA_GAP = 30 * 60 * 1000, usageCb = null;
  async function refreshUsage(force, tok) {
    var cur = window.Settings.get("driveQuota");
    if (!force && cur && Date.now() - cur.t < QUOTA_GAP) return cur;
    var q = await usage(tok || await token(false));
    await window.Settings.set("driveQuota", q);
    if (usageCb) usageCb(q);
    return q;
  }

  // 동시에 여러 번 불려도 한 줄로 처리
  function run(opts) {
    var interactive = !!(opts && opts.interactive);
    var p = chain.then(function () {
      if (!interactive && !enabled()) return 0;
      state.running = true; dirty = false; if (state.onState) state.onState();
      return runOnce(interactive);
    });
    chain = p.catch(function () {});
    return p.catch(async function (e) {
      await window.Settings.set("driveErr", { code: e.code || "ERR", msg: e.message || String(e), t: Date.now() });
      throw e;
    }).finally(function () { state.running = false; if (state.onState) state.onState(); });
  }

  function schedule(ms) {   // 로컬 변경 후 잠시 모아서 한 번에 올린다
    if (!enabled()) return;
    dirty = true;
    clearTimeout(timer);
    timer = setTimeout(function () { run().catch(function () {}); }, ms == null ? 8000 : ms);
  }

  // 앱이 화면에서 사라지는 순간: 아직 못 올린 변경이 있으면 기다리지 않고 바로 올린다
  function flush() {
    if (!enabled() || !dirty) return Promise.resolve(0);
    clearTimeout(timer);
    return run();
  }

  async function connect() { await run({ interactive: true }); await window.Settings.set("driveOn", true); schedule(0); }
  async function disconnect() { clearTimeout(timer); await window.Settings.set("driveOn", false); await window.Settings.remove("driveErr"); }

  window.Sync = {
    available: available, enabled: enabled, run: run, schedule: schedule, flush: flush, connect: connect, disconnect: disconnect, state: state,
    merge: merge, mergeBackup: mergeBackup, canon: canon, localSnapshot: localSnapshot, FILE: FILE,
    onApplied: function (fn) { applied = fn; },
    onUsage: function (fn) { usageCb = fn; }, refreshUsage: refreshUsage,
  };
})();
