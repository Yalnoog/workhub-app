package kr.workhub.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 캘린더 위젯의 달력 칸(6주 × 7일) */
public class CalGridService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 0));
    }

    static class Factory implements RemoteViewsFactory {
        private final Context c; private final int id;
        private List<WidgetLogic.Cell> cells = new ArrayList<>();
        private Map<String, Integer> counts = new java.util.HashMap<>();
        private Set<String> hol = new HashSet<>();
        private String today = "", sel = "";
        Factory(Context c, int id) { this.c = c; this.id = id; }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            String json = WidgetStore.json(c), ym = WidgetStore.month(c, id);
            today = WidgetStore.today(); sel = WidgetStore.selected(c, id);
            cells = WidgetLogic.monthGrid(Integer.parseInt(ym.substring(0, 4)), Integer.parseInt(ym.substring(5)));
            counts = WidgetLogic.openCountByDate(WidgetLogic.parseTasks(json));
            hol = WidgetLogic.parseHolidays(json);
        }
        @Override public void onDestroy() { cells.clear(); }
        @Override public int getCount() { return cells.size(); }

        @Override public RemoteViews getViewAt(int i) {
            RemoteViews rv = new RemoteViews(c.getPackageName(), R.layout.widget_cal_cell);
            if (i < 0 || i >= cells.size()) return rv;
            WidgetLogic.Cell k = cells.get(i);
            boolean isToday = k.date.equals(today), isSel = k.date.equals(sel);
            int color;
            if (isToday) color = R.color.wg_on_accent;
            else if (!k.inMonth) color = R.color.wg_dim;
            else if (k.dow == 0 || hol.contains(k.date)) color = R.color.wg_red;
            else if (k.dow == 6) color = R.color.wg_blue;
            else color = R.color.wg_fg;
            rv.setTextViewText(R.id.cell_day, String.valueOf(k.day));
            rv.setTextColor(R.id.cell_day, c.getResources().getColor(color, null));
            Integer n = counts.get(k.date);
            rv.setViewVisibility(R.id.cell_dot, n != null && n > 0 ? android.view.View.VISIBLE : android.view.View.INVISIBLE);
            rv.setTextColor(R.id.cell_dot, c.getResources().getColor(isToday ? R.color.wg_on_accent : R.color.wg_accent, null));
            rv.setInt(R.id.cell_root, "setBackgroundResource", isToday ? R.drawable.cell_today : isSel ? R.drawable.cell_selected : R.drawable.cell_none);
            rv.setOnClickFillInIntent(R.id.cell_root, new Intent().putExtra("date", k.date));
            return rv;
        }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int i) { return i; }
        @Override public boolean hasStableIds() { return false; }
    }
}
