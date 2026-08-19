"use strict";

/* 보이스피싱 대응 안내 MVP — 프론트엔드.
 서버 쪽 분류 로직과 동일한 정적 문구만 여기서도 하드코딩한다(기능 명세 4-3절
   범위 — 별도 콘텐츠 API는 스펙에 없다). 사용자 입력은 전부 textContent로만
   넣는다(innerHTML에 사용자 입력을 넣지 않는다 — XSS 방지).
*/

const MAX_EXPLAIN_LEN = 2000;
// (정적 배포본에는 fetch 가 없어 FETCH_TIMEOUT_MS 를 뺐다 — 쓰지 않는 상수를
//  남겨두면 "네트워크 호출이 어딘가 있다"는 오해를 만든다.)

// 2026-08-12 외부 검토 반영: 비저장 사실 고지 추가(서버는 입력을 저장하지 않는다 —
// 서버 원본 비저장 원칙과 일치). 문구는 분류 로직 원본의 같은 상수과 동일 유지.
const INPUT_WARNING_TEXT =
  "이름·계좌번호·주민등록번호 등 개인정보를 입력하지 마세요. 입력 내용은 저장되지 않습니다.";

// 연결 실패·서버 오류 시 공통으로 붙이는 대체 행동 안내(외부 검토 반영, 경로8 —
// "잠시 후 다시 시도"만으로는 공포 상태의 사용자가 대체 행동을 얻지 못한다).
const EMERGENCY_FALLBACK_TEXT =
  "이 안내를 기다리지 마시고, 급하면 지금 바로 112(경찰)·1332(금감원)에 전화하십시오. 돈을 보내기 전이라면 송금을 멈추십시오.";

// 2026-08-13 외부 검토 2차 안전 수리: 텍스트 분석(explain) 결과 화면 최상단에 항상
// 고정한다. 종전에는 매칭 0건일 때만 안내가 떠서, 위험 신호가 잡힌 경우
// "이미 보냈다면 지금 신고" 안내를 아예 못 보는 사용자가 생겼다.
const ALREADY_SENT_TOP_TEXT =
  "이미 돈을 보내셨거나 현금·상품권 번호(PIN)·가상자산으로 건네셨다면, 이 설명을 읽고 계실 때가 아닙니다. 지금 바로 112(경찰)·1332(금융감독원)에 전화하십시오.";

const CONTACTS = [
  { name: "경찰", value: "112", type: "tel" },
  { name: "금융감독원", value: "1332", type: "tel" },
  { name: "경찰청 통합대응단", value: "1394", type: "tel" },
  { name: "개인정보노출자 사고예방시스템", value: "pd.fss.or.kr", type: "url", url: "https://pd.fss.or.kr" },
  { name: "계좌정보통합관리", value: "payinfo.or.kr", type: "url", url: "https://payinfo.or.kr" },
  { name: "명의도용방지", value: "msafer.or.kr", type: "url", url: "https://msafer.or.kr" },
];

// 고정 질문(기능 명세 1절). 서버 API 필드명(q1~q4)과 값(예/아니오/모름 등) 일치.
// 2026-08-12 외부 검토 반영: 송금 여부(q2)를 첫 질문으로 올리고, 송금="예"면
// q3(정보 입력)를 건너뛴다(분기에 쓰이지 않음 — 분류 로직 원본 참조).
const QUESTIONS_BY_FIELD = {
  q1: {
    field: "q1",
    text: "낯선 앱을 설치했거나, 화면을 다른 사람이 조종하는 느낌을 받은 적이 있습니까?",
    options: ["예", "아니오", "모름"],
    optionLabels: { "예": "예", "아니오": "아니오", "모름": "모르겠음" },
  },
 // 2026-08-13 외부 검토 2차 안전 수리: 계좌이체가 아닌 전달(현금·상품권 PIN·가상자산·
  // 가족 사칭으로 건넨 경우)을 고를 자리를 만든다. 종전 2지선다에서는 이들이
  // "아니오"를 눌러 B/C/D로 새어나갔다.
  q2: {
    field: "q2",
    text: "돈을 이미 보내셨습니까?",
    options: ["예", "현금등", "아니오"],
    optionLabels: {
      "예": "예, 계좌로 보냈습니다",
      "현금등": "현금·상품권·코인 등으로 전달했습니다",
      "아니오": "아니오, 아직 안 보냈습니다",
    },
  },
  q3: {
    field: "q3",
    text: "계좌번호·주민등록번호·인증번호 등을 알려주거나 입력한 적이 있습니까?",
    options: ["예", "아니오", "모름"],
    optionLabels: { "예": "예", "아니오": "아니오", "모름": "모르겠음" },
  },
  q4: {
    field: "q4",
    text: "이 일이 언제 있었습니까?",
    options: ["방금", "이전"],
    optionLabels: { "방금": "방금 / 오늘 안", "이전": "오늘 이전" },
  },
};

