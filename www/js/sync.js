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
    var out = { v: 1, stores: {}, tombs: [] }, tmap = {};
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
    var o = { s: {}, t: (snap.tombs || []).map(function (x) { return x.id + "@" + x.t; }).sort() };
    STORES.forEach(function (st) { o.s[st] = ((snap.stores || {})[st] || []).map(function (r) { return r.id + "@" + (r._u || 0); }).sort(); });
    return JSON.stringify(o);
  }

  function localSnapshot() {
    var s = { v: 1, stores: {}, tombs: window.DB.all("tombstones").slice() };
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
    await window.DB.batch(ops, { silent: true });
    return ops.length;
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
  async function upload(id, snap, tok) {
    var body = JSON.stringify(snap);
    if (id) { await drive(UP + "/files/" + id + "?uploadType=media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: body }, tok); return id; }
    var boundary = "wh" + Date.now(), meta = JSON.stringify({ name: FILE, parents: ["appDataFolder"] });
    var multi = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";
    var r = await drive(UP + "/files?uploadType=multipart", { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: multi }, tok);
    return (await r.json()).id;
  }

  // ---------- 실행 ----------
  var chain = Promise.resolve(), applied = null, timer = null, state = { running: false };
  function enabled() { return !!window.Settings.get("driveOn"); }

  async function runOnce(interactive) {
    var tok = await token(interactive);
    var f = await findFile(tok), remote = f ? await download(f.id, tok) : null;
    var snapAt = Date.now() + 1, local = localSnapshot();
    var merged = merge(local, remote, snapAt);
    var changed = await applyLocal(merged, snapAt);
    if (!remote || canon(remote) !== canon(merged)) await upload(f && f.id, merged, tok);
    await window.Settings.set("driveLast", Date.now());
    await window.Settings.remove("driveErr");
    if (changed && applied) applied();
    return changed;
  }

  // 동시에 여러 번 불려도 한 줄로 처리
  function run(opts) {
    var interactive = !!(opts && opts.interactive);
    var p = chain.then(function () {
      if (!interactive && !enabled()) return 0;
      state.running = true; if (state.onState) state.onState();
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
    clearTimeout(timer);
    timer = setTimeout(function () { run().catch(function () {}); }, ms == null ? 8000 : ms);
  }

  async function connect() { await run({ interactive: true }); await window.Settings.set("driveOn", true); schedule(0); }
  async function disconnect() { clearTimeout(timer); await window.Settings.set("driveOn", false); await window.Settings.remove("driveErr"); }

  window.Sync = {
    available: available, enabled: enabled, run: run, schedule: schedule, connect: connect, disconnect: disconnect, state: state,
    merge: merge, canon: canon, localSnapshot: localSnapshot, FILE: FILE,
    onApplied: function (fn) { applied = fn; },
  };
})();
