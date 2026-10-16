/* 안드로이드 앱에서만 쓰는 보조 기능(파일 공유). 브라우저에서는 정의하지 않아 화면 쪽이 웹 방식으로 대체한다. */
(function () {
  "use strict";
  var C = window.Capacitor;
  if (!(C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem && C.Plugins.Share)) return;
  // 백업 파일을 앱 임시 폴더에 쓰고 안드로이드 공유창을 띄운다(드라이브·카카오톡·파일 저장 등을 고를 수 있음)
  window.NativeFiles = {
    share: async function (text, filename) {
      var w = await C.Plugins.Filesystem.writeFile({ path: filename, data: text, directory: "CACHE", encoding: "utf8" });
      await C.Plugins.Share.share({ title: filename, dialogTitle: "백업 파일 저장", url: w.uri });
    },
  };
})();
