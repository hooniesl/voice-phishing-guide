"use strict";

const MAX_EXPLAIN_LEN = 2000;

const INPUT_WARNING_TEXT =
  "이름·계좌번호·주민등록번호 등 개인정보를 입력하지 마세요. 입력 내용은 저장되지 않습니다.";

const EMERGENCY_FALLBACK_TEXT =
  "이 안내를 기다리지 마시고, 급하면 지금 바로 112(경찰)·1332(금감원)에 전화하십시오. 돈을 보내기 전이라면 송금을 멈추십시오.";

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

const QUESTIONS_BY_FIELD = {
  q1: {
    field: "q1",
    text: "낯선 앱을 설치했거나, 화면을 다른 사람이 조종하는 느낌을 받은 적이 있습니까?",
    options: ["예", "아니오", "모름"],
    optionLabels: { "예": "예", "아니오": "아니오", "모름": "모르겠음" },
  },
 
  
  
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

function buildSequence(answers) {
  const seq = ["q2", "q1"];
  
 
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

const ALLOWED_Q1 = ["예", "아니오", "모름"];
const ALLOWED_Q2 = ["예", "아니오", "현금등"];
const ALLOWED_Q3 = ["예", "아니오", "모름"];
const ALLOWED_Q4 = ["방금", "이전"];

function apiResponse(status, data) {
  return { response: { ok: status >= 200 && status < 300, status }, data };
}

function localClassify(body) {
 
  
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
 
    return apiResponse(400, { error: `텍스트가 ${MAX_EXPLAIN_LEN}자를 넘었습니다` });
  }
  if (typeof explain !== "function") throw new Error("rules.js 가 로드되지 않았습니다");
  return apiResponse(200, explain(text));
}

async function localApi(url, options) {
  const body = JSON.parse(options.body);
  if (url === "/api/classify") return localClassify(body);
  if (url === "/api/explain") return localExplain(body);
  return apiResponse(404, { error: "Not Found" });
}

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

const FOOTER_CLEARANCE_PX = 24;

function syncFooterSpacing() {
  const footer = document.getElementById("contacts-footer");
  const app = document.getElementById("app");
  if (!footer || !app) return;
  const height = Math.ceil(footer.getBoundingClientRect().height);
  if (!height) return; 
  app.style.paddingBottom = `${height + FOOTER_CLEARANCE_PX}px`;
}

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

function scrollToTop() {
  try {
    window.scrollTo(0, 0);
  } catch (scrollError) {
    
  }
}

function scrollNodeIntoView(node) {
  try {
    node.scrollIntoView(true);
  } catch (scrollError) {
    
  }
}

function startFlow() {
  state.answers = {};
  state.stepIndex = 0;
  document.getElementById("btn-flow-restart").classList.add("hidden");
  clearNode(document.getElementById("flow-result"));
 
  renderContactsFooter(false);
  showScreen("screen-flow");
  renderCurrentQuestion();
}

function goHome() {
  state.answers = {};
  state.stepIndex = 0;
  document.getElementById("btn-flow-restart").classList.add("hidden");
  clearNode(document.getElementById("flow-questions"));
  clearNode(document.getElementById("flow-result"));
 
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
 
    resultBox.appendChild(
      el("p", { class: "error-note", text: `서버에 연결할 수 없습니다. ${EMERGENCY_FALLBACK_TEXT}` })
    );
    document.getElementById("btn-flow-restart").classList.remove("hidden");
    return;
  }

  clearNode(resultBox);

  if (!response.ok) {
 
    
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
 
  
  
 
  
 
 
  
  renderContactsFooter(Boolean(classification.links_disabled));

 
  
  
  
  const notices = classification.notices || [];
  notices.forEach((noticeText) => {
    container.appendChild(el("p", { class: "notice-banner", text: noticeText }));
  });

  const stepItems = classification.steps.map((step, index) => {
    const links = (step.links || []).map(buildLinkButton);
 
    
    
    const linkTexts = (step.link_texts || []).map((linkText) =>
      el("div", { class: "step-link-text", text: linkText })
    );
    
    
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

 
  (classification.cautions || []).forEach((cautionText) => {
    cardChildren.push(el("p", { class: "caution-note", text: cautionText }));
  });

  cardChildren.push(
    el("p", { class: "source-note", text: `출처: ${classification.source_note}` })
  );

  container.appendChild(el("div", { class: "result-card" }, cardChildren));
  
  scrollToTop();
}

function startExplain() {
 
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
 
    resultBox.appendChild(
      el("p", { class: "error-note", text: `서버에 연결할 수 없습니다. ${EMERGENCY_FALLBACK_TEXT}` })
    );
    return;
  }

  clearNode(resultBox);

  if (!response.ok) {
    
 
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
 
  
  container.appendChild(el("p", { class: "notice-banner", text: ALREADY_SENT_TOP_TEXT }));

  container.appendChild(buildHighlightedTextBox(data.text, data.highlights));

  if (data.matched_rules.length === 0) {
 
    
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
  
  scrollNodeIntoView(container);
}

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
