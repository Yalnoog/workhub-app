/* 앱 안 저장소(IndexedDB). 데이터가 작아서 전부 메모리에 올려 두고(읽기는 즉시), 바뀐 것만 IndexedDB에 기록한다.
 * stores: tasks, meetings, projects, vocab, usage, settings(keyPath: key), segments(녹음 조각 대기열) */
(function () {
  "use strict";
  var DB_NAME = "workhub", DB_VER = 1;
  var STORES = { tasks: "id", meetings: "id", projects: "id", vocab: "id", usage: "id", settings: "key", segments: "id" };
  var cache = {};
  var db = null;

  function reqP(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }

  function uid() {
    var a = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }

  async function init() {
    if (db) return;
    db = await new Promise(function (resolve, reject) {
      var open = indexedDB.open(DB_NAME, DB_VER);
      open.onupgradeneeded = function () {
        var d = open.result;
        Object.keys(STORES).forEach(function (s) { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: STORES[s] }); });
      };
      open.onsuccess = function () { resolve(open.result); };
      open.onerror = function () { reject(open.error); };
    });
    for (var s in STORES) {
      var all = await reqP(db.transaction(s, "readonly").objectStore(s).getAll());
      cache[s] = all;
    }
    // 오래된 사용량 기록(40일 초과)은 정리
    var cutoff = Date.now() - 40 * 86400000;
    var old = (cache.usage || []).filter(function (u) { return u.t < cutoff; });
    if (old.length) await batch(old.map(function (u) { return { store: "usage", del: u.id }; }));
  }

  function all(store) { return cache[store]; }
  function get(store, id) { var k = STORES[store]; return cache[store].find(function (x) { return x[k] === id; }) || null; }

  // ops: [{store, put: obj} | {store, del: key}] 를 한 트랜잭션으로 저장하고 메모리 캐시도 갱신
  async function batch(ops) {
    if (!ops.length) return;
    var names = Array.from(new Set(ops.map(function (o) { return o.store; })));
    var tx = db.transaction(names, "readwrite");
    var done = new Promise(function (res, rej) { tx.oncomplete = res; tx.onerror = function () { rej(tx.error); }; tx.onabort = function () { rej(tx.error || new Error("abort")); }; });
    ops.forEach(function (o) {
      var st = tx.objectStore(o.store), k = STORES[o.store];
      if ("put" in o) {
        st.put(o.put);
        var i = cache[o.store].findIndex(function (x) { return x[k] === o.put[k]; });
        if (i >= 0) cache[o.store][i] = o.put; else cache[o.store].push(o.put);
      } else {
        st.delete(o.del);
        cache[o.store] = cache[o.store].filter(function (x) { return x[k] !== o.del; });
      }
    });
    await done;
  }
  function put(store, obj) { return batch([{ store: store, put: obj }]); }
  function del(store, id) { return batch([{ store: store, del: id }]); }

  async function clearAll() {
    var ops = [];
    for (var s in STORES) cache[s].slice().forEach(function (x) { ops.push({ store: s, del: x[STORES[s]] }); });
    await batch(ops);
  }

  // 설정(API 키 등)은 남기고 사용자 데이터만 지운다
  async function wipeData() {
    var ops = [];
    ["tasks", "meetings", "projects", "vocab", "usage", "segments"].forEach(function (s) {
      cache[s].slice().forEach(function (x) { ops.push({ store: s, del: x[STORES[s]] }); });
    });
    await batch(ops);
    await del("settings", "draft");
  }

  // 백업(내보내기/가져오기)용: 설정 중 API 키는 기본적으로 제외
  function dump(includeKey) {
    var out = { app: "workhub-standalone", version: 1, exportedAt: new Date().toISOString(), data: {} };
    ["tasks", "meetings", "projects", "vocab", "settings"].forEach(function (s) {
      out.data[s] = cache[s].filter(function (x) { return s !== "settings" || includeKey || x.key !== "apiKey"; });
    });
    return out;
  }
  async function restore(obj) {
    if (!obj || obj.app !== "workhub-standalone" || !obj.data) throw new Error("올바른 백업 파일이 아닙니다.");
    var keepKey = get("settings", "apiKey");
    var ops = [];
    ["tasks", "meetings", "projects", "vocab", "settings"].forEach(function (s) {
      cache[s].slice().forEach(function (x) { if (!(s === "settings" && x.key === "apiKey")) ops.push({ store: s, del: x[STORES[s]] }); });
      (obj.data[s] || []).forEach(function (x) { if (!(s === "settings" && x.key === "apiKey" && keepKey)) ops.push({ store: s, put: x }); });
    });
    await batch(ops);
  }

  window.DB = { init: init, all: all, get: get, put: put, del: del, batch: batch, uid: uid, clearAll: clearAll, wipeData: wipeData, dump: dump, restore: restore };
})();
