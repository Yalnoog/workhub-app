import json, re
from common import *

CAL = {"cals": {}, "events": {}, "log": [], "n": 0, "mode": "ok", "page": 1000, "rate": 0, "restore_put": True}
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}

def reset():
    CAL.update({"cals": {}, "events": {}, "log": [], "n": 0, "mode": "ok", "page": 1000, "rate": 0, "restore_put": True})

def _send(r, status, body=None):
    r.fulfill(status=status, headers=CORS, content_type="application/json", body=json.dumps(body) if body is not None else "")

def cal_route(r):
    req = r.request
    if req.method == "OPTIONS": return r.fulfill(status=204, headers=CORS)
    path = re.sub(r"^https://www.googleapis.com/calendar/v3", "", req.url.split("?")[0])
    query = req.url.split("?", 1)[1] if "?" in req.url else ""
    m = req.method
    CAL["log"].append((m, path))
    if req.headers.get("authorization") != "Bearer tok": return _send(r, 401, {"error": {"code": 401, "message": "unauth"}})
    if CAL["mode"] == "api_off":
        return _send(r, 403, {"error": {"code": 403, "message": "Google Calendar API has not been used in project 1 before or it is disabled.", "errors": [{"reason": "accessNotConfigured"}], "status": "PERMISSION_DENIED"}})
    if CAL["mode"] == "noperm":
        return _send(r, 403, {"error": {"code": 403, "message": "Insufficient Permission", "errors": [{"reason": "insufficientPermissions"}]}})
    if CAL["rate"] > 0 and m == "PUT":
        CAL["rate"] -= 1
        return _send(r, 429, {"error": {"code": 429, "message": "rate", "errors": [{"reason": "rateLimitExceeded"}]}})
    body = json.loads(req.post_data) if req.post_data else {}
    if path == "/calendars" and m == "POST":
        CAL["n"] += 1; cid = "cal%d@group.calendar.google.com" % CAL["n"]
        CAL["cals"][cid] = {"id": cid, "summary": body.get("summary"), "timeZone": body.get("timeZone")}; CAL["events"][cid] = {}
        return _send(r, 200, CAL["cals"][cid])
    mm = re.match(r"^/calendars/([^/]+)$", path)
    if mm:
        cid = requests_unquote(mm.group(1))
        if cid not in CAL["cals"]: return _send(r, 404, {"error": {"code": 404, "message": "Not Found", "errors": [{"reason": "notFound"}]}})
        if m == "GET": return _send(r, 200, CAL["cals"][cid])
        if m == "DELETE": del CAL["cals"][cid]; del CAL["events"][cid]; return _send(r, 204)
    mm = re.match(r"^/calendars/([^/]+)/events(?:/([^/]+))?$", path)
    if mm:
        cid, eid = requests_unquote(mm.group(1)), mm.group(2)
        if cid not in CAL["cals"]: return _send(r, 404, {"error": {"code": 404, "message": "Not Found", "errors": [{"reason": "notFound"}]}})
        evs = CAL["events"][cid]
        if m == "GET" and not eid:
            ids = sorted(k for k, v in evs.items() if v.get("status") != "cancelled")
            start = int(re.search(r"pageToken=(\d+)", query).group(1)) if "pageToken=" in query else 0
            chunk = ids[start:start + CAL["page"]]
            out = {"items": [evs[i] for i in chunk]}
            if start + CAL["page"] < len(ids): out["nextPageToken"] = str(start + CAL["page"])
            return _send(r, 200, out)
        if m == "POST" and not eid:
            if body["id"] in evs: return _send(r, 409, {"error": {"code": 409, "message": "The requested identifier already exists.", "errors": [{"reason": "duplicate"}]}})
            evs[body["id"]] = body; return _send(r, 200, body)
        if m == "PUT" and eid:
            old = evs.get(eid)
            if old is None or (old.get("status") == "cancelled" and not CAL["restore_put"]):
                return _send(r, 404, {"error": {"code": 404, "message": "Not Found", "errors": [{"reason": "notFound"}]}})
            evs[eid] = body; return _send(r, 200, body)
        if m == "DELETE" and eid:
            old = evs.get(eid)
            if old is None: return _send(r, 404, {"error": {"code": 404, "message": "Not Found"}})
            if old.get("status") == "cancelled": return _send(r, 410, {"error": {"code": 410, "message": "Resource has been deleted"}})
            old["status"] = "cancelled"; return _send(r, 204)
    _send(r, 404, {"error": {"code": 404, "message": "no route " + path}})

def requests_unquote(s):
    from urllib.parse import unquote
    return unquote(s)

def live(cid=None):
    cid = cid or next(iter(CAL["cals"]))
    return {k: v for k, v in CAL["events"][cid].items() if v.get("status") != "cancelled"}

def writes():
    return [(m, p) for m, p in CAL["log"] if m in ("POST", "PUT", "DELETE") and "/events" in p]
