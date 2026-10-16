/* 설정 저장(IndexedDB settings 저장소). apiKey, profile(직무 설명), notify(알림 옵션), draft(작성 중 임시저장) 등 */
(function () {
  "use strict";
  var DEFAULTS = {
    profile: "",            // 예: "반도체 장비 제어 엔지니어" - 비우면 일반 직장인으로 처리
    notifyLeadMin: 30,      // 시간이 정해진 할일은 몇 분 전에 알림
    notifyHour: 9,          // 시간이 없는 할일은 마감일 몇 시에 알림
    segmentMin: 10,         // 녹음 조각 길이(분) - 짧을수록 무료 호출 횟수를 더 쓴다
  };

  function get(key) {
    var r = window.DB.get("settings", key);
    if (r && r.value !== undefined) return r.value;
    return DEFAULTS[key];
  }
  // 기기 간 동기화 대상 설정(값이 바뀌면 수정 시각 _u를 찍고 동기화를 예약한다). apiKey는 사용자가 스위치를 켠 경우에만 올라간다.
  var SYNC_KEYS = ["profile", "notifyLeadMin", "notifyHour", "segmentMin"];
  function syncable(key) { return SYNC_KEYS.indexOf(key) >= 0 || key === "apiKey"; }
  function set(key, value) {
    var rec = { key: key, value: value };
    if (syncable(key)) rec._u = window.DB.stamp();
    var notify = SYNC_KEYS.indexOf(key) >= 0 || (key === "apiKey" && !!get("syncKey"));
    return window.DB.put2("settings", rec, { notify: notify });
  }
  function remove(key) { return window.DB.del("settings", key); }

  window.Settings = { get: get, set: set, remove: remove, DEFAULTS: DEFAULTS, SYNC_KEYS: SYNC_KEYS, raw: function (k) { return window.DB.get("settings", k); } };
})();
