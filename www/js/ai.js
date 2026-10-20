/* Gemini 직접 호출(서버 없음). 각자의 API 키를 설정에 저장해 쓰고, 호출 기록은 앱 안에 남긴다.
 * 서버 버전(main.py)의 프롬프트·재시도·후처리를 옮기되, 개인/회사 문구는 설정의 "직무 설명"으로 일반화했다. */
(function () {
  "use strict";
  var TEXT_MODELS = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.5-flash"];
  var AUDIO_MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"];
  var cfg = {
    base: "https://generativelanguage.googleapis.com/v1beta",
    uploadBase: "https://generativelanguage.googleapis.com/upload/v1beta",
    retries: 3, timeoutMs: 45000, audioTimeoutMs: 180000,
    inlineLimit: 12 * 1024 * 1024,
    sleep: function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); },
  };

  function AppError(code, message, status) { var e = new Error(message); e.code = code; e.status = status || 0; return e; }

  // ---------- 날짜/문자 유틸 ----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoDate(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return isoDate(new Date()); }
  var WD = "월화수목금토일";
  function weekdayKo(d) { return WD[(d.getDay() + 6) % 7]; }
  function normName(n) { return String(n || "").replace(/\s+/g, "").toLowerCase(); }
  function normTime(v) {
    var m = /^([01]?\d|2[0-3]):([0-5]?\d)$/.exec(String(v == null ? "" : v).trim());
    return m ? pad(+m[1]) + ":" + pad(+m[2]) : "";
  }
  function isValidDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return false;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
  }

  // ---------- 용어 사전 ----------
  function vocabList() { return window.DB.all("vocab").slice().sort(function (a, b) { return (a.created || "") < (b.created || "") ? -1 : 1; }); }
  function vocabTerms() {
    var seen = {}, out = [];
    vocabList().forEach(function (v) { var r = (v.right || "").trim(); if (r && !seen[r]) { seen[r] = 1; out.push(r); } });
    return out;
  }
  function applyVocab(text) {
    var rules = vocabList().filter(function (v) { return (v.wrong || "").trim(); }).map(function (v) { return [v.wrong.trim(), v.right]; });
    rules.sort(function (a, b) { return b[0].length - a[0].length; });
    rules.forEach(function (r) { text = String(text).split(r[0]).join(r[1]); });
    return text;
  }
  function applyVocabDeep(o) {
    if (typeof o === "string") return applyVocab(o);
    if (Array.isArray(o)) return o.map(applyVocabDeep);
    if (o && typeof o === "object") { var out = {}; Object.keys(o).forEach(function (k) { out[k] = applyVocabDeep(o[k]); }); return out; }
    return o;
  }

  // ---------- 변환 결과 정리(반복·잡음 조각 폐기) ----------
  function cleanTranscript(text) {
    text = String(text || "").trim();
    var tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length >= 6) {
      var cnt = {}, top = 0;
      tokens.forEach(function (t) { cnt[t] = (cnt[t] || 0) + 1; if (cnt[t] > top) top = cnt[t]; });
      if (top >= 6 && top / tokens.length >= 0.6) return "";
    }
    var ko = (text.match(/[가-힣]/g) || []).length;
    var other = (text.match(/[A-Za-zЀ-ӿ一-鿿぀-ヿ]/g) || []).length;
    if (ko + other >= 12 && ko / (ko + other) < 0.15) return "";
    var out = [], run = 0, prev = null;
    tokens.forEach(function (t) { run = (t === prev) ? run + 1 : 1; prev = t; if (run <= 3) out.push(t); });
    return out.join(" ").replace(/(\S)\1{7,}/g, "$1");
  }

  // ---------- 사용량 기록 ----------
  async function logUsage(model, status, usage, purpose) {
    try {
      var u = usage || {};
      await window.DB.put("usage", { id: window.DB.uid(), t: Date.now(), model: model, status: status,
        pt: u.promptTokenCount || 0, ot: u.candidatesTokenCount || 0, tt: u.totalTokenCount || 0, purpose: purpose || "" });
    } catch (e) { /* 기록 실패가 본 기능을 막지 않게 */ }
  }

  // ---------- Gemini 호출(모델 순서·재시도) ----------
  async function generate(parts, o) {
    o = o || {};
    var key = window.Settings.get("apiKey");
    if (!key) throw AppError("NO_KEY", "Gemini API 키가 설정되지 않았습니다. 설정에서 키를 입력해 주세요.");
    var models = o.models || TEXT_MODELS, retries = o.retries || cfg.retries;
    var lastErr = "", lastCode = "FAILED", lastStatus = 0;
    for (var mi = 0; mi < models.length; mi++) {
      var model = models[mi];
      var payload = { contents: [{ parts: parts }], generationConfig: {} };
      if (o.jsonMode) payload.generationConfig.responseMimeType = "application/json";
      if (o.temperature != null) payload.generationConfig.temperature = o.temperature;
      for (var attempt = 1; attempt <= retries; attempt++) {
        var ctrl = new AbortController(), timer = setTimeout(function () { ctrl.abort(); }, o.timeoutMs || cfg.timeoutMs), res;
        try {
          res = await fetch(cfg.base + "/models/" + model + ":generateContent", {
            method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify(payload), signal: ctrl.signal });
        } catch (e) {
          clearTimeout(timer);
          lastErr = model + " 시도" + attempt + ": " + (e && e.name === "AbortError" ? "시간 초과" : "연결 실패");
          lastCode = "NETWORK"; lastStatus = 0;
          await logUsage(model, 0, null, o.purpose);
          await cfg.sleep(1500 * attempt);
          continue;
        }
        clearTimeout(timer);
        var raw = await res.text(), data = null;
        try { data = JSON.parse(raw); } catch (e) { /* 본문이 JSON이 아닐 수 있음 */ }
        await logUsage(model, res.status, res.status === 200 && data ? data.usageMetadata : null, o.purpose);
        if (res.status === 503 || res.status === 429) {
          lastErr = model + " 시도" + attempt + ": HTTP " + res.status + (res.status === 429 ? " (요청이 많거나 한도 초과)" : " (일시적 과부하)");
          lastCode = res.status === 429 ? "QUOTA" : "BUSY"; lastStatus = res.status;
          await cfg.sleep(1500 * attempt);
          continue;
        }
        if ((res.status === 400 || res.status === 401 || res.status === 403) && /API key|API_KEY|apiKey/i.test(raw)) {
          throw AppError("BAD_KEY", "Gemini API 키가 올바르지 않습니다. 설정에서 다시 확인해 주세요.", res.status);
        }
        if (res.status !== 200) {
          lastErr = model + ": HTTP " + res.status + " " + raw.slice(0, 160); lastCode = "HTTP"; lastStatus = res.status;
          break;   // 재시도해도 안 될 오류는 다음 모델로
        }
        try {
          var text = data.candidates[0].content.parts.map(function (p) { return p.text || ""; }).join("");
          if (!text.trim()) throw new Error("empty");
          return { text: text, model: model };
        } catch (e) {
          lastErr = model + ": 응답이 비어 있거나 해석할 수 없음"; lastCode = "PARSE";
          break;
        }
      }
    }
    var msg = lastCode === "NETWORK" ? "인터넷 연결을 확인해 주세요."
      : lastCode === "QUOTA" ? "요청이 너무 많거나 오늘 무료 사용 한도를 넘었습니다. 잠시 후 다시 시도해 주세요."
      : "AI 처리에 실패했습니다. (" + lastErr + ")";
    throw AppError(lastCode, msg, lastStatus);
  }

  async function callJson(prompt, purpose) {
    var r = await generate([{ text: prompt }], { jsonMode: true, purpose: purpose });
    var t = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try { return JSON.parse(t); } catch (e) { throw AppError("PARSE", "AI 응답을 해석하지 못했습니다. 다시 시도해 주세요."); }
  }

  async function testKey(key) {
    var prev = window.Settings.get("apiKey");
    await window.Settings.set("apiKey", key);
    try { await generate([{ text: "OK 라고만 답하세요." }], { models: [TEXT_MODELS[0]], retries: 1, purpose: "키 확인" }); return true; }
    catch (e) { if (prev) await window.Settings.set("apiKey", prev); else await window.Settings.remove("apiKey"); throw e; }
  }

  // ---------- 프롬프트(직무 설명을 설정에서 가져옴) ----------
  function who() { var p = (window.Settings.get("profile") || "").trim(); return p || "업무를 하는 직장인"; }
  function projectRules() {
    return "프로젝트 기준: 하나의 과제/업무 건 단위(예: 'A라인 설비 개조', '신규 장비 발주'처럼 대상과 일을 함께 담은 이름). "
      + "가능하면 기존 프로젝트 이름을 그대로 재사용하고, 어느 것에도 맞지 않을 때만 짧고 구체적인 새 이름을 만드세요. "
      + "성격이 다른 일반 회의/잡담은 '기타'로 분류하세요.\n";
  }

  // "김OO, 이OO" 같은 입력을 이름 목록으로(쉼표·가운뎃점·세미콜론·줄바꿈 구분, 중복 제거)
  function parsePeople(v) {
    var list = Array.isArray(v) ? v : String(v || "").split(/[,，、;\n·]+/), seen = {}, out = [];
    list.forEach(function (x) { x = String(x).trim(); var k = normName(x); if (x && !seen[k]) { seen[k] = 1; out.push(x.slice(0, 40)); } });
    return out.slice(0, 40);
  }

  function buildStructurePrompt(raw, names, title, notes, people) {
    var terms = vocabTerms();
    var glossary = terms.length ? "이 회의에서 쓰이는 전문 용어(표기를 정확히 이 형태로 쓰세요): " + terms.join(", ") + "\n" : "";
    people = people || [];
    var peopleHint = people.length ? "참석자는 사용자가 이미 입력했습니다: " + people.join(", ") + ". participants에는 이 사람들을 모두 포함하고, 글에 다른 참석자가 분명히 나오면 추가하세요. 이 이름들의 표기를 정확히 이 형태로 쓰고, 음성 인식 오류로 비슷하게 잘못 적힌 이름은 이 표기로 바로잡으세요.\n" : "";
    var titleHint = title ? "회의명은 사용자가 '" + title + "'(으)로 정했습니다. title에는 이 값을 그대로 쓰고, 이 이름을 참고해 내용을 해석하세요.\n" : "";
    var both = !!(notes && raw);
    var input = both ? "[음성 변환 원문]\n\"\"\"\n" + raw + "\n\"\"\"\n\n[직접 메모]\n\"\"\"\n" + notes + "\n\"\"\"\n\n"
      : notes ? "[직접 메모]\n\"\"\"\n" + notes + "\n\"\"\"\n\n"
      : "메모:\n\"\"\"\n" + raw + "\n\"\"\"\n\n";
    return glossary + titleHint + peopleHint
      + "다음은 " + who() + "가 회사 회의에서 두서없이 적었거나 음성 인식으로 받아적은 메모입니다. 이 메모를 분석해서 정리된 회의록을 JSON으로 만들어주세요. "
      + "메모에 없는 내용은 지어내지 말고, 모르는 항목은 빈 값으로 두세요.\n"
      + (both ? "입력은 두 가지입니다. [음성 변환 원문]은 음성 인식 결과라 오인식·누락이 있을 수 있고, [직접 메모]는 사용자가 직접 적은 정확한 내용입니다. "
          + "두 내용이 다르거나 충돌하면 [직접 메모]를 우선하고, [직접 메모]의 결정사항·담당자·날짜·수치는 빠짐없이 반영하세요. "
          + "[직접 메모]에만 있는 내용도 회의록에 포함하세요.\n" : "")
      + "문체 규칙: discussion(논의내용)은 존댓말이나 서술형 문장('~했습니다', '~하였다', '~논의하였다')으로 쓰지 말고, "
      + "회사 보고서의 개조식으로 짧게 끊어 쓰세요. 명사형/상태형으로 종결하고 항목마다 줄바꿈하세요. "
      + "예: '설비 센서 오동작 발생 중', '일정 재조정 필요', '부품 납기 지연 우려', '다음 주 중 원인 분석 예정'. "
      + "누가 말했는지 같은 진행 서술은 빼고 상황·문제·원인·조치만 남기세요. decisions/agenda/액션아이템 텍스트도 같은 개조식으로 간결하게 쓰세요.\n"
      + projectRules()
      + (names.length ? "기존 프로젝트: " + JSON.stringify(names) + "\n" : "기존 프로젝트: 없음\n")
      + "summary는 이 회의/메모를 한 줄(40자 내외)로 요약한 개조식 문구입니다.\n\n"
      + input
      + '다음 정확한 JSON 형식으로만 답하세요: {"title": "회의 제목", "participants": ["참석자"], "agenda": ["안건"], '
      + '"discussion": "논의 내용을 개조식 단문으로, 항목마다 줄바꿈(\\n)으로 구분", "decisions": ["결정사항"], '
      + '"actionItems": [{"text": "할 일", "owner": "담당자 또는 빈 문자열", "due": "YYYY-MM-DD 또는 빈 문자열"}], '
      + '"project": "프로젝트명", "summary": "한 줄 요약"}';
  }

  function buildParsePrompt(text, now) {
    var terms = vocabTerms();
    return "오늘은 " + isoDate(now) + " (" + weekdayKo(now) + "요일)입니다.\n"
      + "다음은 업무 할일을 두서없이 적은 글입니다. 각 할일의 항목명, 납기일, 시간, 장소를 뽑아 JSON으로 답하세요.\n"
      + "- 항목명: 날짜·기한 표현은 빼고 핵심 업무만 간결한 개조식(명사형)으로. 글에 없는 내용은 지어내지 마세요.\n"
      + "- 납기일: 글에 기한이 있으면 YYYY-MM-DD, 없으면 빈 문자열. '내일', '이번주 금요일', '다음주 수요일', '10/4', '월말' 같은 상대·약식 표현은 오늘 기준으로 계산하세요. 연도가 없으면 오늘 이후 가장 가까운 날짜입니다.\n"
      + "- 시간: 글에 시각이 있으면 24시간제 HH:MM(오후 3시 → 15:00, 오전 10시 30분 → 10:30, 저녁 7시 → 19:00), 없으면 빈 문자열. 시간만 있고 날짜가 없으면 납기일은 오늘입니다.\n"
      + "- 장소: 그 일이 열리거나 진행되는 곳(회의실·층·건물·사무실·현장·화상회의 등)이 글에 있으면 짧게(예: '3층 대회의실', '본관 2층 소회의실', '화상(Teams)'), 없으면 빈 문자열. "
      + "장소 표현은 항목명에서 빼세요. 설비·라인·프로젝트 이름(A라인, 장비명 등)은 장소가 아닙니다. 글에 없는 장소를 지어내지 마세요.\n"
      + "  예) '내일 오후 3시 3층 대회의실에서 A라인 개조 킥오프 회의 소집' → 항목명 'A라인 개조 킥오프 회의 소집', 시간 15:00, 장소 '3층 대회의실'.\n"
      + "  예) 'A라인 설비 파라미터 검토' → 장소 없음(빈 문자열).\n"
      + "- 할일이 여러 개 섞여 있으면 각각 분리하세요.\n"
      + (terms.length ? "전문 용어(표기를 이대로): " + terms.join(", ") + "\n" : "")
      + '\n글:\n"""\n' + applyVocab(text) + '\n"""\n\n'
      + '정확히 다음 JSON으로만 답하세요: {"tasks": [{"title": "항목명", "due": "YYYY-MM-DD 또는 빈 문자열", "time": "HH:MM 또는 빈 문자열", "location": "장소 또는 빈 문자열"}]}';
  }

  async function parseTasks(text) {
    var now = new Date();
    var out = await callJson(buildParsePrompt(text, now), "할일 입력");
    var tasks = [];
    (out.tasks || []).slice(0, 10).forEach(function (x) {
      var title = applyVocab(String(x.title || "").trim());
      var due = String(x.due || "").trim(); if (!isValidDate(due)) due = "";
      var tm = normTime(x.time); if (tm && !due) due = isoDate(now);
      var loc = applyVocab(String(x.location || "").trim()).slice(0, 60);
      if (title) tasks.push({ title: title.slice(0, 200), due: due, time: tm, location: loc });
    });
    return { tasks: tasks };
  }

  async function structureMeeting(body, names) {
    var people = parsePeople(body.participants);
    var data = applyVocabDeep(await callJson(buildStructurePrompt(applyVocab((body.raw || "").trim()), names, (body.title || "").trim(), (body.notes || "").trim(), people), "회의록 정리"));
    if ((body.title || "").trim()) data.title = body.title.trim();
    // 참석자: 사용자가 입력한 이름을 앞에 두고, AI가 글에서 더 찾은 이름을 뒤에 붙인다(중복 제거). 미리보기에서 고칠 수 있다.
    data.participants = parsePeople(people.concat(Array.isArray(data.participants) ? data.participants : []));
    var proj = String(data.project || "").trim();
    for (var i = 0; i < names.length; i++) if (normName(names[i]) === normName(proj)) { proj = names[i]; break; }
    data.project = proj; data.projectIsNew = !!proj && names.indexOf(proj) < 0;
    return data;
  }

  async function classifyTasks(items, names) {
    var prompt = "다음은 " + who() + "의 할일 목록입니다. 각 할일이 어떤 '프로젝트'에 속하는지 분류하세요.\n" + projectRules()
      + "어느 프로젝트에도 속하지 않는 일반 업무/개인 일정이면 project를 빈 문자열로 두세요. category는 사용자가 붙인 임시 분류이니 참고만 하세요.\n"
      + (names.length ? "기존 프로젝트: " + JSON.stringify(names) + "\n" : "기존 프로젝트: 없음\n")
      + "할일: " + JSON.stringify(items) + "\n\n"
      + '정확히 다음 JSON으로만 답하세요: {"items": [{"id": "할일 id", "project": "프로젝트명 또는 빈 문자열"}]}';
    var out = await callJson(prompt, "할일 배치"), ids = {}, props = [];
    items.forEach(function (it) { ids[it.id] = 1; });
    (out.items || []).forEach(function (x) {
      var name = String(x.project || "").trim();
      if (ids[x.id] && name && name !== "기타") {
        for (var i = 0; i < names.length; i++) if (normName(names[i]) === normName(name)) { name = names[i]; break; }
        props.push({ id: x.id, project: name });
      }
    });
    return { proposals: props };
  }

  async function classifyMeetings(items, names) {
    var prompt = "다음은 " + who() + "의 회의록 목록입니다. 각 회의록이 어떤 '프로젝트'에 속하는지 분류하세요.\n" + projectRules()
      + (names.length ? "기존 프로젝트: " + JSON.stringify(names) + "\n" : "기존 프로젝트: 없음\n")
      + "회의록: " + JSON.stringify(items) + "\n\n"
      + '정확히 다음 JSON으로만 답하세요: {"items": [{"id": "회의록 id", "project": "프로젝트명"}]}';
    var out = await callJson(prompt, "회의 배치"), ids = {};
    items.forEach(function (it) { ids[it.id] = 1; });
    return { proposals: (out.items || []).filter(function (x) { var n = String(x.project || "").trim(); return ids[x.id] && n && n !== "기타"; })
      .map(function (x) { return { id: x.id, project: String(x.project).trim() }; }) };
  }

  // ---------- 음성 받아쓰기(Gemini 오디오) ----------
  function blobToBase64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(String(fr.result).split(",")[1] || ""); };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(blob);
    });
  }

  function transcribePrompt() {
    var terms = vocabTerms();
    return "다음은 회의 녹음입니다. 한국어로 말한 내용을 들리는 그대로 받아쓰세요. "
      + "요약·설명·번역·화자 표시·시간 표시 없이 받아쓴 글만 출력하세요. 문장 부호는 자연스럽게 넣으세요. "
      + "잡음이나 침묵 구간에서 없는 말을 만들어내지 말고, 알아들을 수 없는 부분은 건너뛰세요. 말이 전혀 없으면 아무것도 출력하지 마세요."
      + (terms.length ? "\n이 회의에서 쓰이는 용어(들리면 이 표기로): " + terms.join(", ") : "");
  }

  async function uploadFile(blob, mime, key) {
    var start = await fetch(cfg.uploadBase + "/files", { method: "POST", headers: {
      "x-goog-api-key": key, "X-Goog-Upload-Protocol": "resumable", "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(blob.size), "X-Goog-Upload-Header-Content-Type": mime, "Content-Type": "application/json" },
      body: JSON.stringify({ file: { display_name: "meeting-audio" } }) });
    var url = start.headers.get("x-goog-upload-url");
    if (!start.ok || !url) throw AppError("UPLOAD", "녹음 파일 업로드를 시작하지 못했습니다. (HTTP " + start.status + ")", start.status);
    var up = await fetch(url, { method: "POST", headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: blob });
    var info = await up.json();
    if (!up.ok || !info.file) throw AppError("UPLOAD", "녹음 파일 업로드에 실패했습니다. (HTTP " + up.status + ")", up.status);
    var f = info.file;
    for (var i = 0; i < 60 && f.state === "PROCESSING"; i++) {
      await cfg.sleep(2000);
      var r = await fetch(cfg.base + "/" + f.name, { headers: { "x-goog-api-key": key } });
      f = await r.json();
    }
    if (f.state !== "ACTIVE") throw AppError("UPLOAD", "업로드한 녹음 파일을 처리하지 못했습니다.");
    return f;
  }

  async function transcribe(blob, mime) {
    mime = mime || blob.type || "audio/aac";
    var key = window.Settings.get("apiKey");
    if (!key) throw AppError("NO_KEY", "Gemini API 키가 설정되지 않았습니다. 설정에서 키를 입력해 주세요.");
    var parts, uploaded = null;
    if (blob.size <= cfg.inlineLimit) {
      parts = [{ text: transcribePrompt() }, { inline_data: { mime_type: mime, data: await blobToBase64(blob) } }];
    } else {
      uploaded = await uploadFile(blob, mime, key);
      parts = [{ text: transcribePrompt() }, { file_data: { mime_type: mime, file_uri: uploaded.uri } }];
    }
    try {
      var r = await generate(parts, { models: AUDIO_MODELS, temperature: 0, timeoutMs: cfg.audioTimeoutMs, purpose: "음성 받아쓰기" });
      var text = r.text.trim().replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").replace(/^\(.*?\)$/gm, "").trim();
      return applyVocab(cleanTranscript(text));
    } finally {
      if (uploaded) { try { await fetch(cfg.base + "/" + uploaded.name, { method: "DELETE", headers: { "x-goog-api-key": key } }); } catch (e) { /* 정리 실패는 무시(48시간 뒤 자동 삭제) */ } }
    }
  }

  window.AI = {
    cfg: cfg, TEXT_MODELS: TEXT_MODELS, AUDIO_MODELS: AUDIO_MODELS, AppError: AppError,
    normName: normName, normTime: normTime, isValidDate: isValidDate, isoDate: isoDate, today: today,
    applyVocab: applyVocab, cleanTranscript: cleanTranscript, generate: generate, testKey: testKey,
    parseTasks: parseTasks, structureMeeting: structureMeeting, classifyTasks: classifyTasks, classifyMeetings: classifyMeetings,
    transcribe: transcribe, buildStructurePrompt: buildStructurePrompt, buildParsePrompt: buildParsePrompt,
  };
})();
