// 퇴직연금(DC/IRP) 안전자산 판정 규칙 엔진
//
// 근거: 근로자퇴직급여보장법 시행령 제26조 + 퇴직연금감독규정 제8조의2·제9조 (2026-07 기준)
//  - 위험자산 합산 투자한도 70%. 한도 계산에서 제외되는 상품(=안전자산)만 100% 매수 가능.
//  - 안전자산: 채권형 ETF(투자적격등급), 금리형/파킹형(KOFR·CD금리·MMF),
//    채권혼합형(주식 ≤40%, 지수형 혼합은 50%까지), 적격 TDF
//  - 매수 불가: 레버리지·인버스, 파생상품 위험평가액 40% 초과(원자재선물 등)
//
// 약관(주식비중·파생평가액)에 의존하는 경계 사례는 공개 데이터만으로 확정할 수 없어
// 3값(safe/uncertain/unsafe)으로 판정하고, data/overrides.json이 최종 우선한다.

// 네이버 etfTabCode: 1 국내시장지수, 2 업종테마, 3 파생, 4 해외주식, 5 원자재, 6 채권, 7 기타

const has = (text, ...keywords) => keywords.some((k) => text.includes(k));

const BOND_KEYWORDS = [
  '국고채', '통안채', '회사채', '단기채', '금융채', '국공채', '미국채', '국채',
  '크레딧', '채권', '본드', 'TBill', 'T-Bill',
];

const PARKING_KEYWORDS = [
  'KOFR', 'CD금리', 'CD 금리', 'SOFR', '머니마켓', 'MMF', '초단기', '단기자금', '파킹',
];

const TAB_CATEGORY = {
  1: '국내주식',
  2: '업종테마',
  3: '파생',
  4: '해외주식',
  5: '원자재',
  6: '채권형',
  7: '기타',
};

/**
 * @param {{name?: string, etfTabCode?: number, baseIndex?: string}} etf
 * @returns {{status: 'safe'|'uncertain'|'unsafe', category: string, reason: string}}
 */
export function classify({ name = '', etfTabCode = 0, baseIndex = '' }) {
  const t = `${name} ${baseIndex}`;

  // ── Layer 1: 하드 제외 (퇴직연금 매수 불가 또는 명백한 위험자산) ──
  if (has(t, '레버리지', '인버스', '2X', '3X', '곱버스')) {
    return { status: 'unsafe', category: '파생', reason: '레버리지·인버스 — 퇴직연금 매수 불가' };
  }
  if (has(t, '하이일드')) {
    return { status: 'unsafe', category: '채권형', reason: '하이일드 채권 — 위험자산(70% 한도)' };
  }
  if (etfTabCode === 5 || has(t, '원유', '천연가스', 'WTI', '골드선물', '은선물', '구리', '농산물', '팔라듐')) {
    return { status: 'unsafe', category: '원자재', reason: '원자재 — 위험자산(파생형은 매수 불가)' };
  }

  const isBondLike = has(t, ...BOND_KEYWORDS);

  // 커버드콜·선물형: 채권 기초라도 파생상품 위험평가액에 따라 분류가 갈림 → 확인 필요
  if (has(t, '커버드콜')) {
    return isBondLike
      ? { status: 'uncertain', category: '채권형', reason: '채권 커버드콜 — 파생 위험평가액에 따라 분류 상이, 증권사 확인 필요' }
      : { status: 'unsafe', category: TAB_CATEGORY[etfTabCode] ?? '기타', reason: '커버드콜(주식 기초) — 위험자산' };
  }
  if (has(t, '선물')) {
    return isBondLike
      ? { status: 'uncertain', category: '채권형', reason: '채권선물 기반 — 파생 위험평가액 확인 필요' }
      : { status: 'unsafe', category: '파생', reason: '선물형 — 파생 위험평가액 40% 초과 시 매수 불가' };
  }
  if (etfTabCode === 3) {
    return { status: 'unsafe', category: '파생', reason: '파생형 — 퇴직연금 매수 불가' };
  }

  // ── Layer 2: 안전 판정 ──
  if (has(t, ...PARKING_KEYWORDS)) {
    return { status: 'safe', category: '금리·파킹', reason: '금리형·초단기 채권형 — 안전자산(100% 가능)' };
  }

  // TRFxxyy: 주식 xx% / 채권 yy% 지수형 혼합 — 지수형은 주식 50%까지 안전자산
  const trf = t.match(/TRF\s?(\d{2})(\d{2})/i);
  if (trf) {
    const stockPct = Number(trf[1]);
    return stockPct <= 50
      ? { status: 'safe', category: '채권혼합', reason: `지수형 자산배분(주식 ${stockPct}%) — 안전자산(지수형 혼합 주식 ≤50%)` }
      : { status: 'unsafe', category: '채권혼합', reason: `지수형 자산배분(주식 ${stockPct}%) — 주식비중 50% 초과 위험자산` };
  }

  if (has(t, '주식혼합')) {
    return { status: 'unsafe', category: '주식혼합', reason: '주식혼합형(주식 >50%) — 위험자산(70% 한도)' };
  }
  if (has(t, '채권혼합') || (has(t, '혼합') && isBondLike)) {
    return { status: 'safe', category: '채권혼합', reason: '채권혼합형 — 안전자산(주식 ≤40%, 지수형 ≤50% 요건)' };
  }

  if (has(t, 'TDF')) {
    // 네이버는 적격 TDF(퇴직연금 100% 가능) 종목명에 "적격" 표기를 붙인다
    return has(t, '적격')
      ? { status: 'safe', category: 'TDF', reason: '적격 TDF — 안전자산(100% 가능)' }
      : { status: 'uncertain', category: 'TDF', reason: 'TDF — 적격요건(위험자산 ≤80% 등) 충족 여부 운용사 공시 확인 필요' };
  }

  if (etfTabCode === 6 || isBondLike) {
    return { status: 'safe', category: '채권형', reason: '채권형 — 안전자산(100% 가능)' };
  }

  // ── 기본값: 보수적으로 위험자산 처리 ──
  return {
    status: 'unsafe',
    category: TAB_CATEGORY[etfTabCode] ?? '기타',
    reason: '주식형 등 위험자산 — 퇴직연금 내 70% 한도',
  };
}

/**
 * overrides.json 항목을 규칙 엔진 결과 위에 덮어쓴다.
 * @param {{status:string, category:string, reason:string}} result
 * @param {{status?:string, category?:string, reason?:string}|undefined} override
 */
export function applyOverride(result, override) {
  if (!override) return result;
  return {
    status: override.status ?? result.status,
    category: override.category ?? result.category,
    reason: override.reason ? `${override.reason} (수동 확인)` : result.reason,
  };
}
