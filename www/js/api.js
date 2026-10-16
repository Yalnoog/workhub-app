/* 로컬 API 어댑터: 서버 버전(main.py)의 /api/* 경로와 같은 규칙으로 앱 안 저장소(DB)를 다룬다.
 * 화면은 api("/tasks", {method, body}) 형태로 부르던 그대로 쓴다. 오류는 status를 가진 Error로 던진다. */
(function () {
  "use strict";
  var DB = window.DB, AI = window.AI, Settings = window.Settings;
  var seq = 0, listeners = { tasks: [] };

  function ApiError(status, msg) { var e = new Error(msg || ("API " + status)); e.status = status; return e; }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function timeNow() {
    var d = new Date(); seq = (seq + 1) % 1000;
    return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds())
      + "." + ("00" + d.getMilliseconds()).slice(-3) + ("00" + seq).slice(-3);
  }
  function emit(name) { (listeners[name] || []).forEach(function (f) { try { f(); } catch (e) { /* 구독자 오류가 저장을 막지 않게 */ } }); }
  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
  var normName = AI.normName, normTime = AI.normTime;
  function strOr(v, d) { return v == null ? d : String(v); }
  function cmpDesc(a, b) { return a < b ? 1 : a > b ? -1 : 0; }

  // ---------- 프로젝트 도우미 ----------
  function findProjectId(name) {
    var key = normName(name); if (!key) return null;
    var p = DB.all("projects").find(function (x) { return normName(x.name) === key; });
    return p ? p.id : null;
  }
  function getOrCreateProject(name, ops) {
    name = (name || "").trim(); if (!name) return null;
    var pid = findProjectId(name);
    if (pid) return pid;
    var dup = ops.find(function (o) { return o.store === "projects" && o.put && normName(o.put.name) === normName(name); });
    if (dup) return dup.put.id;
    pid = DB.uid();
    ops.push({ store: "projects", put: { id: pid, name: name, created: timeNow() } });
    return pid;
  }

  // ---------- 출력 모양 ----------
  function taskOut(t) {
    return { id: t.id, title: t.title, due: t.due || "", dueTime: t.dueTime || "", location: t.location || "",
      priority: t.priority || "mid", category: t.category || "", status: t.status || "open", created: t.created };
  }
  function meetingOut(m, withRaw) {
    var p = m.projectId ? DB.get("projects", m.projectId) : null;
    return { id: m.id, title: m.title || "", date: m.date || "", raw: withRaw ? (m.raw || "") : "",
      participants: m.participants || [], agenda: m.agenda || [], discussion: m.discussion || "", decisions: m.decisions || [],
      actionItems: m.actionItems || [], created: m.created, project: p ? p.name : "", kind: m.kind || "meeting",
      summary: m.summary || "", notes: m.notes || "" };
  }

  // ---------- 라우트 ----------
  var routes = [];
  function route(method, re, fn) { routes.push({ method: method, re: re, fn: fn }); }

  // 할일
  route("GET", /^\/tasks$/, async function () {
    return DB.all("tasks").slice().sort(function (a, b) { return cmpDesc(a.created, b.created); }).map(taskOut);
  });
  route("POST", /^\/tasks$/, async function (m, b) {
    var category = (b.category || "").trim(), auto = false, ops = [];
    var due = b.due || "", dueTime = normTime(b.dueTime), loc = (b.location || "").trim().slice(0, 60);
    if (dueTime && !due) due = AI.today();
    // 프로젝트를 직접 지정하지 않았고 (제목에 '회의'가 있거나 시간과 장소가 둘 다 있으면) '회의' 프로젝트로 자동 분류
    if (!category && ((b.title || "").indexOf("회의") >= 0 || (dueTime && loc))) { category = "회의"; auto = true; getOrCreateProject("회의", ops); }
    var t = { id: DB.uid(), title: strOr(b.title, ""), due: due, dueTime: dueTime, location: loc, priority: b.priority || "mid",
      category: category, status: "open", created: timeNow(), notified: 0 };
    ops.push({ store: "tasks", put: t });
    await DB.batch(ops); emit("tasks");
    return { id: t.id, category: category, auto: auto };
  });
  route("PATCH", /^\/tasks\/([^/]+)$/, async function (m, b) {
    if (m[1] === "classify" || m[1] === "parse") throw ApiError(405);
    var t = DB.get("tasks", m[1]); if (!t) throw ApiError(404, "task not found");
    var n = Object.assign({}, t);
    ["status", "title", "priority", "category"].forEach(function (k) { if (b[k] != null) n[k] = b[k]; });
    if (b.due != null) { n.due = b.due; n.notified = 0; }
    if (b.dueTime != null) { n.dueTime = normTime(b.dueTime); n.notified = 0; }
    if (b.location != null) n.location = String(b.location).trim().slice(0, 60);
    await DB.put("tasks", n); emit("tasks");
    return { ok: true };
  });
  route("DELETE", /^\/tasks\/([^/]+)$/, async function (m) { await DB.del("tasks", m[1]); emit("tasks"); return { ok: true }; });

  route("POST", /^\/tasks\/parse$/, async function (m, b) {
    var text = (b.text || "").trim(); if (!text) throw ApiError(400, "내용이 비어있습니다.");
    return AI.parseTasks(text);
  });
  route("POST", /^\/tasks\/classify$/, async function () {
    var names = DB.all("projects").map(function (p) { return p.name; }), known = {};
    names.forEach(function (n) { known[normName(n)] = 1; });
    var rows = DB.all("tasks").filter(function (t) { return t.status !== "done" && !known[normName(t.category)]; })
      .sort(function (a, b) { return cmpDesc(a.created, b.created); }).slice(0, 60);
    if (!rows.length) return { proposals: [] };
    return AI.classifyTasks(rows.map(function (t) { return { id: t.id, title: t.title, category: t.category || "" }; }), names);
  });

  // 회의록
  route("GET", /^\/meetings$/, async function () {
    return DB.all("meetings").slice().sort(function (a, b) { return cmpDesc(a.date || "", b.date || "") || cmpDesc(a.created, b.created); })
      .map(function (x) { return meetingOut(x, false); });
  });
  route("GET", /^\/meetings\/([^/]+)$/, async function (m) {
    var x = DB.get("meetings", m[1]); if (!x) throw ApiError(404, "meeting not found");
    return meetingOut(x, true);
  });
  route("POST", /^\/meetings$/, async function (m, b) {
    var now = timeNow(), ops = [], mid = DB.uid();
    var pid = getOrCreateProject(b.project, ops);
    ops.push({ store: "meetings", put: { id: mid, title: b.title || "제목 없음", date: b.date || now.slice(0, 10), raw: b.raw || "",
      participants: b.participants || [], agenda: b.agenda || [], discussion: b.discussion || "", decisions: b.decisions || [],
      actionItems: b.actionItems || [], created: now, projectId: pid, kind: (b.kind === "meeting" || b.kind === "memo") ? b.kind : "meeting",
      summary: b.summary || "", notes: b.notes || "" } });
    var pushed = 0;
    if (b.pushActionItems) {
      (b.actionItems || []).forEach(function (a) {
        ops.push({ store: "tasks", put: { id: DB.uid(), title: a.text || "", due: a.due || "", dueTime: "", location: "", priority: "mid",
          category: ((b.project || "").trim() || ("회의: " + (b.title || ""))), status: "open", created: now, notified: 0 } });
        pushed++;
      });
    }
    await DB.batch(ops); if (pushed) emit("tasks");
    return { id: mid, pushed_tasks: pushed };
  });
  route("PATCH", /^\/meetings\/([^/]+)$/, async function (m, b) {
    var x = DB.get("meetings", m[1]); if (!x) return { ok: true };   // 서버 버전과 동일: 없는 id는 조용히 무시
    var n = Object.assign({}, x), ops = [];
    ["title", "date", "raw", "discussion", "notes", "participants", "agenda", "decisions", "actionItems", "summary"].forEach(function (k) { if (b[k] != null) n[k] = b[k]; });
    if (b.kind === "meeting" || b.kind === "memo") n.kind = b.kind;
    if (b.project != null) n.projectId = getOrCreateProject(b.project, ops);
    ops.push({ store: "meetings", put: n });
    await DB.batch(ops);
    return { ok: true };
  });
  route("DELETE", /^\/meetings\/([^/]+)$/, async function (m) { await DB.del("meetings", m[1]); return { ok: true }; });
  route("POST", /^\/structure$/, async function (m, b) {
    if (!(b.raw || "").trim() && !(b.notes || "").trim()) throw ApiError(400, "메모가 비어있습니다.");
    var names = DB.all("projects").slice().sort(function (a, b2) { return a.created < b2.created ? -1 : 1; }).map(function (p) { return p.name; });
    return AI.structureMeeting(b, names);
  });

  // 프로젝트
  route("GET", /^\/projects$/, async function () {
    var ms = DB.all("meetings"), ts = DB.all("tasks");
    var rows = DB.all("projects").map(function (p) {
      var mine = ms.filter(function (x) { return x.projectId === p.id; });
      var last = null; mine.forEach(function (x) { if (x.date && (last === null || x.date > last)) last = x.date; });
      return { id: p.id, name: p.name, count: mine.length, last: last || "", openTasks: ts.filter(function (t) { return t.category === p.name && t.status !== "done"; }).length,
        _last: last, _created: p.created };
    });
    rows.sort(function (a, b) {
      if (a._last !== b._last) { if (a._last === null) return 1; if (b._last === null) return -1; return cmpDesc(a._last, b._last); }
      return cmpDesc(a._created, b._created);
    });
    rows.forEach(function (r) { delete r._last; delete r._created; });
    return { projects: rows, unassigned: ms.filter(function (x) { return !x.projectId; }).length };
  });
  route("POST", /^\/projects$/, async function (m, b) {
    var ops = [], pid = getOrCreateProject(b.name, ops);
    if (!pid) throw ApiError(400, "이름이 비어있습니다.");
    await DB.batch(ops); return { id: pid };
  });
  route("PATCH", /^\/projects\/([^/]+)$/, async function (m, b) {
    var nw = (b.name || "").trim(); if (!nw) throw ApiError(400, "이름이 비어있습니다.");
    var p = DB.get("projects", m[1]); if (!p) throw ApiError(404, "프로젝트 없음");
    var other = findProjectId(nw); if (other && other !== p.id) throw ApiError(409, "같은 이름의 프로젝트가 이미 있습니다. '합치기'를 사용하세요.");
    var old = p.name, ops = [{ store: "projects", put: Object.assign({}, p, { name: nw }) }];
    DB.all("tasks").forEach(function (t) { if (t.category === old) ops.push({ store: "tasks", put: Object.assign({}, t, { category: nw }) }); });
    await DB.batch(ops); return { ok: true };
  });
  route("POST", /^\/projects\/classify-unassigned$/, async function () {
    var rows = DB.all("meetings").filter(function (x) { return !x.projectId; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var names = DB.all("projects").map(function (p) { return p.name; });
    if (!rows.length) return { proposals: [] };
    return AI.classifyMeetings(rows.map(function (x) { return { id: x.id, title: x.title, date: x.date, content: (x.summary || x.discussion || "").slice(0, 300) }; }), names);
  });
  route("POST", /^\/projects\/([^/]+)\/merge$/, async function (m, b) {
    if (b.into === m[1]) throw ApiError(400, "같은 프로젝트입니다.");
    var src = DB.get("projects", m[1]), dst = DB.get("projects", b.into);
    if (!src || !dst) throw ApiError(404, "프로젝트 없음");
    var ops = [];
    DB.all("meetings").forEach(function (x) { if (x.projectId === src.id) ops.push({ store: "meetings", put: Object.assign({}, x, { projectId: dst.id }) }); });
    DB.all("tasks").forEach(function (t) { if (t.category === src.name) ops.push({ store: "tasks", put: Object.assign({}, t, { category: dst.name }) }); });
    ops.push({ store: "projects", del: src.id });
    await DB.batch(ops); emit("tasks"); return { ok: true };
  });
  route("DELETE", /^\/projects\/([^/]+)$/, async function (m, b, q) {
    var p = DB.get("projects", m[1]), ops = [], deleted = { tasks: 0, meetings: 0 };
    if (q.cascade && Number(q.cascade) && p) {
      var key = normName(p.name);
      DB.all("tasks").forEach(function (t) { if (normName(t.category) === key) { ops.push({ store: "tasks", del: t.id }); deleted.tasks++; } });
      DB.all("meetings").forEach(function (x) { if (x.projectId === p.id) { ops.push({ store: "meetings", del: x.id }); deleted.meetings++; } });
    } else {
      DB.all("meetings").forEach(function (x) { if (x.projectId === m[1]) ops.push({ store: "meetings", put: Object.assign({}, x, { projectId: null }) }); });
    }
    ops.push({ store: "projects", del: m[1] });
    await DB.batch(ops); if (deleted.tasks) emit("tasks");
    return { ok: true, tasks: deleted.tasks, meetings: deleted.meetings };
  });

  // 용어 사전
  route("GET", /^\/vocab$/, async function () {
    return DB.all("vocab").slice().sort(function (a, b) { return a.created < b.created ? -1 : 1; }).map(function (v) { return { id: v.id, wrong: v.wrong || "", right: v.right || "" }; });
  });
  route("POST", /^\/vocab$/, async function (m, b) {
    var right = (b.right || "").trim(); if (!right) throw ApiError(400, "올바른 표기를 입력하세요.");
    var v = { id: DB.uid(), wrong: (b.wrong || "").trim(), right: right, created: timeNow() };
    await DB.put("vocab", v); return { id: v.id };
  });
  route("POST", /^\/vocab\/apply$/, async function (m, b) { return { text: AI.applyVocab(b.text || "") }; });
  route("DELETE", /^\/vocab\/([^/]+)$/, async function (m) { await DB.del("vocab", m[1]); return { ok: true }; });

  // 공휴일(앱에 내장된 표)
  route("GET", /^\/holidays$/, async function (m, b, q) {
    var year = parseInt(q.year, 10);
    if (!(year >= 1990 && year <= 2100)) throw ApiError(400, "지원하지 않는 연도입니다.");
    var list = (window.HOLIDAYS_BY_YEAR || {})[String(year)];
    return list ? { available: true, year: year, holidays: list } : { available: false, year: year, holidays: [] };
  });

  // Gemini 사용량(앱 안 기록)
  var DEFAULT_LIMITS = {
    "gemini-3.5-flash-lite": { rpm: 10, rpd: 500 },
    "gemini-flash-latest": { rpm: 10, rpd: 20 },
    "gemini-3.5-flash": { rpm: 10, rpd: 20 },
  };
  function limitsMerged() {
    var out = JSON.parse(JSON.stringify(DEFAULT_LIMITS)), saved = Settings.get("geminiLimits") || {};
    Object.keys(saved).forEach(function (k) { if (out[k] && saved[k]) { ["rpm", "rpd"].forEach(function (f) { if (Number(saved[k][f]) >= 0) out[k][f] = Number(saved[k][f]); }); } });
    return out;
  }
  function ptDate(t) { return new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }); }
  route("GET", /^\/gemini\/usage$/, async function () {
    var now = Date.now(), rows = DB.all("usage").filter(function (u) { return u.t >= now - 9 * 86400000; }).sort(function (a, b) { return b.t - a.t; });
    var limits = limitsMerged(), todayPT = ptDate(now), models = {};
    function mk(name) { return models[name] = models[name] || { model: name, limits: limits[name] || { rpm: 0, rpd: 0 },
      day: { requests: 0, ok: 0, errors: 0, tokensIn: 0, tokensOut: 0 }, minute: { requests: 0, tokens: 0 } }; }
    AI.TEXT_MODELS.concat(AI.AUDIO_MODELS).forEach(mk);
    var history = {}, base = new Date(todayPT + "T00:00:00Z");
    for (var i = 6; i >= 0; i--) { var d = new Date(base.getTime() - i * 86400000); history[d.toISOString().slice(0, 10)] = 0; }
    rows.forEach(function (r) {
      var d = ptDate(r.t); if (d in history) history[d]++;
      var mm = mk(r.model);
      if (d === todayPT) { mm.day.requests++; if (r.status === 200) mm.day.ok++; else mm.day.errors++; mm.day.tokensIn += r.pt || 0; mm.day.tokensOut += r.ot || 0; }
      if (r.t >= now - 60000) { mm.minute.requests++; mm.minute.tokens += r.tt || 0; }
    });
    var parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(now);
    var get = function (t) { return parseInt((parts.find(function (p) { return p.type === t; }) || { value: "0" }).value, 10) % 24; };
    var left = 86400 - (get("hour") * 3600 + get("minute") * 60 + get("second"));
    var resetAt = new Date(now + left * 1000);
    var fmt = function (t) { var d = new Date(t); return p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()); };
    return { tier: "free", models: Object.keys(models).map(function (k) { return models[k]; }),
      history: Object.keys(history).map(function (k) { return { date: k, requests: history[k] }; }), todayPT: todayPT,
      resetKST: p2(resetAt.getHours()) + ":" + p2(resetAt.getMinutes()), resetInSec: left,
      recent: rows.slice(0, 12).map(function (r) { return { time: fmt(r.t), model: r.model, purpose: r.purpose || "", status: r.status, tokens: r.tt || 0 }; }),
      defaults: DEFAULT_LIMITS };
  });
  route("PUT", /^\/gemini\/limits$/, async function (m, b) {
    var clean = {};
    Object.keys(b.limits || {}).forEach(function (k) {
      if (!DEFAULT_LIMITS[k]) return;
      var v = b.limits[k] || {}, rpm = parseInt(v.rpm, 10), rpd = parseInt(v.rpd, 10);
      if (isNaN(rpm) || isNaN(rpd)) throw ApiError(400, "한도는 숫자로 입력하세요.");
      clean[k] = { rpm: Math.max(0, rpm), rpd: Math.max(0, rpd) };
    });
    await Settings.set("geminiLimits", clean); return { ok: true };
  });

  async function request(path, opts) {
    opts = opts || {};
    var method = (opts.method || "GET").toUpperCase();
    var qi = path.indexOf("?"), p = qi >= 0 ? path.slice(0, qi) : path, q = {};
    if (qi >= 0) new URLSearchParams(path.slice(qi + 1)).forEach(function (v, k) { q[k] = v; });
    var body = {}; if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { throw ApiError(400, "잘못된 요청"); } }
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i]; if (r.method !== method) continue;
      var m = r.re.exec(p); if (!m) continue;
      var out = await r.fn(m, body, q);
      return out === undefined ? { ok: true } : JSON.parse(JSON.stringify(out));
    }
    throw ApiError(404);
  }

  window.LocalApi = { request: request, on: on, timeNow: timeNow, ApiError: ApiError };
})();
