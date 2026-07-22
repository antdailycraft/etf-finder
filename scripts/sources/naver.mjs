// 네이버 금융 ETF 데이터 소스 (비공식 API, 무인증)
//  - 전종목 목록: finance.naver.com (EUC-KR 응답)
//  - 종목 상세:   m.stock.naver.com (UTF-8)

const LIST_URL =
  'https://finance.naver.com/api/sise/etfItemList.nhn?etfType=0&targetColumn=market_sum&sortOrder=desc';
const DETAIL_URL = (code) => `https://m.stock.naver.com/api/stock/${code}/integration`;

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  Accept: 'application/json',
};

async function fetchWithRetry(url, { attempts = 3, timeoutMs = 15000 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1) ** 2));
    }
  }
  throw lastError;
}

/** ETF 전종목 목록 (시총순). EUC-KR을 디코딩해 반환. */
export async function fetchEtfList() {
  const res = await fetchWithRetry(LIST_URL);
  const text = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
  const json = JSON.parse(text);
  if (json.resultCode !== 'success' || !Array.isArray(json.result?.etfItemList)) {
    throw new Error(`etfItemList 응답 형식 오류: ${text.slice(0, 200)}`);
  }
  return json.result.etfItemList;
}

/** 종목 상세 (운용사·TER·AUM·수익률·기초지수). 실패 시 null. */
export async function fetchEtfDetail(code) {
  try {
    const res = await fetchWithRetry(DETAIL_URL(code));
    return await res.json();
  } catch (err) {
    console.warn(`  ! 상세 조회 실패 ${code}: ${err.message}`);
    return null;
  }
}

/** 종목 분석 (자산군 비중·상위 구성종목). 실패 시 null. */
export async function fetchEtfAnalysis(code) {
  try {
    const res = await fetchWithRetry(`https://m.stock.naver.com/api/stock/${code}/etfAnalysis`);
    return await res.json();
  } catch (err) {
    console.warn(`  ! 분석 조회 실패 ${code}: ${err.message}`);
    return null;
  }
}

/** "24조 5,217억" / "994억" 같은 한국어 금액 문자열 → 억원 단위 숫자 */
export function parseKoreanAmount(str) {
  if (str == null || str === '') return null;
  if (typeof str === 'number') return str;
  let total = 0;
  let matched = false;
  const jo = str.match(/([\d,.]+)\s*조/);
  if (jo) {
    total += parseFloat(jo[1].replace(/,/g, '')) * 10000;
    matched = true;
  }
  const eok = str.match(/([\d,.]+)\s*억/);
  if (eok) {
    total += parseFloat(eok[1].replace(/,/g, ''));
    matched = true;
  }
  const man = str.match(/([\d,.]+)\s*만(?!원)/);
  if (man && !matched) {
    total += parseFloat(man[1].replace(/,/g, '')) / 10000;
    matched = true;
  }
  return matched ? Math.round(total) : null;
}

/** "109,938.07" / "+60.26%" 같은 문자열 → 숫자 (실패 시 null) */
export function parseNumber(str) {
  if (str == null || str === '') return null;
  if (typeof str === 'number') return str;
  const n = parseFloat(String(str).replace(/[,%+\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
