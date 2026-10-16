package kr.workhub.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** 웹 화면이 만든 할일 요약본(JSON)을 위젯용 저장소에 쓰고 위젯을 새로 그린다 */
@CapacitorPlugin(name = "WorkhubWidget")
public class WidgetPlugin extends Plugin {
    @PluginMethod
    public void setData(PluginCall call) {
        String json = call.getString("json", "{}");
        WidgetStore.save(getContext(), json);
        WidgetStore.refreshAll(getContext());
        call.resolve();
    }

    /** 홈 화면에 놓인 위젯 개수(설정 화면 안내용) */
    @PluginMethod
    public void count(PluginCall call) {
        AppWidgetManager m = AppWidgetManager.getInstance(getContext());
        int n = m.getAppWidgetIds(new ComponentName(getContext(), TaskWidgetProvider.class)).length
              + m.getAppWidgetIds(new ComponentName(getContext(), CalendarWidgetProvider.class)).length;
        JSObject o = new JSObject(); o.put("count", n); call.resolve(o);
    }
}
