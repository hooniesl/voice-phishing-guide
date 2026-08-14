"use strict";

/* 위험 신호 규칙기반 매칭 — 규칙 원본 의 브라우저 이식본.


 🚨 이 파일은 규칙 원본(파이썬)과 **같은 결과**를 내야 한다. 다르면 그것이 결함이다.
   대조 방법 = mvp_static/verify_port.py (파이썬 원본 출력과 이 파일 출력을
   케이스마다 JSON 완전일치로 비교). 이 파일을 고치면 반드시 다시 돌린다.

   파이썬 → JS 로 옮기면서 조용히 달라질 수 있는 지점 4개와 그 처리:
   1) 파이썬 `.` 는 개행(\n)만 제외하고 전부 매칭한다. JS `.` 는 \n 외에
      \r· ·  도 제외한다 → 정규식의 `.` 를 전부 `[^\n]` 로 바꿔
      파이썬 의미를 그대로 옮겼다.
   2) 파이썬 `\s` 와 JS `\s` 의 문자 집합이 다르다(\x1c-\x1f·\x85 는 파이썬만,
      ﻿ 는 JS만) → 파이썬에서 실제로 뽑은 집합(PY_SPACE)을 그대로 쓴다.
      뽑은 명령: python3 -c "re.compile(r'\s').fullmatch(chr(c))" 전수 스캔.
   3) 파이썬 문자열 인덱스는 코드포인트, JS 는 UTF-16 코드유닛이다 → 여기서는
 처음부터 UTF-16 좌표로만 계산한다(규칙 원본이 마지막에 하는 utf16 변환이
      이 파일에서는 불필요해진다. 결과 좌표계는 동일).
   4) 정규식 `u` 플래그를 켜야 `[^\n]{0,10}` 가 이모지 1자를 1자로 센다
      (안 켜면 서로게이트 2개로 세어 파이썬과 어긋난다).
*/

// 파이썬 re 의 \s 와 정확히 같은 문자 집합(위 2번).
const PY_SPACE =
  "[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";

// 규칙 6종 — 패턴·이름·설명문은 규칙 원본 RULES 와 글자 그대로 같아야 한다.
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

// 매칭 전 제거하는 문자(규칙 원본의 무시문자 집합 와 동일 11자).
// "인 증 번 호"처럼 사이를 띄우는 우회를 막는다.
const IGNORABLE_CHARS = new Set([
  "\u0009", // tab
  "\u000a", // LF
  "\u000b", // VT
  "\u000c", // FF
  "\u000d", // CR
  "\u0020", // space
  "\u00a0", // NBSP
  "\u200b", // ZWSP
  "\u200c", // ZWNJ
  "\u200d", // ZWJ
  "\ufeff", // BOM(ZWNBSP)
]);

// 공백류를 뺀 정규화 문자열과, 정규화 인덱스 → 원문 인덱스 맵(둘 다 UTF-16 단위).
// 제거 대상 11자는 전부 BMP 단일 코드유닛이라 서로게이트 쌍을 쪼개지 않는다.
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

/* 규칙 6종을 매칭해 설명문 목록과 강조 구간을 반환한다.
 판정·확률·점수는 만들지 않는다(규칙 원본과 동일). 입력 텍스트는 이 함수
   호출 동안만 메모리에 있고 어디에도 저장·전송하지 않는다 — 정적 배포본에는
   서버가 없으므로 네트워크로 나가는 경로 자체가 없다. */
function explain(text) {
  const { normalized, indexMap } = buildNormalized(text);

  const rawSpans = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(normalized)) !== null) {
      const matched = match[0];
      if (matched.length === 0) {
        // 빈 매칭이면 무한 루프를 피하려 한 칸 밀고 계속한다(파이썬 finditer 와
        // 같은 진행). 파이썬도 길이 0 매칭은 continue 로 건너뛴다.
        rule.pattern.lastIndex += 1;
        continue;
      }
      const origStart = indexMap[match.index];
      const origEnd = indexMap[match.index + matched.length - 1] + 1;
      rawSpans.push({ start: origStart, end: origEnd, rule_id: rule.id });
    }
  }

  // 시작 위치로만 정렬(안정 정렬 — 같은 시작이면 규칙 번호 순서가 유지된다).
  rawSpans.sort((a, b) => a.start - b.start);

  const highlights = [];
  const matchedRuleIds = new Set();
  let lastEnd = -1;
  for (const span of rawSpans) {
    if (span.start < lastEnd) {
      // 앞선 구간과 겹치면 강조 표시에서는 건너뛴다(설명 카드는 그대로 남긴다).
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

// 브라우저(app.js)와 node(대조 스크립트) 양쪽에서 쓴다.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { RULES, explain };
}