// 지금까지의 답을 보고 다음에 물을 질문 순서를 돌려준다.
function buildSequence(answers) {
  const seq = ["q2", "q1"];
  // q3는 q2="아니오"일 때만 분기에 쓰인다("예"·"현금등"은 모두 분류 A로 직행 —
 // 분류 로직 원본 참조). 2026-08-13 안전 수리로 "현금등"을 함께 제외.
  if (answers.q2 === "아니오") seq.push("q3");
  seq.push("q4");
  return seq;
}

const state = {
  answers: {},
  stepIndex: 0,
};

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
  }
  (children || []).forEach((child) => {
    if (child) node.appendChild(child);
  });
  return node;
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// ---------------------------------------------------------------------------
// 정적 배포본(2026-08-14, 지시 내부 개선 이력) — 서버 API 대신 로컬 계산
// ---------------------------------------------------------------------------
// 원본 mvp/ 는 파이썬 서버(서버 원본)의 /api/classify· /api/explain 을 fetch 로
// 불렀다. 이 정적 배포본에는 서버가 없다. 대신:
//· classify → data/classify_table.js 의 30조합 표(= 분류 로직 원본 를 실행해 굳힌 값)
//· explain → rules.js (= 규칙 원본 의 이식본)
// 두 경로 모두 mvp_static/verify_port.py 로 파이썬 원본과 완전일치 대조를 통과해야
// 한다. 화면 코드(아래 전부)는 손대지 않았다 — 응답을 만드는 곳만 바뀐다.
//
// 🚨 fetch 를 아예 지웠다. 이 페이지는 열린 뒤 어떤 네트워크 요청도 하지 않고,
//    입력한 문자는 브라우저 밖으로 한 글자도 나가지 않는다(서버·외부 CDN·분석
//    스크립트 0). 종전 fetch 실패 경로(EMERGENCY_FALLBACK_TEXT)는 그대로 남겨
//    둔다 — 스크립트 로드 실패 등으로 계산이 불가능하면 같은 대체 행동 안내가
//    나와야 하기 때문이다.
//
// 반환 형태는 종전 fetchJson 과 같다: { response: {ok, status}, data }.
// 호출부(fetchClassification·submitExplain)의 분기 코드를 바꾸지 않기 위함이다.
const ALLOWED_Q1 = ["예", "아니오", "모름"];
const ALLOWED_Q2 = ["예", "아니오", "현금등"];
const ALLOWED_Q3 = ["예", "아니오", "모름"];
const ALLOWED_Q4 = ["방금", "이전"];

function apiResponse(status, data) {
  return { response: { ok: status >= 200 && status < 300, status }, data };
}

