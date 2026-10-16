package kr.workhub.app;

import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.List;

public class TaskListService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) { return new Factory(getApplicationContext()); }

    static class Factory implements RemoteViewsFactory {
        private final Context c;
        private List<WidgetLogic.Task> items = new ArrayList<>();
        private String today = "";
        Factory(Context c) { this.c = c; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            today = WidgetStore.today();
            items = WidgetLogic.openSorted(WidgetLogic.parseTasks(WidgetStore.json(c)));
        }
        @Override public void onDestroy() { items.clear(); }
        @Override public int getCount() { return items.size(); }
        @Override public RemoteViews getViewAt(int i) {
            RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_task_item);
            if (i < 0 || i >= items.size()) return rv;
            WidgetLogic.Task t = items.get(i);
            int d = WidgetLogic.diffDays(t.due, today);
            int dot = "high".equals(t.pri) ? R.color.wg_red : "low".equals(t.pri) ? R.color.wg_dim : R.color.wg_accent;
            rv.setTextColor(R.id.dot, c.getResources().getColor(dot, null));
            rv.setTextViewText(R.id.item_title, t.title);
            String b = WidgetLogic.badge(t, today);
            if (!t.time.isEmpty()) b = b.isEmpty() ? t.time : b + " " + t.time;
            rv.setTextViewText(R.id.item_badge, b);
            int color = d != Integer.MIN_VALUE && d < 0 ? R.color.wg_red : d == 0 ? R.color.wg_amber : R.color.wg_muted;
            rv.setTextColor(R.id.item_badge, c.getResources().getColor(color, null));
            rv.setOnClickFillInIntent(R.id.item_root, new Intent());
            return rv;
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int i) { return i; }
        @Override public boolean hasStableIds() { return false; }
    }
}
