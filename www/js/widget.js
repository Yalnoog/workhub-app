/* 홈 화면 위젯용 데이터 전달(안드로이드 앱 전용). 할일이 바뀌면 요약본(JSON)을 네이티브에 보내 위젯을 새로 그리게 한다.
 * 위젯은 이 요약본만 읽는다(앱을 열 때까지의 최신 상태). 브라우저에서는 아무것도 하지 않는다. */
(function () {
  "use strict";
  function P() { var C = window.Capacitor; return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.WorkhubWidget) || null; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  function snapshot() {
    var now = new Date(), cut = new Date(now.getTime() - 60 * 86400000), cutoff = ymd(cut);
    var tasks = window.DB.all("tasks").filter(function (t) { return t.status !== "done" || (t.due && t.due >= cutoff); })   // 완료한 것은 최근 60일 것만
      .slice(0, 800).map(function (t) {
        return { id: t.id, title: t.title || "", due: t.due || "", time: t.dueTime || "", cat: t.category || "", pri: t.priority || "mid", done: t.status === "done" };
      });
    var hol = [], by = window.HOLIDAYS_BY_YEAR || {};
    [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].forEach(function (y) {
      (by[String(y)] || []).forEach(function (h) { if (h.kind === "holiday") hol.push(h.date); });
    });
    return { v: 1, t: Date.now(), tasks: tasks, hol: hol };
  }

  var timer = null;
  function push(now) {
    if (!P()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { try { P().setData({ json: JSON.stringify(snapshot()) }); } catch (e) { /* 위젯 갱신 실패가 앱을 막지 않게 */ } }, now ? 0 : 800);
  }
  async function count() { try { return (await P().count()).count; } catch (e) { return 0; } }

  window.WidgetSync = { push: push, snapshot: snapshot, available: function () { return !!P(); }, count: count };
})();
