// 수집 오케스트레이터: 네이버 금융 → 분류 → docs/data.json
// 실행: node scripts/build-data.mjs [--limit N]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  fetchEtfList,
  fetchEtfDetail,
  fetchEtfAnalysis,
  fetchStockPrice,
  parseKoreanAmount,
  parseNumber,
} from './sources/naver.mjs';
import { fetchCuShares } from './sources/wisereport.mjs';
import { classify, applyOverride } from './classify.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_PATH = path.join(ROOT, 'docs', 'data.json');
const OVERRIDES_PATH = path.join(ROOT, 'data', 'overrides.json');

const CONCURRENCY = 8;
const MIN_COUNT = 800; // sanity gate: 국내 상장 ETF는 900종목 이상

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

function pickInfo(totalInfos, code) {
  return totalInfos?.find((t) => t.code === code)?.value ?? null;
}

// 자산군 표시 순서 (UI의 색상 슬롯 순서와 일치해야 함)
const ASSET_ORDER = ['BOND', 'EQUITY', 'CASH', 'DERIVATIVES', 'OTHERS'];

/** assetPortfolioList → [["BOND", 103.19], ...] (0% 제외, 고정 순서) */
function extractAssets(analysis) {
  const list = analysis?.assetPortfolioList;
  if (!Array.isArray(list) || !list.length) return null;
  const byCode = new Map(list.map((a) => [a.detailTypeCode, a.weight]));
  const out = [];
  for (const code of ASSET_ORDER) {
    const w = byCode.get(code);
    if (typeof w === 'number' && w !== 0) out.push([code, w]);
  }
  for (const a of list) {
    if (!ASSET_ORDER.includes(a.detailTypeCode) && a.weight) out.push([a.detailTypeCode, a.weight]);
  }
  return out.length ? out : null;
}

/** etfTop10MajorConstituentAssets 원본 (비중 추정용 주수·코드 포함) */
function extractHoldingsRaw(analysis) {
  const list = analysis?.etfTop10MajorConstituentAssets;
  if (!Array.isArray(list) || !list.length) return null;
  return list.map((h) => ({
    name: h.itemName,
    code: /^[0-9A-Z]{6}$/.test(h.itemCode ?? '') ? h.itemCode : null,
    count: parseNumber(h.stockCount),
    weight: parseNumber(h.etfWeight),
    est: false,
  }));
}

// 네이버는 순수 주식형이 아니면 구성종목 비중(etfWeight)을 주지 않아 직접 산출한다.
// 1순위(정확): 비중 = 보유주수 × 주가 ÷ (NAV × 설정단위). 설정단위(CU)는 WiseReport
//   상품설명에서만 얻을 수 있어 일부 상품 한정. 네이버 stockCount는 1CU 기준임을
//   순수 주식형(비중이 주어지는 상품)과의 대조로 확인함.
// 2순위(추정): 자산군 주식 비중(assets EQUITY)을 주식 행에 주수×주가 비율로 배분.
//   주식 전부가 상위 10개 안에 보이는 경우만 적용(아니면 과대 산정).
// 채권 개별 종목은 주수 자체가 미공시라 어느 방법으로도 계산 불가(UI에서 안내).
async function computeHoldingWeights(items) {
  // 채권·금리 ETF/ETN·현금성 행은 주식이 아님
  const NON_EQUITY = /국고|국채|통안|단기채|금융채|회사채|채권|금리|머니마켓|MMF|KOFR|CD|현금|예금|ETN|^T \d/;
  const isEquityRow = (h) => h.count != null && !NON_EQUITY.test(h.name);

  const targets = items.filter(
    (i) =>
      (i.category === '채권혼합' || i.category === 'TDF') &&
      i.holdingsRaw &&
      !i.holdingsRaw.some((h) => h.weight != null) &&
      i.holdingsRaw.some((h) => h.count != null),
  );
  if (!targets.length) return;

  // 국내 코드가 있는 보유 행의 시세를 중복 없이 수집
  const priceCodes = new Set();
  for (const it of targets) {
    for (const h of it.holdingsRaw) if (h.count != null && h.code) priceCodes.add(h.code);
  }
  console.log(`  구성종목 비중 산출: 대상 ${targets.length}종목 (주가 ${priceCodes.size}건, 설정단위 ${targets.length}건 조회)...`);
  const codes = [...priceCodes];
  const priceList = await mapPool(codes, (c) => fetchStockPrice(c), CONCURRENCY);
  const prices = new Map(codes.map((c, i) => [c, priceList[i]]));
  const cuList = await mapPool(targets, (it) => fetchCuShares(it.code), CONCURRENCY);

  let exact = 0;
  let anchored = 0;
  targets.forEach((it, idx) => {
    const equityPct = it.assets?.find(([c]) => c === 'EQUITY')?.[1] ?? null;

    // ── 1순위: CU 기반 전 행 계산 ──
    const cu = cuList[idx];
    if (cu && it.nav) {
      const rows = it.holdingsRaw.filter((h) => h.count != null && h.code && prices.get(h.code));
      const ws = rows.map((h) => ((h.count * prices.get(h.code)) / (it.nav * cu)) * 100);
      const total = ws.reduce((s, w) => s + w, 0);
      const eqSum = rows.reduce((s, h, i) => s + (isEquityRow(h) ? ws[i] : 0), 0);
      // CU 오파싱·주수 단위 불일치 방어: 총합과 주식 행 합계가 자산구성과 정합해야 함
      const valid =
        rows.length > 0 && total <= 105 && (equityPct == null || eqSum <= equityPct * 1.15 + 2);
      if (valid) {
        rows.forEach((h, i) => {
          h.weight = ws[i];
          h.est = true;
        });
        exact++;
        return;
      }
    }

    // ── 2순위: 자산구성 주식 비중 배분 (채권혼합, 주식 전부 노출 시) ──
    if (it.category !== '채권혼합' || !equityPct || equityPct <= 0) return;
    const fullyVisible =
      it.holdingsRaw.length < 10 || !isEquityRow(it.holdingsRaw[it.holdingsRaw.length - 1]);
    if (!fullyVisible) return;
    const eq = it.holdingsRaw.filter(isEquityRow);
    if (eq.length === 1) {
      eq[0].weight = equityPct;
      eq[0].est = true;
      anchored++;
    } else if (eq.length && eq.every((h) => h.code && prices.get(h.code))) {
      const values = eq.map((h) => h.count * prices.get(h.code));
      const totalV = values.reduce((s, v) => s + v, 0);
      eq.forEach((h, i) => {
        h.weight = (equityPct * values[i]) / totalV;
        h.est = true;
      });
      anchored++;
    }
  });
  console.log(`  비중 산출: CU 기반 ${exact} + 주식비중 배분 ${anchored} / 대상 ${targets.length}종목`);
}

