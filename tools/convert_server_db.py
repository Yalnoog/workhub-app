#!/usr/bin/env python3
"""서버판(work_hub) SQLite DB -> 앱 백업 파일(JSON). 서버 DB는 읽기 전용으로만 연다(복사본 사용 권장).

사용법:  python3 tools/convert_server_db.py <workhub.db 경로> <출력.json>
앱에서 [설정 → 백업 불러오기 → 합치기]로 불러오면 된다. 같은 파일을 여러 번 불러와도 이미 들어온 항목(id)은 중복되지 않는다.
"""
import json, sqlite3, sys, datetime

def jl(v, default):
    try:
        x = json.loads(v) if v else default
        return x if isinstance(x, type(default)) else default
    except Exception:
        return default

def main(src, out):
    c = sqlite3.connect("file:%s?mode=ro" % src, uri=True)
    c.row_factory = sqlite3.Row
    projects = [{"id": r["id"], "name": r["name"], "created": r["created"] or ""} for r in c.execute("SELECT * FROM projects")]
    pid = {p["id"] for p in projects}
    tasks = []
    for r in c.execute("SELECT * FROM tasks"):
        k = r.keys()
        tasks.append({"id": r["id"], "title": r["title"] or "", "due": r["due"] or "", "dueTime": (r["due_time"] if "due_time" in k else "") or "",
                      "location": (r["location"] if "location" in k else "") or "", "priority": r["priority"] or "mid", "category": r["category"] or "",
                      "status": r["status"] or "open", "created": r["created"] or "", "notified": 0})
    meetings = []
    for r in c.execute("SELECT * FROM meetings"):
        k = r.keys()
        p = (r["project_id"] if "project_id" in k else None)
        meetings.append({"id": r["id"], "title": r["title"] or "제목 없음", "date": r["date"] or "", "raw": r["raw"] or "",
                         "participants": jl(r["participants"], []), "agenda": jl(r["agenda"], []), "discussion": r["discussion"] or "",
                         "decisions": jl(r["decisions"], []), "actionItems": jl(r["action_items"], []), "created": r["created"] or "",
                         "projectId": p if p in pid else None, "kind": ((r["kind"] if "kind" in k else None) or "meeting"),
                         "summary": ((r["summary"] if "summary" in k else None) or ""), "notes": ((r["notes"] if "notes" in k else None) or "")})
    vocab = [{"id": r["id"], "wrong": r["wrong"] or "", "right": r["right"] or "", "created": r["created"] or ""} for r in c.execute("SELECT * FROM vocab")]
    doc = {"app": "workhub-standalone", "version": 1, "exportedAt": datetime.datetime.now().isoformat(),
           "data": {"tasks": tasks, "meetings": meetings, "projects": projects, "vocab": vocab, "settings": []}}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False)
    print("변환 완료: 할일 %d · 회의록 %d · 프로젝트 %d · 용어 %d -> %s" % (len(tasks), len(meetings), len(projects), len(vocab), out))
    dangling = sum(1 for m in meetings if m["projectId"] is None)
    print("프로젝트 미지정 회의록: %d건" % dangling)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