function localClassify(body) {
 // 서버 원본의 입력 검증 와 같은 검증 순서·같은 생략 규칙(q3 는 q2="아니오"
  // 일 때만 요구)을 그대로 따른다.
  const q1 = body.q1;
  const q2 = body.q2;
  const q4 = body.q4;
  if (!ALLOWED_Q1.includes(q1)) return apiResponse(400, { error: "q1 값이 허용 목록에 없습니다" });
  if (!ALLOWED_Q2.includes(q2)) return apiResponse(400, { error: "q2 값이 허용 목록에 없습니다" });
  if (!ALLOWED_Q4.includes(q4)) return apiResponse(400, { error: "q4 값이 허용 목록에 없습니다" });
  let q3 = "";
  if (q2 === "아니오") {
    if (!ALLOWED_Q3.includes(body.q3)) {
      return apiResponse(400, { error: "q3 값이 허용 목록에 없습니다" });
    }
    q3 = body.q3;
  }
  const table = (typeof CLASSIFY_TABLE !== "undefined" && CLASSIFY_TABLE.table) || null;
  if (!table) throw new Error("classify_table.js 가 로드되지 않았습니다");
  const result = table[`${q1}|${q2}|${q3}|${q4}`];
  if (!result) throw new Error("classify 표에 해당 조합이 없습니다");
  return apiResponse(200, result);
}

function localExplain(body) {
  const text = body.text;
  if (typeof text !== "string" || text === "") {
    return apiResponse(400, { error: "'text' 필드가 없거나 문자열이 아닙니다" });
  }
  if (text.length > MAX_EXPLAIN_LEN) {
 // 문구는 서버 원본과 같게 유지한다 — 호출부가 "자를 넘었습니다"로 판별한다.
    return apiResponse(400, { error: `텍스트가 ${MAX_EXPLAIN_LEN}자를 넘었습니다` });
  }
  if (typeof explain !== "function") throw new Error("rules.js 가 로드되지 않았습니다");
  return apiResponse(200, explain(text));
}

// 종전 fetchJson 자리를 그대로 대체한다(호출부 시그니처 동일, async 유지).
async function localApi(url, options) {
  const body = JSON.parse(options.body);
  if (url === "/api/classify") return localClassify(body);
  if (url === "/api/explain") return localExplain(body);
  return apiResponse(404, { error: "Not Found" });
}

// 2026-08-13 동작 수리: url 분기가 link.url 을 읽고 있었으나 분류 로직 원본 의 단계별
// 링크 딕셔너리(_LINK_PD·_LINK_PAYINFO·_LINK_MSAFER)에는 url 키가 없고 value 만
// 있다 → href="undefined" 로 렌더돼 pd.fss·payinfo·msafer 버튼이 눌러도 아무 데도
// 가지 않았다(실측 anchors = tel:112, tel:1332, undefined ×3).
// 스키마를 value 하나로 통일한다(tel 은 tel: 스킴을 붙이고, url 은 value 가 이미
// 절대 URL이다). 하단 고정 연락처(CONTACTS)는 app.js 자체 배열이라 별개다.
// 2026-08-14 UI 재설계: 이모지(📞·🔗)를 텍스트 라벨로 바꿨다. 이모지는 OS·브라우저
// 마다 다르게 그려져 표기가 갈리고, 스크린리더가 "전화기" 같은 그림 이름을 읽어
// 버튼의 뜻이 흐려진다(가독성 판단). 외부 아이콘 라이브러리는 쓰지 않는다(CDN 금지).
function buildLinkButton(link) {
  if (link.type === "tel") {
    return el("a", { class: "step-link-btn", href: `tel:${link.value}`, text: `전화 ${link.label}` });
  }
  return el("a", {
    class: "step-link-btn",
    href: link.value,
    target: "_blank",
    rel: "noopener noreferrer",
    text: `사이트 ${link.label}`,
  });
}

