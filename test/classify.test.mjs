import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, applyOverride } from '../scripts/classify.mjs';

// 골든 케이스: [이름, etfTabCode, 기대 status]
const CASES = [
  // 주식형 → 위험자산
  ['KODEX 200', 1, 'unsafe'],
  ['TIGER 미국S&P500', 4, 'unsafe'],
  ['TIGER 미국나스닥100', 4, 'unsafe'],
  ['KODEX 2차전지산업', 2, 'unsafe'],

  // 레버리지·인버스 → 매수 불가
  ['KODEX 레버리지', 3, 'unsafe'],
  ['KODEX 200선물인버스2X', 3, 'unsafe'],
  ['TIGER 인버스', 3, 'unsafe'],

  // 채권형 → 안전
  ['KODEX 단기채권', 6, 'safe'],
  ['TIGER 국고채3년', 6, 'safe'],
  ['KODEX 종합채권(AA-이상)액티브', 6, 'safe'],
  ['ACE 미국채30년액티브(H)', 6, 'safe'],
  ['KODEX 23-12 은행채(AA+이상)액티브', 6, 'safe'],

  // 금리·파킹 → 안전
  ['TIGER CD금리투자KIS(합성)', 6, 'safe'],
  ['KODEX KOFR금리액티브(합성)', 6, 'safe'],
  ['TIGER 머니마켓액티브', 6, 'safe'],

  // 하이일드 → 위험
  ['TIGER 미국하이일드채권액티브', 6, 'unsafe'],

  // 채권혼합 → 안전
  ['TIGER 테슬라채권혼합Fn', 7, 'safe'],
  ['KODEX 삼성전자채권혼합Wise', 7, 'safe'],
  ['KODEX 200미국채혼합', 7, 'safe'],

  // TRF 지수형 혼합: 주식 ≤50% 안전, 초과 위험
  ['KODEX TRF3070', 7, 'safe'],
  ['KODEX TRF5050', 7, 'safe'],
  ['KODEX TRF7030', 7, 'unsafe'],

  // 주식혼합 → 위험
  ['KODEX 미국S&P500주식혼합', 7, 'unsafe'],

  // TDF: 적격 표기 있으면 안전, 없으면 확인 필요
  ['KODEX TDF2050액티브 적격', 7, 'safe'],
  ['KODEX TDF2050액티브', 7, 'uncertain'],

  // 채권 파생·커버드콜 → 확인 필요
  ['KODEX 미국채울트라30년선물(H)', 3, 'uncertain'],
  ['SOL 미국30년국채커버드콜(합성)', 6, 'uncertain'],

  // 원자재·통화 → 위험/불가
  ['KODEX WTI원유선물(H)', 5, 'unsafe'],
  ['ACE KRX금현물', 5, 'unsafe'],
  ['KODEX 미국달러선물', 3, 'unsafe'],

  // 주식 커버드콜 → 위험
  ['TIGER 미국배당다우존스타겟커버드콜2호', 4, 'unsafe'],
];

for (const [name, tab, expected] of CASES) {
  test(`${name} → ${expected}`, () => {
    const r = classify({ name, etfTabCode: tab });
    assert.equal(r.status, expected, `reason: ${r.reason}`);
  });
}

test('override가 규칙 엔진 결과를 덮어쓴다', () => {
  const ruled = classify({ name: 'KODEX TDF2050액티브', etfTabCode: 7 });
  assert.equal(ruled.status, 'uncertain');
  const final = applyOverride(ruled, { status: 'safe', reason: '적격 TDF (운용사 공시)' });
  assert.equal(final.status, 'safe');
  assert.match(final.reason, /수동 확인/);
});

test('override 없으면 규칙 결과 유지', () => {
  const ruled = classify({ name: 'KODEX 단기채권', etfTabCode: 6 });
  assert.deepEqual(applyOverride(ruled, undefined), ruled);
});
