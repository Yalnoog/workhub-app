package kr.workhub.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.Calendar;

/** 앱(웹 화면)이 써 둔 할일 요약본과 위젯별 상태(보고 있는 달, 선택한 날짜)를 보관하고, 모든 위젯을 새로 그린다. */
final class WidgetStore {
    private WidgetStore() {}
    static final String PREFS = "wh_widget";
    static final String ACTION_REFRESH = "kr.workhub.app.WIDGET_REFRESH";

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    static String json(Context c) { return prefs(c).getString("json", "{}"); }
    static void save(Context c, String json) { prefs(c).edit().putString("json", json).apply(); }

    static String today() { return WidgetLogic.ymd(Calendar.getInstance()); }

    static String month(Context c, int id) { return prefs(c).getString("ym_" + id, today().substring(0, 7)); }
    static String selected(Context c, int id) { return prefs(c).getString("sel_" + id, today()); }
    static void setState(Context c, int id, String ym, String sel) { prefs(c).edit().putString("ym_" + id, ym).putString("sel_" + id, sel).apply(); }
    static void clearState(Context c, int id) { prefs(c).edit().remove("ym_" + id).remove("sel_" + id).apply(); }

    static int flagImmutable() { return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0; }
    static int flagMutable() { return Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0; }

    /** 앱을 연다 */
    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 7001, i, PendingIntent.FLAG_UPDATE_CURRENT | flagImmutable());
    }

    /** 모든 위젯을 새 데이터로 다시 그린다 */
    static void refreshAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] t = m.getAppWidgetIds(new ComponentName(c, TaskWidgetProvider.class));
        if (t.length > 0) TaskWidgetProvider.update(c, m, t);
        int[] k = m.getAppWidgetIds(new ComponentName(c, CalendarWidgetProvider.class));
        if (k.length > 0) CalendarWidgetProvider.update(c, m, k);
    }

    /** 자정 직후에 위젯을 갱신하도록 알람 예약(날짜가 바뀌면 '오늘'·'지연' 표시가 달라지므로) */
    static void scheduleMidnight(Context c) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            Calendar n = Calendar.getInstance();
            n.add(Calendar.DAY_OF_MONTH, 1); n.set(Calendar.HOUR_OF_DAY, 0); n.set(Calendar.MINUTE, 0); n.set(Calendar.SECOND, 5); n.set(Calendar.MILLISECOND, 0);
            Intent i = new Intent(c, TaskWidgetProvider.class).setAction(ACTION_REFRESH);
            PendingIntent pi = PendingIntent.getBroadcast(c, 7002, i, PendingIntent.FLAG_UPDATE_CURRENT | flagImmutable());
            am.set(AlarmManager.RTC, n.getTimeInMillis(), pi);   // 정확하지 않아도 되는 갱신이라 inexact로 충분
        } catch (Exception ignore) {}
    }
}