// 2026-08-14 footer tel: 수리: 종전에는 감염 상태를 모르고 무조건
// tel:/url 링크를 렌더했다. 8/13 안전 수리는 결과 카드 안의 버튼만 막아서, 감염 의심
// (q1=예/모름) 화면에서도 하단 고정 칩은 눌렸다 — 감염 폰으로 전화를 걸 수 있는
// 구멍이었다. 판정 소스는 그 안전 수리와 동일하게 서버 응답 links_disabled 하나만 쓴다
// (renderClassificationResult 참조 — 새 판정 로직을 만들지 않는다).
// linksDisabled=true 면 같은 모양의 칩을 <span>(눌리지 않는 큰 글자)으로 렌더한다.
// 번호·주소 글자 크기·3열 그리드는 그대로다(다른 전화기로 읽어 걸 수 있어야 한다).
function renderContactsFooter(linksDisabled) {
  const footer = document.getElementById("contacts-footer");
  clearNode(footer);
  CONTACTS.forEach((contact) => {
    if (linksDisabled) {
      footer.appendChild(
        el("span", { class: "contact-chip contact-chip--textonly" }, [
          el("span", { text: contact.name }),
          el("strong", { text: contact.value }),
        ])
      );
      return;
    }
    const href = contact.type === "tel" ? `tel:${contact.value}` : contact.url;
    const chip = el("a", { class: "contact-chip", href }, [
      el("span", { text: contact.name }),
      el("strong", { text: contact.value }),
    ]);
    if (contact.type === "url") {
      chip.setAttribute("target", "_blank");
      chip.setAttribute("rel", "noopener noreferrer");
    }
    footer.appendChild(chip);
  });
  syncFooterSpacing();
}

// 2026-08-14 수리: 하단 고정 바가 본문 마지막 줄을 덮는 문제.
// 종전에는 CSS 로 #app { padding-bottom: 8.5rem }(=136px) 을 주고 있었고, 기본
// 글자 크기(100%)에서는 바 높이가 133px 라 3px 차이로 간신히 안 가려졌다.
// 그런데 바 높이는 rem 에 비례해 늘지 않는다(터치 최소 높이·칩 안쪽 여백이
// 따로 붙는다). 실측: 루트 글자 112.5% → 바 167px vs 여백 153px(14px 가림),
// 125% → 185 vs 170(15px), 150% → 221 vs 204(17px).
// 🚨 글자를 키워 쓰는 사람이 바로 이 서비스의 주 이용자층(고령)이다. 즉 가장
//    가려지면 안 되는 사용자에게서만 가려지고 있었다.
// 그래서 고정값을 쓰지 않고 **실제 바 높이를 재서** 본문 아래 여백으로 준다.
// 레이아웃만 바꾼다 — 판정·문구·링크 활성화 여부는 건드리지 않는다.
const FOOTER_CLEARANCE_PX = 24;

function syncFooterSpacing() {
  const footer = document.getElementById("contacts-footer");
  const app = document.getElementById("app");
  if (!footer || !app) return;
  const height = Math.ceil(footer.getBoundingClientRect().height);
  if (!height) return; // 아직 렌더 전이면 CSS 기본값을 그대로 둔다.
  app.style.paddingBottom = `${height + FOOTER_CLEARANCE_PX}px`;
}

// 바 높이는 화면 회전·창 크기·글자 크기 변경으로 바뀐다. 그때마다 다시 잰다.
function watchFooterSize() {
  const footer = document.getElementById("contacts-footer");
  if (!footer) return;
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(syncFooterSpacing).observe(footer);
  }
  window.addEventListener("resize", syncFooterSpacing);
  window.addEventListener("orientationchange", syncFooterSpacing);
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((section) => {
    section.classList.toggle("hidden", section.id !== id);
  });
  scrollToTop();
}

// 2026-08-14 UI 재설계(내부 검토 지적(최우선)): 화면을 갈아끼워도 스크롤 위치가
// 그대로였다. 결과가 길면 사용자가 카드 중간에서 시작하게 되고, 그러면 8/12·8/13
// 수리로 "카드보다 위"에 고정한 경고(감염 경고·현금등 안내·이미 보냈다면 신고)를
// 아예 못 보고 지나간다 — 안전장치가 화면에는 있는데 눈에는 안 닿는 상태였다.
// 애니메이션 없이(behavior 지정 없음 = instant) 맨 위로 올린다.
function scrollToTop() {
  try {
    window.scrollTo(0, 0);
  } catch (scrollError) {
    /* 스크롤 실패는 기능에 영향이 없으므로 무시한다 */
  }
}

