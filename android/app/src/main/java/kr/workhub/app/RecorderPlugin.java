package kr.workhub.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.util.Arrays;

/** 웹 화면 <-> 네이티브 녹음 서비스 다리. start/stop/status/pending/remove */
@CapacitorPlugin(name = "WorkhubRecorder", permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "mic") })
public class RecorderPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("mic") != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias("mic", call, "micPerm");
            return;
        }
        doStart(call);
    }

    @PermissionCallback
    private void micPerm(PluginCall call) {
        if (getPermissionState("mic") == com.getcapacitor.PermissionState.GRANTED) doStart(call);
        else call.reject("마이크 권한이 필요합니다.", "NO_MIC");
    }

    private void doStart(PluginCall call) {
        Context c = getContext();
        if (RecorderService.isRunning(c)) { call.resolve(statusObj()); return; }
        Intent i = new Intent(c, RecorderService.class).setAction(RecorderService.ACTION_START).putExtra("segmentSec", call.getInt("segmentSec", 600));
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) { call.reject("녹음을 시작하지 못했습니다: " + e.getMessage(), "START_FAIL"); return; }
        JSObject o = new JSObject(); o.put("recording", true); o.put("startedAt", System.currentTimeMillis());
        call.resolve(o);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context c = getContext();
        c.startService(new Intent(c, RecorderService.class).setAction(RecorderService.ACTION_STOP));
        call.resolve();
    }

    private JSObject statusObj() {
        JSObject o = new JSObject();
        o.put("recording", RecorderService.isRunning(getContext()));
        o.put("startedAt", RecorderService.startedAt(getContext()));
        return o;
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(statusObj()); }

    /** 완성된 조각 목록(오래된 순) */
    @PluginMethod
    public void pending(PluginCall call) {
        File[] fs = RecorderService.dir(getContext()).listFiles((d, n) -> n.endsWith(".m4a"));
        JSArray arr = new JSArray();
        if (fs != null) {
            Arrays.sort(fs, (a, b) -> a.getName().compareTo(b.getName()));
            for (File f : fs) { JSObject o = new JSObject(); o.put("name", f.getName()); o.put("path", f.getAbsolutePath()); o.put("size", f.length()); arr.put(o); }
        }
        JSObject r = new JSObject(); r.put("files", arr); call.resolve(r);
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String name = call.getString("name", "");
        if (name.contains("/") || name.contains("..")) { call.reject("bad name"); return; }
        File f = new File(RecorderService.dir(getContext()), name);
        boolean ok = !f.exists() || f.delete();
        JSObject r = new JSObject(); r.put("removed", ok); call.resolve(r);
    }
}
