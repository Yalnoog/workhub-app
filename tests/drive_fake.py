import json, re
from common import *

GB = 1073741824
DRIVE = {"file": None, "body": None, "calls": 0, "about": {"limit": str(15 * GB), "usage": str(int(4.2 * GB))}, "about_status": 200}
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}

def drive_route(r):
    req = r.request; url = req.url
    if req.method == "OPTIONS": return r.fulfill(status=204, headers=CORS)
    DRIVE["calls"] += 1
    if req.headers.get("authorization") != "Bearer tok": return r.fulfill(status=401, headers=CORS, body="{}")
    if "/upload/drive/v3/files" in url:
        data = req.post_data or ""
        if req.method == "POST":
            body = data.split("Content-Type: application/json\r\n\r\n")[1].rsplit("\r\n--", 1)[0]
            DRIVE["file"] = "f1"; DRIVE["body"] = body
            return r.fulfill(status=200, headers=CORS, content_type="application/json", body=json.dumps({"id": "f1"}))
        DRIVE["body"] = data
        return r.fulfill(status=200, headers=CORS, content_type="application/json", body=json.dumps({"id": "f1"}))
    if "/drive/v3/about" in url:
        if DRIVE["about_status"] != 200:
            return r.fulfill(status=DRIVE["about_status"], headers=CORS, content_type="application/json", body=json.dumps({"error": {"message": "insufficient permissions"}}))
        return r.fulfill(status=200, headers=CORS, content_type="application/json", body=json.dumps({"storageQuota": DRIVE["about"]}))
    if "alt=media" in url:
        return r.fulfill(status=200, headers=CORS, content_type="application/json", body=DRIVE["body"])
    files = [{"id": DRIVE["file"], "modifiedTime": "2030-01-01T00:00:00Z", "size": str(len((DRIVE["body"] or "").encode()))}] if DRIVE["file"] else []
    return r.fulfill(status=200, headers=CORS, content_type="application/json", body=json.dumps({"files": files}))

FAKE = """() => { window.__mode = 'ok';
  window.Capacitor = { isNativePlatform: () => true, Plugins: { WorkhubGoogle: { getToken: async (o) => {
    if (window.__mode === 'consent') { const e = new Error('c'); e.code = 'NEED_CONSENT'; throw e; }
    return { accessToken: 'tok' }; } } } }; }"""

def device(p, key=True, skip=True):
    br, ctx, pg, errs = open_app(p, "inner", key=key)
    if not key and skip and pg.locator("#onboardModal").is_visible(): pg.click("#obSkip")
    ctx.route("https://www.googleapis.com/**", drive_route)
    pg.evaluate(FAKE)
    return br, pg, errs

T = lambda pg: sorted((x["title"] for x in pg.evaluate("LocalApi.request('/tasks')")))
def add(pg, title, **kw):
    return pg.evaluate("([t,k]) => LocalApi.request('/tasks',{method:'POST',body:JSON.stringify(Object.assign({title:t},k))})", [title, kw])
def sync(pg): return pg.evaluate("Sync.run({interactive:true}).then(()=>'ok', e=>e.code+':'+e.message)")

