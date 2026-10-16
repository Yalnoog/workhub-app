package kr.workhub.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/** 앱 안 업데이트: 현재 버전 조회 + 새 APK 내려받기 + 시스템 설치 화면 띄우기 (마지막 "설치" 확인은 사용자가 누른다) */
@CapacitorPlugin(name = "WorkhubUpdate")
public class UpdatePlugin extends Plugin {

    @PluginMethod
    public void version(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject o = new JSObject();
            o.put("versionName", pi.versionName);
            o.put("versionCode", (long) pi.getLongVersionCode());
            call.resolve(o);
        } catch (Exception e) { call.reject("버전을 읽지 못했습니다."); }
    }

    /** url(https, GitHub 릴리스 파일)을 받아 설치 화면을 띄운다. 이 앱이 "출처를 알 수 없는 앱 설치" 허용 전이면 설정 화면을 열고 NEED_PERMISSION으로 알린다. */
    @PluginMethod
    public void install(final PluginCall call) {
        final String url = call.getString("url", "");
        if (!url.startsWith("https://github.com/") && !url.startsWith("https://objects.githubusercontent.com/")) { call.reject("허용되지 않은 주소입니다.", "BAD_URL"); return; }
        if (!getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(s);
            call.reject("설치 허용이 필요합니다.", "NEED_PERMISSION");
            return;
        }
        new Thread(new Runnable() { @Override public void run() {
            try {
                File dir = new File(getContext().getCacheDir(), "update"); dir.mkdirs();
                File[] old = dir.listFiles(); if (old != null) for (File f : old) f.delete();
                File apk = new File(dir, "update.apk");
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true); c.setConnectTimeout(20000); c.setReadTimeout(30000);
                if (c.getResponseCode() / 100 != 2) { call.reject("내려받지 못했습니다. (HTTP " + c.getResponseCode() + ")", "HTTP"); return; }
                long total = c.getContentLengthLong(), got = 0, lastEmit = 0;
                try (InputStream in = c.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[65536]; int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n); got += n;
                        if (total > 0 && got - lastEmit > total / 20) { lastEmit = got; JSObject p = new JSObject(); p.put("percent", (int) (got * 100 / total)); notifyListeners("progress", p); }
                    }
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent i = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(i);
                call.resolve();
            } catch (Exception e) { call.reject("업데이트를 내려받지 못했습니다: " + e.getMessage(), "DOWNLOAD"); }
        } }).start();
    }
}