// 붙여넣기(ⓑ) 화면은 결과가 입력창 "아래"에 붙는다. 여기서 페이지 맨 위로
// 올리면 오히려 결과에서 멀어진다(2026-08-14 실측으로 확인해 바로잡음) —
// 결과 블록의 첫머리로 보낸다. 첫머리에는 8/13 안전 수리 고정 안내가 있다.
function scrollNodeIntoView(node) {
  try {
    node.scrollIntoView(true);
  } catch (scrollError) {
    /* 스크롤 실패는 기능에 영향이 없으므로 무시한다 */
  }
}

// ---------------------------------------------------------------------------
// 흐름 ⓐ: Q1~Q4 → /api/classify
// ---------------------------------------------------------------------------

function startFlow() {
  state.answers = {};
  state.stepIndex = 0;
  document.getElementById("btn-flow-restart").classList.add("hidden");
  clearNode(document.getElementById("flow-result"));
 // 감염 의심 결과가 사라지는 지점 — footer를 정상(링크 있음)으로 원복.
  renderContactsFooter(false);
  showScreen("screen-flow");
  renderCurrentQuestion();
}

// "처음으로" 버튼: 진짜 첫 화면(screen-home, ⓐⓑ 재선택 가능)으로 복귀하며
// 내부 상태(답변·질문 인덱스)도 초기화한다. Q1 재시작이 아니다(사용성 검토 지적).
function goHome() {
  state.answers = {};
  state.stepIndex = 0;
  document.getElementById("btn-flow-restart").classList.add("hidden");
  clearNode(document.getElementById("flow-questions"));
  clearNode(document.getElementById("flow-result"));
 // 감염 의심 결과가 사라지는 지점 — footer를 정상(링크 있음)으로 원복.
  renderContactsFooter(false);
  showScreen("screen-home");
}

function renderCurrentQuestion() {
  const container = document.getElementById("flow-questions");
  clearNode(container);
  const sequence = buildSequence(state.answers);
  const field = sequence[state.stepIndex];
  if (!field) return;
  const question = QUESTIONS_BY_FIELD[field];

  const optionButtons = question.options.map((optionValue) => {
    const button = el("button", {
      type: "button",
      class: "option-btn",
      text: question.optionLabels[optionValue],
    });
    button.addEventListener("click", () => onAnswer(question.field, optionValue));
    return button;
  });

  // 2026-08-14 UI 재설계: 종전 제목은 `Q${stepIndex+1}. ...` 였다. 화면에 처음
  // 뜨는 질문은 내부 필드 q2(송금 여부)인데 라벨에는 "Q1."이 찍혀, SPEC·README의
  // Q번호(Q1=악성앱)와 어긋났다 — 그 표를 보고 답하면 다른 질문에 답하게 된다.
  // 번호 라벨을 없애고, 대신 "몇 개 중 몇 번째"만 보여준다(질문 문장 자체는
  // 고유하므로 대조에 지장이 없다). 당황한 사용자에게는 끝이 보이는 것이 중요하다.
  const total = sequence.length;
  const current = state.stepIndex + 1;
  const progress = el("div", { class: "progress" }, [
    el("span", { text: `질문 ${current} / ${total}` }),
    el("span", { class: "progress-track" }, [
      el("span", { class: "progress-fill", style: `width:${Math.round((current / total) * 100)}%` }),
    ]),
  ]);

  const children = [
    progress,
    el("h2", { text: question.text }),
    el("div", { class: "option-row" }, optionButtons),
  ];

 // 2026-08-12 외부 검토 반영: 잘못 누른 답을 고칠 수 있는 "이전 질문" 버튼.
  // 오답 1개가 교정 불가능한 잘못된 카드로 고정되는 것을 막는다.
  // 2026-08-14: 선택지 바로 밑에 붙어 오터치가 나기 쉬웠다 → 구분선·여백 추가
  // (back-btn 클래스). 기능은 그대로다.
  if (state.stepIndex > 0) {
    const backBtn = el("button", {
      type: "button",
      class: "link-btn back-btn",
      text: "← 이전 질문으로 (답 고치기)",
    });
    backBtn.addEventListener("click", goBackOneQuestion);
    children.push(backBtn);
  }

  container.appendChild(el("div", { class: "question-block" }, children));
}

