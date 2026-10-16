# 앱 아이콘(PNG)을 SVG에서 렌더링해 android/app/src/main/res 에 넣는다. Playwright 도커 컨테이너에서 실행: python make_icons.py <res_dir>
import sys, pathlib
from playwright.sync_api import sync_playwright
res = pathlib.Path(sys.argv[1])
TEAL = "#0f766e"
def mark(scale_box):  # 체크 표시가 들어간 문서 모양 (108 단위 좌표, 안전영역 안)
    return f'''<g transform="translate(54 54) scale({scale_box}) translate(-54 -54)">
      <rect x="34" y="28" width="40" height="52" rx="6" fill="none" stroke="#fff" stroke-width="5"/>
      <path d="M43 54 L51 62 L66 45" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M43 72 H60" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
    </g>'''
def svg(kind, px):
    bg = {"legacy": f'<rect width="108" height="108" rx="24" fill="{TEAL}"/>', "round": f'<circle cx="54" cy="54" r="54" fill="{TEAL}"/>', "fg": ""}[kind]
    s = 1.35 if kind != "fg" else 1.0
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{px}" height="{px}" viewBox="0 0 108 108">{bg}{mark(s)}</svg>'
dens = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page()
    for d, m in dens.items():
        for kind, name, base in (("legacy", "ic_launcher", 48), ("round", "ic_launcher_round", 48), ("fg", "ic_launcher_foreground", 108)):
            px = round(base * m)
            pg.set_viewport_size({"width": px, "height": px})
            pg.set_content(f'<body style="margin:0;background:transparent">{svg(kind, px)}</body>')
            out = res / f"mipmap-{d}" / f"{name}.png"
            pg.screenshot(path=str(out), omit_background=True)
    br.close()
print("icons ok")
