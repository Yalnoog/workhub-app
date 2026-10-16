package kr.workhub.app;

import static org.junit.Assert.*;

import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class WidgetLogicTest {
    private static final String JSON = "{\"tasks\":["
        + "{\"id\":\"a\",\"title\":\"지연건\",\"due\":\"2026-10-10\"},"
        + "{\"id\":\"b\",\"title\":\"오늘 오후\",\"due\":\"2026-10-16\",\"time\":\"15:00\"},"
        + "{\"id\":\"c\",\"title\":\"오늘 오전\",\"due\":\"2026-10-16\",\"time\":\"09:30\"},"
        + "{\"id\":\"d\",\"title\":\"기한없음\"},"
        + "{\"id\":\"e\",\"title\":\"내일\",\"due\":\"2026-10-17\"},"
        + "{\"id\":\"f\",\"title\":\"3일뒤\",\"due\":\"2026-10-19\"},"
        + "{\"id\":\"g\",\"title\":\"일주일뒤\",\"due\":\"2026-10-23\"},"
        + "{\"id\":\"h\",\"title\":\"완료건\",\"due\":\"2026-10-16\",\"done\":true}],"
        + "\"hol\":[\"2026-10-03\",\"2026-10-09\"]}";
    private static final String TODAY = "2026-10-16";

    @Test public void diffAndBadge() {
        assertEquals(-6, WidgetLogic.diffDays("2026-10-10", TODAY));
        assertEquals(0, WidgetLogic.diffDays(TODAY, TODAY));
        assertEquals(14, WidgetLogic.diffDays("2026-10-30", TODAY));
        assertEquals(Integer.MIN_VALUE, WidgetLogic.diffDays("", TODAY));
        List<WidgetLogic.Task> t = WidgetLogic.parseTasks(JSON);
        assertEquals("지연 6일", WidgetLogic.badge(t.get(0), TODAY));
        assertEquals("오늘", WidgetLogic.badge(t.get(1), TODAY));
        assertEquals("", WidgetLogic.badge(t.get(3), TODAY));
        assertEquals("내일", WidgetLogic.badge(t.get(4), TODAY));
        assertEquals("D-3", WidgetLogic.badge(t.get(5), TODAY));
    }

    @Test public void diffAcrossMonthAndYearEnd() {
        assertEquals(2, WidgetLogic.diffDays("2027-01-01", "2026-12-30"));
        assertEquals(1, WidgetLogic.diffDays("2026-03-01", "2026-02-28"));
        assertEquals(1, WidgetLogic.diffDays("2026-03-29", "2026-03-28"));   // 서머타임 같은 시간 이동이 있어도 하루 차이
    }

    @Test public void openListIsSortedAndExcludesDone() {
        List<WidgetLogic.Task> open = WidgetLogic.openSorted(WidgetLogic.parseTasks(JSON));
        StringBuilder sb = new StringBuilder();
        for (WidgetLogic.Task t : open) sb.append(t.id);
        assertEquals("acbefgd", sb.toString());   // 지연 → 오늘(시간순) → 가까운 순 → 기한 없음, 완료(h) 제외
    }

    @Test public void counts() {
        int[] c = WidgetLogic.counts(WidgetLogic.parseTasks(JSON), TODAY);
        assertArrayEquals(new int[] { 1, 2, 2 }, c);   // 지연 1, 오늘 2(완료 제외), 3일 이내 2(내일·3일뒤)
    }

    @Test public void monthGridStartsOnSundayAnd42Cells() {
        List<WidgetLogic.Cell> g = WidgetLogic.monthGrid(2026, 10);   // 2026-10-01 은 목요일
        assertEquals(42, g.size());
        assertEquals("2026-09-27", g.get(0).date);
        assertEquals(0, g.get(0).dow);
        assertFalse(g.get(0).inMonth);
        assertEquals("2026-10-01", g.get(4).date);
        assertTrue(g.get(4).inMonth);
        assertEquals(4, g.get(4).dow);
        assertEquals("2026-11-07", g.get(41).date);
        int inMonth = 0; for (WidgetLogic.Cell c : g) if (c.inMonth) inMonth++;
        assertEquals(31, inMonth);
    }

    @Test public void monthGridFebruaryLeapAndSundayStart() {
        List<WidgetLogic.Cell> g = WidgetLogic.monthGrid(2026, 2);   // 2026-02-01 은 일요일
        assertEquals("2026-02-01", g.get(0).date);
        int inMonth = 0; for (WidgetLogic.Cell c : g) if (c.inMonth) inMonth++;
        assertEquals(28, inMonth);
        int leap = 0; for (WidgetLogic.Cell c : WidgetLogic.monthGrid(2028, 2)) if (c.inMonth) leap++;
        assertEquals(29, leap);
    }

    @Test public void shiftMonthWrapsYear() {
        assertEquals("2027-01", WidgetLogic.shiftMonth("2026-12", 1));
        assertEquals("2025-12", WidgetLogic.shiftMonth("2026-01", -1));
        assertEquals("2026-10", WidgetLogic.shiftMonth("2026-10", 0));
    }

    @Test public void dayTasksAndMarkers() {
        List<WidgetLogic.Task> all = WidgetLogic.parseTasks(JSON);
        Map<String, Integer> m = WidgetLogic.openCountByDate(all);
        assertEquals(Integer.valueOf(2), m.get("2026-10-16"));   // 완료건은 점에 포함하지 않음
        assertNull(m.get("2026-10-15"));
        List<WidgetLogic.Task> day = WidgetLogic.tasksOn(all, "2026-10-16");
        assertEquals(3, day.size());
        assertEquals("c", day.get(0).id);   // 09:30
        assertEquals("b", day.get(1).id);   // 15:00
        assertEquals("h", day.get(2).id);   // 완료건은 아래
        assertEquals("10월 16일 (금)", WidgetLogic.dayLabel("2026-10-16"));
    }

    @Test public void holidaysAndBrokenData() {
        Set<String> h = WidgetLogic.parseHolidays(JSON);
        assertTrue(h.contains("2026-10-09"));
        assertEquals(0, WidgetLogic.parseTasks("").size());
        assertEquals(0, WidgetLogic.parseTasks("{bad").size());
        assertEquals(0, WidgetLogic.parseHolidays("{}").size());
    }
}
