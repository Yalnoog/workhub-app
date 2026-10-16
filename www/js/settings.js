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
  function set(key, value) { return window.DB.put("settings", { key: key, value: value }); }
  function remove(key) { return window.DB.del("settings", key); }

  window.Settings = { get: get, set: set, remove: remove, DEFAULTS: DEFAULTS };
})();
