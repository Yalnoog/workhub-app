from common import *

with sync_playwright() as p:
    br, ctx, pg, errs = open_app(p, "cover")
    R = lambda path, method="GET", body=None: pg.evaluate("([p,m,b]) => LocalApi.request(p,{method:m,body:b?JSON.stringify(b):undefined}).catch(e=>({__err:e.status||e.message}))", [path, method, body])
    def F(r):  # POST /tasks는 {id, auto}만 돌려주므로(서버판과 동일) 목록에서 다시 찾는다
        return next(x for x in R("/tasks") if x["id"] == r["id"])
    # 할일: 시간만 있으면 오늘, 잘못된 시간은 비움
    t = F(R("/tasks", "POST", {"title": "시간만", "dueTime": "9:05"}))
    ok(t["dueTime"] == "09:05" and t["due"] == pg.evaluate("AI.today()"), f"시간만 있으면 오늘로 설정, 시각 정규화 {t['due']} {t['dueTime']}")
    t2 = F(R("/tasks", "POST", {"title": "미래", "due": "2030-05-01", "dueTime": "25:00", "category": "A 라인"}))
    ok(t2["dueTime"] == "", "잘못된 시각은 비움")
    # 회의 자동 분류
    t3 = F(R("/tasks", "POST", {"title": "주간 회의", "due": "2030-05-01"}))
    ok(t3["category"] == "회의", f"제목에 '회의'가 있으면 분류가 '회의' ({t3['category']!r})")
    t4 = F(R("/tasks", "POST", {"title": "킥오프", "due": "2030-05-01", "dueTime": "10:00", "location": "대회의실"}))
    ok(t4["category"] == "회의", "시간+장소가 있으면 회의로 분류")
    # 알림 플래그 초기화
    pg.evaluate("id => DB.put('tasks', Object.assign({}, DB.get('tasks', id), {notified: 1}))", t2["id"])
    R("/tasks/" + t2["id"], "PATCH", {"due": "2030-05-02"})
    ok(pg.evaluate("id => DB.get('tasks', id).notified", t2["id"]) == 0, "마감일 변경 시 알림 여부 초기화")
    # 프로젝트 이름 변경 -> 할일 분류 갱신, 병합, 삭제
    pr = R("/projects", "POST", {"name": "A 라인"})
    ok(bool(pr.get("id")), "프로젝트 생성")
    dup = R("/projects", "POST", {"name": "a라인"})
    ok(dup.get("id") == pr.get("id") or "__err" in dup or dup.get("name") == "A 라인", f"공백·대소문자 다른 같은 이름은 중복 생성 안 됨 {dup}")
    R("/projects/" + pr["id"], "PATCH", {"name": "A라인 개조"})
    ok(F(t2)["category"] == "A라인 개조", "프로젝트 이름 변경이 할일 분류에 반영")
    out = R("/projects/" + pr["id"] + "?cascade=1", "DELETE")
    left = [x["title"] for x in R("/tasks")]
    ok("미래" not in left and "시간만" in left, f"프로젝트 + 할일 함께 삭제 {left}")
    # 회의록
    m = R("/meetings", "POST", {"title": "회의A", "date": "2030-01-01", "raw": "원문", "actionItems": [{"text": "할일X", "due": "2030-01-02"}], "pushActionItems": True, "project": "P1"})
    ok(m.get("id"), "회의록 생성")
    lst = R("/meetings")
    ok(lst[0]["raw"] == "", "회의 목록에는 원문이 비어 있음(가볍게)")
    ok(R("/meetings/" + m["id"]).get("raw") == "원문", "회의 상세에는 원문 포함")
    ok(any(x["title"] == "할일X" and x["category"] == "P1" for x in R("/tasks")), "액션아이템 → 할일 변환(프로젝트 분류)")
    # 용어 사전
    R("/vocab", "POST", {"wrong": "에이비씨", "right": "ABC-100"})
    ok(R("/vocab/apply", "POST", {"text": "에이비씨 설계"})["text"] == "ABC-100 설계", "용어 사전 적용")
    # 공휴일
    h = R("/holidays?year=2026")
    ok(h.get("available") and any("설" in str(v) or "추석" in str(v) for v in (h.get("holidays", {}) if isinstance(h.get("holidays"), dict) else h.get("holidays", []))), f"공휴일 표 {str(h)[:120]}")
    ok(not errs, f"자바스크립트 오류 없음 {errs}")
    br.close()
finish()
