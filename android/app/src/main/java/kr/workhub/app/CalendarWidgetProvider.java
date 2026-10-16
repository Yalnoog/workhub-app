package kr.workhub.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** 캘린더 위젯: 달력에서 날짜를 누르면 그 아래에 그날의 일정이 보인다 */
public class CalendarWidgetProvider extends AppWidgetProvider {
    static final String ACTION_PICK = "kr.workhub.app.CAL_PICK";
    static final String ACTION_NAV = "kr.workhub.app.CAL_NAV";
    static final String ACTION_TODAY = "kr.workhub.app.CAL_TODAY";

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { update(c, m, ids); WidgetStore.scheduleMidnight(c); }

    @Override public void onEnabled(Context c) { WidgetStore.scheduleMidnight(c); }

    @Override public void onDeleted(Context c, int[] ids) { for (int id : ids) WidgetStore.clearState(c, id); }

    @Override public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        String a = intent.getAction();
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (id == AppWidgetManager.INVALID_APPWIDGET_ID || a == null) return;
        String today = WidgetStore.today();
        if (ACTION_PICK.equals(a)) {
            String date = intent.getStringExtra("date");
            if (date != null && date.length() == 10) WidgetStore.setState(c, id, date.substring(0, 7), date);
        } else if (ACTION_NAV.equals(a)) {
            String ym = WidgetLogic.shiftMonth(WidgetStore.month(c, id), intent.getIntExtra("delta", 0));
            WidgetStore.setState(c, id, ym, ym.equals(today.substring(0, 7)) ? today : ym + "-01");
        } else if (ACTION_TODAY.equals(a)) {
            WidgetStore.setState(c, id, today.substring(0, 7), today);
        } else return;
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        update(c, m, new int[] { id });
    }

    private static PendingIntent bcast(Context c, int id, String action, int req, boolean mutable, String extraKey, int extraInt) {
        Intent i = new Intent(c, CalendarWidgetProvider.class).setAction(action).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        if (extraKey != null) i.putExtra(extraKey, extraInt);
        return PendingIntent.getBroadcast(c, id * 10 + req, i, PendingIntent.FLAG_UPDATE_CURRENT | (mutable ? WidgetStore.flagMutable() : WidgetStore.flagImmutable()));
    }

    static void update(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) {
            String ym = WidgetStore.month(c, id), sel = WidgetStore.selected(c, id);
            RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_calendar);
            rv.setTextViewText(R.id.month_title, ym.substring(0, 4) + "년 " + Integer.parseInt(ym.substring(5)) + "월");
            rv.setOnClickPendingIntent(R.id.prev, bcast(c, id, ACTION_NAV, 1, false, "delta", -1));
            rv.setOnClickPendingIntent(R.id.next, bcast(c, id, ACTION_NAV, 2, false, "delta", 1));
            rv.setOnClickPendingIntent(R.id.month_title, bcast(c, id, ACTION_TODAY, 3, false, null, 0));   // 제목을 누르면 오늘로

            Intent g = new Intent(c, CalGridService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            g.setData(Uri.parse(g.toUri(Intent.URI_INTENT_SCHEME)));
            rv.setRemoteAdapter(R.id.grid, g);
            Intent pick = new Intent(c, CalendarWidgetProvider.class).setAction(ACTION_PICK).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            rv.setPendingIntentTemplate(R.id.grid, PendingIntent.getBroadcast(c, id * 10 + 4, pick, PendingIntent.FLAG_UPDATE_CURRENT | WidgetStore.flagMutable()));

            rv.setTextViewText(R.id.day_title, WidgetLogic.dayLabel(sel));
            Intent d = new Intent(c, CalDayService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            d.setData(Uri.parse(d.toUri(Intent.URI_INTENT_SCHEME)));
            rv.setRemoteAdapter(R.id.day_list, d);
            rv.setEmptyView(R.id.day_list, R.id.day_empty);
            rv.setPendingIntentTemplate(R.id.day_list, WidgetStore.openApp(c));
            rv.setOnClickPendingIntent(R.id.day_empty, WidgetStore.openApp(c));
            rv.setOnClickPendingIntent(R.id.day_title, WidgetStore.openApp(c));

            m.updateAppWidget(id, rv);
            m.notifyAppWidgetViewDataChanged(id, R.id.grid);
            m.notifyAppWidgetViewDataChanged(id, R.id.day_list);
        }
    }
}