async function mapPool(items, worker, size) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

async function main() {
  const overrides = JSON.parse(await readFile(OVERRIDES_PATH, 'utf8'));

  console.log('1/3 전종목 목록 수집...');
  const list = (await fetchEtfList()).slice(0, LIMIT);
  console.log(`  ${list.length}종목`);
  if (LIMIT === Infinity && list.length < MIN_COUNT) {
    throw new Error(`sanity gate 실패: 종목 수 ${list.length} < ${MIN_COUNT}`);
  }

  console.log(`2/3 종목별 상세 수집 (동시 ${CONCURRENCY})...`);
  let done = 0;
  const items = await mapPool(
    list,
    async (row) => {
      const [detail, analysis] = await Promise.all([
        fetchEtfDetail(row.itemcode),
        fetchEtfAnalysis(row.itemcode),
      ]);
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${list.length}`);

      const ki = detail?.etfKeyIndicator ?? {};
      const infos = detail?.totalInfos;
      const baseIndex = pickInfo(infos, 'etfBaseIdx') ?? '';

      const ruled = classify({ name: row.itemname, etfTabCode: row.etfTabCode, baseIndex });
      const { status, category, reason } = applyOverride(ruled, overrides[row.itemcode]);

      return {
        code: row.itemcode,
        name: row.itemname,
        issuer: (ki.issuerName ?? '').replace(/\(ETF\)$/, '').trim() || null,
        tab: row.etfTabCode,
        category,
        safe: status,
        safeReason: reason,
        ter: parseNumber(ki.totalFee),
        aum: parseKoreanAmount(ki.totalNav), // 억원
        price: row.nowVal ?? null,
        nav: parseNumber(ki.nav) ?? row.nav ?? null,
        volume: row.quant ?? null,
        returns: {
          m1: parseNumber(ki.returnRate1m),
          m3: parseNumber(ki.returnRate3m) ?? parseNumber(row.threeMonthEarnRate),
          m6: parseNumber(pickInfo(infos, 'sixMonthEarnRate')),
          y1: parseNumber(ki.returnRate1y),
        },
        baseIndex: baseIndex || null,
        assets: extractAssets(analysis),
        holdingsRaw: extractHoldingsRaw(analysis),
      };
    },
    CONCURRENCY,
  );

  await computeHoldingWeights(items);

  // 표시용 상위 5개로 압축: [이름, 비중] (+추정치는 세 번째 원소 1)
  for (const it of items) {
    it.holdings = it.holdingsRaw
      ? it.holdingsRaw.slice(0, 5).map((h) => {
          const w = h.weight != null ? Math.round(h.weight * 100) / 100 : null;
          if (w == null) return [h.name];
          return h.est ? [h.name, w, 1] : [h.name, w];
        })
      : null;
    delete it.holdingsRaw;
  }

  console.log('3/3 검증 및 저장...');
  const terValues = items.filter((i) => i.ter != null).map((i) => i.ter);
  const nullTer = items.length - terValues.length;
  const badTer = terValues.filter((t) => t < 0 || t > 3.5).length;
  const nullIssuer = items.filter((i) => !i.issuer).length;
  const nullAssets = items.filter((i) => !i.assets).length;
  const safeCount = items.filter((i) => i.safe === 'safe').length;
  const uncertainCount = items.filter((i) => i.safe === 'uncertain').length;

  console.log(`  안전 ${safeCount} / 확인필요 ${uncertainCount} / 위험 ${items.length - safeCount - uncertainCount}`);
  console.log(`  TER 누락 ${nullTer} (${((nullTer / items.length) * 100).toFixed(1)}%), 범위 밖 ${badTer}, 운용사 누락 ${nullIssuer}, 자산구성 누락 ${nullAssets}`);

  if (LIMIT === Infinity) {
    if (nullTer / items.length > 0.1) throw new Error('sanity gate 실패: TER 누락률 > 10%');
    if (badTer > 5) throw new Error(`sanity gate 실패: TER 범위(0~3.5%) 밖 ${badTer}종목`);
    if (safeCount < 50) throw new Error(`sanity gate 실패: 안전자산 판정 ${safeCount}종목 (< 50)`);
    if (nullAssets / items.length > 0.3) throw new Error('sanity gate 실패: 자산구성 누락률 > 30%');
  }

  items.sort((a, b) => (b.aum ?? 0) - (a.aum ?? 0));

  const out = {
    generatedAt: new Date().toISOString(),
    source: 'naver',
    count: items.length,
    items,
  };
  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(out));
  console.log(`완료: ${OUT_PATH} (${items.length}종목, ${(JSON.stringify(out).length / 1024).toFixed(0)}KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
