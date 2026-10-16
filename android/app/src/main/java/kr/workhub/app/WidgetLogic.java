package kr.workhub.app;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** 위젯이 쓰는 순수 계산(안드로이드 의존성 없음 → 단위 테스트 가능): 데이터 읽기, 정렬, 날짜 표시, 달력 칸 계산 */
final class WidgetLogic {
    private WidgetLogic() {}

    static final class Task {
        String id = "", title = "", due = "", time = "", cat = "", pri = "mid";
        boolean done;
    }

    static final class Cell {
        String date;      // yyyy-MM-dd
        int day;          // 1~31
        boolean inMonth;
        int dow;          // 0=일 ... 6=토
    }

    // ---------- 날짜 ----------
    static String ymd(Calendar c) {
        return String.format(java.util.Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
    }

    static Calendar parseYmd(String s) {
        try {
            String[] p = s.split("-");
            Calendar c = Calendar.getInstance();
            c.clear(); c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, Integer.parseInt(p[2]), 0, 0, 0);
            c.set(Calendar.MILLISECOND, 0);
            return c;
        } catch (Exception e) { return null; }
    }

    /** due - today (일). 날짜가 없거나 형식이 틀리면 Integer.MIN_VALUE */
    static int diffDays(String due, String today) {
        Calendar a = parseYmd(due), b = parseYmd(today);
        if (a == null || b == null) return Integer.MIN_VALUE;
        long ms = a.getTimeInMillis() - b.getTimeInMillis();
        return (int) Math.round(ms / 86400000.0);
    }

    static String badge(Task t, String today) {
        int d = diffDays(t.due, today);
        if (d == Integer.MIN_VALUE) return "";
        if (d < 0) return "지연 " + (-d) + "일";
        if (d == 0) return "오늘";
        if (d == 1) return "내일";
        return "D-" + d;
    }

    // ---------- 데이터 ----------
    static List<Task> parseTasks(String json) {
        List<Task> out = new ArrayList<>();
        try {
            JSONArray a = new JSONObject(json).optJSONArray("tasks");
            if (a == null) return out;
            for (int i = 0; i < a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                Task t = new Task();
                t.id = o.optString("id"); t.title = o.optString("title"); t.due = o.optString("due"); t.time = o.optString("time");
                t.cat = o.optString("cat"); t.pri = o.optString("pri", "mid"); t.done = o.optBoolean("done", false);
                out.add(t);
            }
        } catch (Exception ignore) { /* 비어 있거나 깨진 데이터는 빈 목록 */ }
        return out;
    }

    static Set<String> parseHolidays(String json) {
        Set<String> out = new HashSet<>();
        try {
            JSONArray a = new JSONObject(json).optJSONArray("hol");
            if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.getString(i));
        } catch (Exception ignore) {}
        return out;
    }

    // ---------- 전체 할일 목록: 지연 → 오늘 → 가까운 순 → 기한 없음 ----------
    static List<Task> openSorted(List<Task> all) {
        List<Task> open = new ArrayList<>();
        for (Task t : all) if (!t.done) open.add(t);
        Collections.sort(open, new Comparator<Task>() {
            @Override public int compare(Task a, Task b) {
                boolean an = a.due.isEmpty(), bn = b.due.isEmpty();
                if (an != bn) return an ? 1 : -1;               // 기한 없는 것은 맨 뒤
                int c = a.due.compareTo(b.due);
                if (c != 0) return c;
                String ta = a.time.isEmpty() ? "99:99" : a.time, tb = b.time.isEmpty() ? "99:99" : b.time;
                return ta.compareTo(tb);
            }
        });
        return open;
    }

    /** {지연, 오늘, 3일 이내(내일~3일 뒤)} 개수 — 완료한 것은 제외 */
    static int[] counts(List<Task> all, String today) {
        int over = 0, now = 0, soon = 0;
        for (Task t : all) {
            if (t.done || t.due.isEmpty()) continue;
            int d = diffDays(t.due, today);
            if (d == Integer.MIN_VALUE) continue;
            if (d < 0) over++; else if (d == 0) now++; else if (d <= 3) soon++;
        }
        return new int[] { over, now, soon };
    }

    // ---------- 캘린더 ----------
    /** 해당 월을 일요일 시작 6주(42칸)로 */
    static List<Cell> monthGrid(int year, int month /*1~12*/) {
        Calendar c = Calendar.getInstance();
        c.clear(); c.set(year, month - 1, 1, 0, 0, 0);
        c.add(Calendar.DAY_OF_MONTH, -(c.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY));
        List<Cell> out = new ArrayList<>();
        for (int i = 0; i < 42; i++) {
            Cell x = new Cell();
            x.date = ymd(c); x.day = c.get(Calendar.DAY_OF_MONTH);
            x.inMonth = c.get(Calendar.MONTH) == month - 1; x.dow = c.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY;
            out.add(x);
            c.add(Calendar.DAY_OF_MONTH, 1);
        }
        return out;
    }

    /** 날짜별 (완료하지 않은) 할일 개수 */
    static Map<String, Integer> openCountByDate(List<Task> all) {
        Map<String, Integer> m = new HashMap<>();
        for (Task t : all) if (!t.done && !t.due.isEmpty()) { Integer n = m.get(t.due); m.put(t.due, n == null ? 1 : n + 1); }
        return m;
    }

    static List<Task> tasksOn(List<Task> all, String date) {
        List<Task> out = new ArrayList<>();
        for (Task t : all) if (date.equals(t.due)) out.add(t);
        Collections.sort(out, new Comparator<Task>() {
            @Override public int compare(Task a, Task b) {
                if (a.done != b.done) return a.done ? 1 : -1;     // 완료한 것은 아래로
                String ta = a.time.isEmpty() ? "99:99" : a.time, tb = b.time.isEmpty() ? "99:99" : b.time;
                return ta.compareTo(tb);
            }
        });
        return out;
    }

    /** yyyy-MM 에서 delta 개월 이동 */
    static String shiftMonth(String ym, int delta) {
        String[] p = ym.split("-");
        Calendar c = Calendar.getInstance();
        c.clear(); c.set(Integer.parseInt(p[0]), Integer.parseInt(p[1]) - 1, 1);
        c.add(Calendar.MONTH, delta);
        return String.format(java.util.Locale.ROOT, "%04d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1);
    }

    static String dayLabel(String date) {
        Calendar c = parseYmd(date);
        if (c == null) return date;
        String[] w = { "일", "월", "화", "수", "목", "금", "토" };
        return (c.get(Calendar.MONTH) + 1) + "월 " + c.get(Calendar.DAY_OF_MONTH) + "일 (" + w[c.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY] + ")";
    }
}
