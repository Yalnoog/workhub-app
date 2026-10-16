import json, os, re, time
from playwright.sync_api import sync_playwright

B = os.environ.get("WH_BASE", "http://127.0.0.1:10077")
SHOTS = os.environ.get("SHOTS", "/shots")
SIZES = {"cover": (412, 960), "inner": (968, 872)}
fails = 0

def ok(c, msg):
    global fails
    print(("PASS " if c else "FAIL ") + msg)
    if not c: fails += 1

def finish():
    print("실패 %d건" % fails)
    raise SystemExit(1 if fails else 0)

GEMINI_CALLS = []

def mock_gemini(ctx, handler=None):
    """Gemini REST를 가로채 모의 응답을 준다. handler(model, body) -> 텍스트(str) 또는 (status, dict)"""
    def route(r):
        req = r.request
        url = req.url
        if req.method == "OPTIONS":
            return r.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*"})
        m = re.search(r"/models/([^:/]+):generateContent", url)
        body = {}
        try: body = json.loads(req.post_data or "{}")
        except Exception: pass
        if not m:
            if "/models" in url and req.method == "GET":
                return r.fulfill(status=200, headers={"access-control-allow-origin": "*", "content-type": "application/json"}, body=json.dumps({"models": []}))
            return r.fulfill(status=404, headers={"access-control-allow-origin": "*"}, body="{}")
        GEMINI_CALLS.append({"model": m.group(1), "body": body, "key": req.headers.get("x-goog-api-key")})
        out = handler(m.group(1), body) if handler else "ok"
        status, payload = 200, None
        if isinstance(out, tuple): status, payload = out
        else: payload = {"candidates": [{"content": {"parts": [{"text": out}]}}], "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15}}
        r.fulfill(status=status, headers={"access-control-allow-origin": "*", "content-type": "application/json"}, body=json.dumps(payload))
    ctx.route("https://generativelanguage.googleapis.com/**", route)

def open_app(p, size="cover", key=True, handler=None, skip_onboard=True):
    w, h = SIZES[size]
    br = p.chromium.launch(args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])
    ctx = br.new_context(viewport={"width": w, "height": h}, permissions=["microphone"], has_touch=True)
    errs = []
    mock_gemini(ctx, handler)
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(B + "/"); pg.wait_for_function("window.DB && window.LocalApi")
    if key:
        pg.evaluate("Settings.set('apiKey','AIzaTESTKEY00000000')")
    pg.wait_for_timeout(900)
    if key and pg.locator("#onboardModal").is_visible(): pg.click("#obSkip"); pg.wait_for_timeout(300)   # 키를 넣기 전에 첫 안내가 먼저 뜬 경우
    return br, ctx, pg, errs
