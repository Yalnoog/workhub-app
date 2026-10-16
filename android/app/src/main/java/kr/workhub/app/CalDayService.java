package kr.workhub.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;

/** 캘린더 위젯에서 선택한 날짜의 일정 목록 */
public class CalDayService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    static class Factory implements RemoteViewsFactory {
        private final Context c; private final int id;
        private List<WidgetLogic.Task> items = new ArrayList<>();
        Factory(Context c, int id) { this.c = c; this.id = id; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            items = WidgetLogic.tasksOn(WidgetLogic.parseTasks(WidgetStore.json(c)), WidgetStore.selected(c, id));
        }
        @Override public void onDestroy() { items.clear(); }
        @Override public int getCount() { return items.size(); }
        @Override public RemoteViews getViewAt(int i) {
            RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_day_item);
            if (i < 0 || i >= items.size()) return rv;
            WidgetLogic.Task t = items.get(i);
            rv.setTextViewText(R.id.day_time, t.time.isEmpty() ? "종일" : t.time);
            rv.setTextViewText(R.id.day_task, (t.done ? "✓ " : "") + t.title);
            rv.setTextColor(R.id.day_task, c.getResources().getColor(t.done ? R.color.wg_dim : R.color.wg_fg, null));
            rv.setOnClickFillInIntent(R.id.item_root, new Intent());
            return rv;
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int i) { return i; }
        @Override public boolean hasStableIds() { return false; }
    }
}
