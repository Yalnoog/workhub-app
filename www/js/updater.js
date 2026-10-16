/* 앱 안 업데이트(안드로이드 앱 전용). 앱을 열 때 GitHub 최신 릴리스를 확인하고, 새 버전이 있으면 배너로 알린다.
 * 안드로이드 보안상 사용자 확인 없이 설치할 수는 없어서, "업데이트" 버튼 → 내려받기 → 시스템 설치 화면의 "설치"를 누르는 방식이다. */
(function () {
  "use strict";
  var REPO = "Yalnoog/workhub-app";
  var MIN_GAP = 60 * 1000;   // 앱을 열 때마다 확인하되, 시작 직후 이벤트가 겹쳐 두 번 조회되는 것만 막는다

  function C() { return window.Capacitor; }
  function P() { return C() && C().isNativePlatform && C().isNativePlatform() && C().Plugins && C().Plugins.WorkhubUpdate; }
  function available() { return !!P(); }
  function parse(v) { return String(v || "").replace(/^v/i, "").split(".").map(function (x) { return parseInt(x, 10) || 0; }); }
  function cmp(a, b) { a = parse(a); b = parse(b); for (var i = 0; i < Math.max(a.length, b.length); i++) { var d = (a[i] || 0) - (b[i] || 0); if (d) return d < 0 ? -1 : 1; } return 0; }

  var latest = null;   // {version, url, notes}
  var inflight = null;

  function check(force) {
    if (!available()) return Promise.resolve(null);
    if (!inflight) inflight = doCheck(force).finally(function () { inflight = null; });   // 동시에 불려도 한 번만 조회
    return inflight;
  }

  async function doCheck(force) {
    var last = Number(window.Settings.get("updChecked")) || 0;
    if (!force && Date.now() - last < MIN_GAP) return latest;
    var cur = (await P().version()).versionName;
    var res = await fetch("https://api.github.com/repos/" + REPO + "/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error("GitHub 응답 오류 (" + res.status + ")");
    var j = await res.json();
    await window.Settings.set("updChecked", Date.now());
    var asset = (j.assets || []).filter(function (a) { return /\.apk$/i.test(a.name); })[0];
    latest = null;
    if (asset && cmp(cur, j.tag_name) < 0) latest = { version: String(j.tag_name).replace(/^v/i, ""), url: asset.browser_download_url, current: String(cur).replace(/^v/i, "") };
    return latest;
  }

  async function install(onProgress) {
    if (!latest) throw new Error("새 버전 정보가 없습니다.");
    var handle = null;
    if (onProgress && P().addListener) handle = await P().addListener("progress", function (e) { onProgress(e.percent); });
    try { await P().install({ url: latest.url }); }
    finally { if (handle && handle.remove) handle.remove(); }
  }

  window.Updater = { available: available, check: check, install: install, cmp: cmp, get latest() { return latest; } };
})();
