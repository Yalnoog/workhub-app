import json
from common import *

MEETINGS = [
  dict(title="A라인 아이리스 비전 위치 결정 회의", project="A라인 설비 개조", summary="위치 결정", decisions=["아이리스 비전으로 위치 결정"], raw="원문에만 있는 단어 하이퍼토큰", date="2026-10-16"),
  dict(title="2호기 공사 일정 협의", project="B라인 신규 설비", discussion="1호기 검증 후 아이리스 파라미터를 2호기에 동일 적용", raw="x", date="2026-10-12"),
  dict(title="월간 설비 점검 회의", project="", participants=["김OO", "이OO"], agenda=["아이리스 카메라 교체 이력 확인"], raw="x", date="2026-09-28"),
  dict(title="PMAC 설계 리뷰", project="A라인 설비 개조", discussion="PMAC 파라미터 검토", raw="x", date="2026-09-20"),
  dict(title="파맥 통신 점검", project="B라인 신규 설비", discussion="파맥 응답 확인", raw="x", date="2026-09-10"),
  dict(title="<b>태그</b> 테스트", project="", discussion="특수문자 & <i>이탤릭</i>", raw="x", date="2026-09-01"),
]

def cards(pg): return pg.locator("#meetingList > li.meeting")
def titles(pg): return pg.locator("#meetingList .mtitle").all_inner_texts()
def search(pg, text):
    pg.fill("#msq", text); pg.wait_for_timeout(350)

