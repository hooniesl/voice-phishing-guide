"use strict";

const PY_SPACE =
  "[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";

const RULES = [
  {
    id: 1,
    name: "기관 사칭",
    pattern: new RegExp(
      "(검찰|검사|수사관|검찰청|경찰청|금융감독원|금감원|국세청|관세청|법원)" +
        "[^\\n]{0,10}(입니다|전화|수사|조사|출석)",
      "gu"
    ),
    explanation:
      "검찰청·경찰청·금융감독원 등 기관 이름이 나오는 표현입니다. 이런 " +
      "기관을 사칭하는 사기가 많습니다 — 실제 기관은 전화로 돈이나 " +
      "개인정보를 요구하지 않으니, 통화를 끊고 해당 기관의 공식 번호로 " +
      "다시 확인하십시오. 공식 안내(금융감독원 보이스피싱지킴이, " +
      "https://www.fss.or.kr/fss/main/contents.do?menuNo=200365)가 " +
      "대응 대상으로 다루는 상황입니다.",
  },
  {
    id: 2,
    name: "앱 설치 유도",
    pattern: new RegExp("(앱|어플|어플리케이션|프로그램)[^\\n]{0,5}(설치|깔아|다운로드)", "gu"),
    explanation:
      "출처를 알 수 없는 앱이나 프로그램 설치를 유도하는 표현입니다. " +
      "이런 앱은 화면을 원격으로 조종당하는 등 피해로 이어질 수 있습니다.",
  },
  {
    id: 3,
    name: "개인정보·인증번호 언급",
    pattern: new RegExp(
      "(계좌번호|주민등록번호|주민번호|인증번호|인증코드|카드번호|비밀번호|OTP)",
      "giu"
    ),
    explanation:
      "계좌번호·주민등록번호·인증번호 등 개인정보와 관련된 단어가 " +
      "있습니다. 만약 상대가 이런 정보를 알려 달라거나 입력하라고 " +
      "한다면 응하지 마십시오 — 정상적인 기관·금융회사는 전화나 " +
      "문자로 이런 정보를 묻지 않습니다.",
  },
  {
    id: 4,
    name: "URL 접속 유도",
    pattern: new RegExp(
      "(https?://|hxxp://|bit\\.ly|단축" +
        PY_SPACE +
        "?url|링크[^\\n]{0,5}(클릭|접속)|" +
        "클릭하세요|접속하세요)",
      "giu"
    ),
    explanation:
      "출처가 불분명한 링크로 접속을 유도하는 표현입니다. 클릭하면 " +
      "악성 앱 설치나 개인정보 입력 화면으로 연결될 수 있습니다.",
  },
  {
    id: 5,
    name: "해외발신",
    pattern: new RegExp("\\[해외발신\\]|\\[국제발신\\]", "gu"),
    explanation:
      "해외에서 발신된 것으로 표시되는 문자입니다. 실제 발신지를 " +
      "확인하기 어려운 경우가 많아 주의가 필요합니다.",
  },
  {
    id: 6,
    name: "긴급·협박 표현",
    pattern: new RegExp(
      "(즉시[^\\n]{0,10}(입금|송금|이체)|지금" +
        PY_SPACE +
        "?바로|체포|구속|압류|" +
        "정지되었습니다|처벌받)",
      "gu"
    ),
    explanation:
      "급한 송금·이체 요구, 체포·구속·정지 언급 등 상대를 압박할 때 " +
      "자주 쓰이는 표현이 있습니다. 급하게 몰아붙일수록 일단 멈추고 " +
      "확인하십시오. 이 항목은 특정 문서의 문구를 그대로 인용한 것이 " +
      "아니라, 일반적으로 자주 쓰이는 수법을 참고해 안내에 포함한 " +
      "항목이라는 점을 정직하게 알려드립니다.",
  },
];

const IGNORABLE_CHARS = new Set([
  "\u0009", 
  "\u000a", 
  "\u000b", 
  "\u000c", 
  "\u000d", 
  "\u0020", 
  "\u00a0", 
  "\u200b", 
  "\u200c", 
  "\u200d", 
  "\ufeff", 
]);

function buildNormalized(text) {
  const chars = [];
  const indexMap = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (IGNORABLE_CHARS.has(ch)) continue;
    chars.push(ch);
    indexMap.push(i);
  }
  return { normalized: chars.join(""), indexMap };
}

function explain(text) {
  const { normalized, indexMap } = buildNormalized(text);

  const rawSpans = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(normalized)) !== null) {
      const matched = match[0];
      if (matched.length === 0) {
        
        
        rule.pattern.lastIndex += 1;
        continue;
      }
      const origStart = indexMap[match.index];
      const origEnd = indexMap[match.index + matched.length - 1] + 1;
      rawSpans.push({ start: origStart, end: origEnd, rule_id: rule.id });
    }
  }

  
  rawSpans.sort((a, b) => a.start - b.start);

  const highlights = [];
  const matchedRuleIds = new Set();
  let lastEnd = -1;
  for (const span of rawSpans) {
    if (span.start < lastEnd) {
      
      matchedRuleIds.add(span.rule_id);
      continue;
    }
    highlights.push({ start: span.start, end: span.end, rule_id: span.rule_id });
    matchedRuleIds.add(span.rule_id);
    lastEnd = span.end;
  }

  const matchedRules = RULES.filter((rule) => matchedRuleIds.has(rule.id)).map((rule) => ({
    id: rule.id,
    name: rule.name,
    explanation: rule.explanation,
  }));

  return { text, highlights, matched_rules: matchedRules };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RULES, explain };
}