function goBackOneQuestion() {
  if (state.stepIndex === 0) return;
  const sequence = buildSequence(state.answers);
  state.stepIndex -= 1;
  // 되돌아간 질문부터의 답은 지운다(뒤 질문 구성이 달라질 수 있다).
  for (let i = state.stepIndex; i < sequence.length; i += 1) {
    delete state.answers[sequence[i]];
  }
  renderCurrentQuestion();
}

function onAnswer(field, value) {
  state.answers[field] = value;
  state.stepIndex += 1;
  const sequence = buildSequence(state.answers);
  if (state.stepIndex < sequence.length) {
    renderCurrentQuestion();
    return;
  }
  clearNode(document.getElementById("flow-questions"));
  fetchClassification(state.answers);
}

async function fetchClassification(answers) {
  const resultBox = document.getElementById("flow-result");
  clearNode(resultBox);
  resultBox.appendChild(el("p", { class: "loading-note", text: "확인 중입니다..." }));

  let response;
  let data;
  try {
    ({ response, data } = await localApi("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(answers),
    }));
  } catch (fetchError) {
    clearNode(resultBox);
 // 2026-08-12 외부 검토 반영: 재시도 안내만 주지 않고 대체 행동을 준다.
    resultBox.appendChild(
      el("p", { class: "error-note", text: `서버에 연결할 수 없습니다. ${EMERGENCY_FALLBACK_TEXT}` })
    );
    document.getElementById("btn-flow-restart").classList.remove("hidden");
    return;
  }

  clearNode(resultBox);

  if (!response.ok) {
 // 2026-08-12 외부 검토 반영: 서버 내부 검증 문구를 피해자에게 그대로
    // 보여주지 않고, 행동 지시형 문구로 바꾼다.
    resultBox.appendChild(
      el("p", { class: "error-note", text: `요청을 처리하지 못했습니다. 처음부터 다시 시도해 주십시오. ${EMERGENCY_FALLBACK_TEXT}` })
    );
    document.getElementById("btn-flow-restart").classList.remove("hidden");
    return;
  }

  renderClassificationResult(resultBox, data);
  document.getElementById("btn-flow-restart").classList.remove("hidden");
}

