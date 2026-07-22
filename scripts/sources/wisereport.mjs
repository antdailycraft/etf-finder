// WiseReport(네이버 PC 금융의 ETF 데이터 제공사) — 설정단위(CU) 추출용
// 상품설명 문장("설정단위는 100,000좌이며 ...")에서만 얻을 수 있어 일부 상품은 null.

export async function fetchCuShares(code) {
  try {
    const res = await fetch(`https://navercomp.wisereport.co.kr/v2/ETF/index.aspx?cmp_cd=${code}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/설정단위는\s*([\d,]+)\s*좌/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
  } catch {
    return null;
  }
}
