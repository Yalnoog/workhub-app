package kr.workhub.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import java.util.List;

/** 전체 할일 목록 위젯 */
public class TaskWidgetProvider extends AppWidgetProvider {

    @Override public void onUpdate(Context c, AppWidgetManager m, int[] ids) { update(c, m, ids); WidgetStore.scheduleMidnight(c); }

    @Override public void onEnabled(Context c) { WidgetStore.scheduleMidnight(c); }

    @Override public void onReceive(Context c, Intent intent) {
        super.onReceive(c, intent);
        if (WidgetStore.ACTION_REFRESH.equals(intent.getAction())) { WidgetStore.refreshAll(c); WidgetStore.scheduleMidnight(c); }
    }

    static void update(Context c, AppWidgetManager m, int[] ids) {
        List<WidgetLogic.Task> all = WidgetLogic.parseTasks(WidgetStore.json(c));
        int[] n = WidgetLogic.counts(all, WidgetStore.today());
        int open = WidgetLogic.openSorted(all).size();
        for (int id : ids) {
            RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_tasks);
            rv.setTextViewText(R.id.title, "할일 " + open + "건");
            rv.setTextViewText(R.id.summary, "지연 " + n[0] + " · 오늘 " + n[1] + " · 3일 이내 " + n[2]);
            Intent svc = new Intent(c, TaskListService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
            svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
            rv.setRemoteAdapter(R.id.list, svc);
            rv.setEmptyView(R.id.list, R.id.empty);
            rv.setPendingIntentTemplate(R.id.list, WidgetStore.openApp(c));
            rv.setOnClickPendingIntent(R.id.header, WidgetStore.openApp(c));
            rv.setOnClickPendingIntent(R.id.empty, WidgetStore.openApp(c));
            m.updateAppWidget(id, rv);
            m.notifyAppWidgetViewDataChanged(id, R.id.list);
        }
    }
}
