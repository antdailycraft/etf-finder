# 퇴직연금 안전자산 ETF 파인더

퇴직연금(DC·IRP) 계좌에서 **안전자산으로 분류되어 100% 매수 가능한** 국내 상장 ETF를 조회하는 모바일 웹앱.

## 배경

퇴직연금감독규정상 위험자산은 적립금의 70%까지만 투자할 수 있고, 이 한도 계산에서 제외되는 상품(안전자산)만 100% 매수 가능하다 (2026-07 기준 규정):

| 분류 | 퇴직연금 내 한도 |
|---|---|
| 채권형 ETF (투자적격등급, 해외채권 포함) | 100% |
| 금리형·파킹형 (KOFR·CD금리·머니마켓) | 100% |
| 채권혼합형 (주식 ≤40%, 지수형 혼합은 ≤50%) | 100% |
| 적격 TDF | 100% |
| 주식형·주식혼합형·하이일드채권 | 70% (위험자산) |
| 레버리지·인버스, 파생 위험평가액 40% 초과 | 매수 불가 |

## 구조

```
scripts/
  sources/naver.mjs    네이버 금융 API (전종목 목록 EUC-KR + 종목 상세)
  classify.mjs         안전자산 판정 규칙 엔진 (safe / uncertain / unsafe)
  build-data.mjs       수집 오케스트레이터 → docs/data.json
  build-artifact.mjs   단일 파일 스냅샷 → docs/artifact.html (claude.ai Artifact용)
data/overrides.json    경계 사례 수동 판정 (규칙 엔진 결과를 덮어씀)
docs/                  GitHub Pages 루트 (정적 웹앱, 빌드 도구 없음)
test/classify.test.mjs 판정 골든 케이스
```

- 데이터 갱신: GitHub Actions cron (평일 KST 22:00) → `docs/data.json` 재생성 → 변경 시 커밋 → Pages 자동 재배포
- 수집 실패·이상치는 sanity gate에서 차단되어 기존 데이터가 유지됨

## 사용법

```bash
npm run fetch      # 데이터 수집 → docs/data.json (전종목 약 3분)
npm run artifact   # docs/artifact.html 스냅샷 생성
npm test           # 판정 규칙 테스트
npm run serve      # http://localhost:8787 로컬 서빙
```

## 판정 데이터 유지보수

판정은 종목명·네이버 분류 기반 추정이므로 경계 사례(채권 커버드콜, 채권선물, 비적격 TDF 등)는 `uncertain`으로 표시된다. 분기 1회 운용사·증권사 공시 목록과 대조해 `data/overrides.json`에 확정 판정을 추가할 것. 대조 소스: [KODEX](https://www.samsungfund.com/etf/product/pensionlist.do) · [RISE](https://www.riseetf.co.kr/pens/invest) · [ACE](https://www.aceetf.co.kr/pension/pensionFundList) · [SOL](https://www.soletf.com/ko/strategy/pension) · TIGER 상품상세의 "퇴직연금 100%/70%" 배지.

2026-07 대조 결과 반영됨 (직접 검증 133종목 기준 규칙 엔진 정확도 93.2%). 주의할 패턴:
- **자금공여형 TRS 합성 금리형**(TIGER CD금리 KIS, KODEX KOFR 합성, 全 미국달러 SOFR 합성)은 이름은 파킹형이지만 **위험자산(70%)**. 같은 KOFR 합성이라도 운용사별로 100%/70%가 갈리므로 상품별 확인 필수.
- **국채선물 ETF**는 퇴직연금 매매 자체가 불가.
- **채권 커버드콜**은 상품별로 100%/70%가 갈림 (미국30년국채 커버드콜류는 대부분 100%).
- 중소 운용사(KIWOOM·HANARO·1Q 등) 합성 금리형은 공시 미확인으로 `uncertain` 처리됨.

## 유의사항

이 판정은 참고용이며 증권사·상품 약관에 따라 실제 분류가 다를 수 있다. 매수 전 이용 중인 증권사에서 확인 필요. 수익률·보수 등은 네이버 금융 비공식 API 기준으로, API 스키마 변경 시 `scripts/sources/`의 어댑터를 교체한다 (백업 후보: KRX Open API `data-dbg.krx.co.kr`, 공공데이터포털 `getETFPriceInfo`).