function renderClassificationResult(container, classification) {
 // 2026-08-12 외부 검토 반영: 감염 의심 경고 등 notices를 카드보다 위에
  // 경고 스타일로 고정 표시한다.
  // (이력) 2026-08-14 UI 재설계에서 INFECTION_LINK_NOTE 하나에 2단계 위계를
  // 줬으나, 2026-08-19 사장 결정(8/16 "전부한줄경고로복귀")으로 되돌렸다 —
  // 아래 notices 렌더 참조. 앞머리 이모지(🚨) 제거는 그대로 유지(공지 문구 불변).
 // 2026-08-14 footer tel: 수리: 감염 의심 결과가 표시되는 동안에는 하단
 // 고정 연락처 칩도 눌리지 않는 큰 글자로 바꾼다. 판정 소스 = 아래 안전 수리와 같은
  // links_disabled 하나다. 비감염 결과면 false 가 넘어가 정상 칩이 복원된다.
  renderContactsFooter(Boolean(classification.links_disabled));

  // 🚨 2026-08-19 경고 위계 복귀(사장 결정 8/16 "전부한줄경고로복귀"):
  // 8/14에 INFECTION_LINK_NOTE 하나를 2단계(notice-banner--sub)로 내렸던 것을
  // 되돌린다. 모든 경고는 같은 1단계(채운 빨강) 한 단계다. 문구·개수·순서는
  // 서버(분류 로직 원본)가 준 그대로 — 하나도 빼지 않는다.
  const notices = classification.notices || [];
  notices.forEach((noticeText) => {
    container.appendChild(el("p", { class: "notice-banner", text: noticeText }));
  });

  const stepItems = classification.steps.map((step, index) => {
    const links = (step.links || []).map(buildLinkButton);
 // 2026-08-13 외부 검토 2차 안전 수리: 감염 의심(q1=예/모름) 응답에서는 서버가
    // links를 비우고 link_texts(누를 수 없는 글자)를 준다. 감염 의심 폰으로
    // 전화·사이트 접속을 누르지 못하게 하되 번호는 크게 읽히도록 표시한다.
    const linkTexts = (step.link_texts || []).map((linkText) =>
      el("div", { class: "step-link-text", text: linkText })
    );
    // 2026-08-14: 번호를 원형 배지로 빼고 본문을 별도 블록(step-body)에 담는다.
    // 종전에는 "1." 과 본문이 같은 인라인 흐름이라 통짜 문단으로 읽혔다.
    const body = el("div", { class: "step-body" }, [
      el("span", { text: step.text }),
      links.length ? el("div", { class: "step-links" }, links) : null,
      linkTexts.length ? el("div", { class: "step-link-texts" }, linkTexts) : null,
    ]);
    return el("li", { class: "step-item" }, [
      el("span", { class: "step-number", text: `${index + 1}` }),
      body,
    ]);
  });

  const cardChildren = [
    el("h2", { text: classification.title }),
    el("ol", { class: "step-list" }, stepItems),
  ];

 // 외부 검토 반영: 시간 안내·지급수단 주의를 카드 안에 표시.
  (classification.cautions || []).forEach((cautionText) => {
    cardChildren.push(el("p", { class: "caution-note", text: cautionText }));
  });

  cardChildren.push(
    el("p", { class: "source-note", text: `출처: ${classification.source_note}` })
  );

  container.appendChild(el("div", { class: "result-card" }, cardChildren));
  // 카드보다 위에 고정한 경고를 사용자가 실제로 보게 한다(위 scrollToTop 주석).
  scrollToTop();
}

// ---------------------------------------------------------------------------
// 흐름 ⓑ: 텍스트 붙여넣기 → /api/explain
// ---------------------------------------------------------------------------

function startExplain() {
 // 붙여넣기 화면에는 감염 판정 결과가 없다 — footer를 정상으로 원복.
  renderContactsFooter(false);
  showScreen("screen-explain");
  document.getElementById("input-warning").textContent = INPUT_WARNING_TEXT;
  clearNode(document.getElementById("explain-result"));
}

function updateCharCount() {
  const textarea = document.getElementById("explain-textarea");
  document.getElementById("explain-char-count").textContent = String(textarea.value.length);
}