with sync_playwright() as p:
    for size in ("cover", "inner"):
        br, ctx, pg, errs = open_app(p, size)
        pg.evaluate("""async (ms) => {
          for (const m of ms) await LocalApi.request('/meetings', {method:'POST', body: JSON.stringify(m)});
          await LocalApi.request('/vocab', {method:'POST', body: JSON.stringify({wrong:'파맥', right:'PMAC'})});
        }""", MEETINGS)
        pg.reload(); pg.wait_for_function("window.DB && DB.all('meetings').length === 6"); pg.wait_for_timeout(900)
        if pg.locator("#onboardModal").is_visible(): pg.click("#obSkip")
        pg.evaluate("document.querySelector('nav.bottom-nav [data-tab=meetings]').click()"); pg.wait_for_timeout(500)
        if pg.locator("#composer").evaluate("e=>e.open"): pg.click("#composer > summary")
        S = size + ": "
        ok(cards(pg).count() == 6 and pg.locator("#msCount").is_hidden(), S + "검색하지 않으면 전체 6건, 개수 표시 없음")
        ok(pg.evaluate("document.getElementById('msRaw').checked") is False, S + "음성 원문 검색은 기본 꺼짐")

        search(pg, "아이리스")
        ok(cards(pg).count() == 3, S + f"'아이리스' 3건: {titles(pg)}")
        ok("검색 결과 3건 / 전체 6건" in pg.inner_text("#msCount"), S + "결과 개수 표시")
        marks = [m for m in pg.locator("#meetingList mark").all_inner_texts() if m]   # 접힌 본문 안의 강조는 화면에 안 보이므로 제외
        ok(len(marks) >= 4 and all(t == "아이리스" for t in marks), S + f"검색어 강조: {marks}")
        sn = pg.locator("#meetingList .sx-snip").all_inner_texts()
        ok(len(sn) == 3 and "제목 일치" in sn[0] and "결정사항" in sn[0] and "논의내용" in sn[1] and "참석자" not in sn[1] and "안건" in sn[2], S + f"일치 위치 한 줄: {sn}")
        pg.screenshot(path=f"{SHOTS}/msearch_{size}.png")
        ov = pg.evaluate("document.documentElement.scrollWidth - window.innerWidth")
        ok(ov <= 1, S + f"가로 넘침 없음 ({ov}px)")

        search(pg, "아이리스 비전"); ok(cards(pg).count() == 1, S + "여러 단어는 모두 포함된 것만(AND)")
        search(pg, "아이리스 하이퍼토큰")
        ok(cards(pg).count() == 0 and "검색 결과가 없습니다" in pg.inner_text("#meetingList"), S + "원문에만 있는 단어는 기본으로는 안 찾음")
        search(pg, "하이퍼토큰"); ok(cards(pg).count() == 0, S + "원문 끔: 0건")
        pg.check("#msRaw"); pg.wait_for_timeout(300)
        ok(cards(pg).count() == 1 and "음성 원문" in pg.inner_text("#meetingList .sx-snip"), S + "원문 켜면 찾음 + 일치 위치에 '음성 원문' 표시")
        pg.uncheck("#msRaw"); pg.wait_for_timeout(300)

        search(pg, "아 이 리 스"); ok(cards(pg).count() == 3, S + "띄어쓰기 차이 무시")
        search(pg, "pmac"); ok(sorted(titles(pg)) == sorted(["PMAC 설계 리뷰", "파맥 통신 점검"]), S + f"대소문자 무시 + 용어 사전(PMAC↔파맥): {titles(pg)}")
        search(pg, "파맥"); ok(cards(pg).count() == 2, S + "틀린 표기로 검색해도 올바른 표기 기록까지")

        # 프로젝트 필터
        search(pg, "")
        opts = pg.locator("#msProj option").all_inner_texts()
        ok(opts[0] == "프로젝트: 전체" and "프로젝트 미지정" in opts and "A라인 설비 개조" in opts and "B라인 신규 설비" in opts, S + f"프로젝트 선택지: {opts}")
        pg.select_option("#msProj", "A라인 설비 개조"); pg.wait_for_timeout(300)
        ok(cards(pg).count() == 2 and "검색 결과 2건 / 전체 6건" in pg.inner_text("#msCount"), S + "프로젝트 필터만으로도 걸러짐")
        search(pg, "아이리스"); ok(cards(pg).count() == 1, S + "프로젝트 + 검색어 함께")
        pg.select_option("#msProj", "__none__"); pg.wait_for_timeout(300)
        ok(cards(pg).count() == 1 and "월간" in titles(pg)[0], S + "프로젝트 미지정 + '아이리스'")
        search(pg, "")
        ok(cards(pg).count() == 2, S + "미지정 기록 2건")
        pg.select_option("#msProj", ""); pg.wait_for_timeout(300)
        ok(cards(pg).count() == 6, S + "전체로 되돌림")

        # 지우기 버튼
        search(pg, "아이리스"); ok(pg.locator("#msqClear").is_visible(), S + "입력하면 ✕ 표시")
        pg.click("#msqClear"); pg.wait_for_timeout(300)
        ok(pg.input_value("#msq") == "" and cards(pg).count() == 6 and pg.locator("#msqClear").is_hidden(), S + "✕로 지우면 전체 목록")

        # 안전성: HTML 글자는 그대로 보임, 정규식 기호도 안전
        pg.fill("#msq", ""); pg.wait_for_timeout(200)
        ok(pg.locator("#meetingList .mtitle b").count() == 0 and any("<b>태그</b>" in t for t in titles(pg)), S + "제목의 HTML 태그는 글자 그대로 표시")
        search(pg, "태그"); ok(cards(pg).count() == 1 and pg.locator("#meetingList .mtitle b").count() == 0, S + "태그 글자 검색·강조도 안전")
        search(pg, "(a[*"); ok(cards(pg).count() == 0, S + "정규식 특수문자를 넣어도 오류 없이 0건")

        # 펼친 본문에서도 강조
        search(pg, "아이리스")
        pg.locator("#meetingList li.meeting summary").first.click(); pg.wait_for_timeout(300)
        ok(pg.locator("#meetingList li.meeting details[open] .mbody mark").count() >= 1, S + "카드를 펼치면 본문에서도 강조")
        ok(not errs, S + f"자바스크립트 오류 없음 {errs}")
        br.close()
finish()