async function submitExplain() {
  const textarea = document.getElementById("explain-textarea");
  const text = textarea.value;
  const resultBox = document.getElementById("explain-result");
  clearNode(resultBox);

  if (text.trim() === "") {
    resultBox.appendChild(el("p", { class: "error-note", text: "내용을 입력해 주세요." }));
    return;
  }
  if (text.length > MAX_EXPLAIN_LEN) {
    resultBox.appendChild(el("p", { class: "error-note", text: `${MAX_EXPLAIN_LEN}자 이내로 입력해 주세요.` }));
    return;
  }

  resultBox.appendChild(el("p", { class: "loading-note", text: "확인 중입니다..." }));

  let response;
  let data;
  try {
    ({ response, data } = await localApi("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }));
  } catch (fetchError) {
    clearNode(resultBox);
 // 2026-08-12 외부 검토 반영: 대체 행동 안내를 함께 준다.
    resultBox.appendChild(
      el("p", { class: "error-note", text: `서버에 연결할 수 없습니다. ${EMERGENCY_FALLBACK_TEXT}` })
    );
    return;
  }

  clearNode(resultBox);

  if (!response.ok) {
    // 글자수 초과(400)만 사용자가 고칠 수 있는 오류이므로 그대로 보여주고,
 // 그 외에는 행동 지시형 문구로 통일한다(외부 검토 반영, 경로8).
    const isLengthError = typeof data.error === "string" && data.error.includes("자를 넘었습니다");
    const message = isLengthError
      ? `${MAX_EXPLAIN_LEN}자 이내로 줄여서 다시 시도해 주십시오.`
      : `요청을 처리하지 못했습니다. 다시 시도해 주십시오. ${EMERGENCY_FALLBACK_TEXT}`;
    resultBox.appendChild(el("p", { class: "error-note", text: message }));
    return;
  }

  renderExplainResult(resultBox, data);
}

function buildHighlightedTextBox(text, highlights) {
  const box = el("div", { class: "explain-text-box" });
  let cursor = 0;
  const sorted = [...highlights].sort((a, b) => a.start - b.start);
  sorted.forEach((highlight) => {
    if (highlight.start > cursor) {
      box.appendChild(document.createTextNode(text.slice(cursor, highlight.start)));
    }
    const mark = document.createElement("mark");
    mark.className = "risk-mark";
    mark.textContent = text.slice(highlight.start, highlight.end);
    box.appendChild(mark);
    cursor = highlight.end;
  });
  if (cursor < text.length) {
    box.appendChild(document.createTextNode(text.slice(cursor)));
  }
  return box;
}

function renderExplainResult(container, data) {
 // 2026-08-13 외부 검토 2차 안전 수리: 매칭 결과와 무관하게 최상단 고정 안내.
  // 2026-08-14: 문구 불변, 앞머리 이모지만 뺐다(1단계 경고 스타일 유지).
  container.appendChild(el("p", { class: "notice-banner", text: ALREADY_SENT_TOP_TEXT }));

  container.appendChild(buildHighlightedTextBox(data.text, data.highlights));

  if (data.matched_rules.length === 0) {
 // 2026-08-12 외부 검토 반영: 미탐지를 "안전"으로 읽지
    // 않도록 — 도구의 한계를 먼저, 경고 스타일로 말한다.
    container.appendChild(
      el("p", {
        class: "no-signal-note",
        text:
          "⚠️ 안전하다는 뜻이 아닙니다. 이 도구는 미리 정해진 표현 6가지만 찾을 수 있고, 대출 권유·가족 사칭·투자 리딩방·통장 협박 같은 다른 수법은 찾아내지 못합니다. 이미 돈을 보냈거나 조금이라도 의심되면 지금 바로 112(경찰)·1332(금감원)에 전화해 확인하십시오.",
      })
    );
  } else {
    data.matched_rules.forEach((rule) => {
      container.appendChild(
        el("div", { class: "rule-card" }, [
          el("h3", { text: rule.name }),
          el("p", { text: rule.explanation }),
        ])
      );
    });
  }

  const gotoFlowBtn = el("button", {
    type: "button",
    class: "big-btn big-btn-secondary",
    text: "피해가 이미 발생했다면",
  });
  gotoFlowBtn.addEventListener("click", startFlow);
  container.appendChild(gotoFlowBtn);
  // 결과 블록 첫머리(= ALREADY_SENT_TOP_TEXT 고정 안내)로 보낸다.
  scrollNodeIntoView(container);
}

// ---------------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------------

function init() {
  renderContactsFooter(false);
  watchFooterSize();

  document.getElementById("btn-go-flow").addEventListener("click", startFlow);
  document.getElementById("btn-go-explain").addEventListener("click", startExplain);
  document.getElementById("btn-flow-restart").addEventListener("click", goHome);
  document.getElementById("btn-explain-back").addEventListener("click", () => showScreen("screen-home"));
  document.getElementById("btn-explain-submit").addEventListener("click", submitExplain);
  document.getElementById("explain-textarea").addEventListener("input", updateCharCount);

  showScreen("screen-home");
}

document.addEventListener("DOMContentLoaded", init);
