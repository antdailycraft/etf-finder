(async function () {
  'use strict';

  // Artifact 스냅샷에서는 window.__ETF_DATA__가 인라인되고, Pages에서는 data.json을 fetch한다
  const data =
    window.__ETF_DATA__ ?? (await (await fetch('data.json', { cache: 'no-cache' })).json());

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const countEl = $('count');
  const searchEl = $('search');
  const safeOnlyEl = $('safe-only');
  const sortEl = $('sort');
  const chipsEl = $('chips');

  const asOf = new Date(data.generatedAt);
  $('as-of').textContent = `· ${asOf.getFullYear()}.${String(asOf.getMonth() + 1).padStart(2, '0')}.${String(asOf.getDate()).padStart(2, '0')} 기준`;

  const CATEGORIES = ['전체', '채권형', '채권혼합', '금리·파킹', 'TDF', '확인필요'];
  const BADGE = { safe: '안전자산', uncertain: '확인필요', unsafe: '위험자산' };

  const state = { q: '', safeOnly: true, category: '전체', sort: 'aum' };

  // ── 컨트롤 구성 ──
  for (const c of CATEGORIES) {
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.type = 'button';
    btn.textContent = c;
    btn.setAttribute('aria-pressed', String(c === state.category));
    btn.addEventListener('click', () => {
      state.category = c;
      for (const b of chipsEl.children) b.setAttribute('aria-pressed', String(b === btn));
      render();
    });
    chipsEl.appendChild(btn);
  }

  let debounce;
  searchEl.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = searchEl.value.trim().toLowerCase();
      render();
    }, 250);
  });
  safeOnlyEl.addEventListener('change', () => {
    state.safeOnly = safeOnlyEl.checked;
    render();
  });
  sortEl.addEventListener('change', () => {
    state.sort = sortEl.value;
    render();
  });

  // ── 포맷터 ──
  const fmtPct = (v) =>
    v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
  const pctClass = (v) => (v == null ? '' : v > 0 ? 'pos' : v < 0 ? 'neg' : '');
  const fmtAum = (v) => {
    if (v == null) return '–';
    if (v >= 10000) return `${(v / 10000).toFixed(1)}조`;
    return `${v.toLocaleString('ko-KR')}억`;
  };
  const fmtNum = (v) => (v == null ? '–' : v.toLocaleString('ko-KR'));
  const fmtTer = (v) => (v == null ? '–' : `${v}%`);

  const SORTERS = {
    aum: (a, b) => (b.aum ?? -1) - (a.aum ?? -1),
    ter: (a, b) => (a.ter ?? 99) - (b.ter ?? 99),
    y1: (a, b) => (b.returns.y1 ?? -9999) - (a.returns.y1 ?? -9999),
    m3: (a, b) => (b.returns.m3 ?? -9999) - (a.returns.m3 ?? -9999),
    volume: (a, b) => (b.volume ?? -1) - (a.volume ?? -1),
  };

  function filtered() {
    let items = data.items;
    if (state.category === '확인필요') {
      items = items.filter((i) => i.safe === 'uncertain');
    } else {
      if (state.safeOnly) items = items.filter((i) => i.safe === 'safe');
      if (state.category !== '전체') items = items.filter((i) => i.category === state.category);
    }
    if (state.q) {
      items = items.filter(
        (i) => i.name.toLowerCase().includes(state.q) || i.code.includes(state.q),
      );
    }
    return [...items].sort(SORTERS[state.sort]);
  }

  function stat(label, value, cls = '') {
    return `<span class="stat"><span class="k">${label}</span><span class="v ${cls}">${value}</span></span>`;
  }

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  const ASSET_LABEL = { BOND: '채권', EQUITY: '주식', CASH: '현금', DERIVATIVES: '파생', OTHERS: '기타' };
  const assetVar = (code) => `var(--s-${code.toLowerCase()}, var(--muted))`;

  // 자산군 비중: 막대(양수 비중 정규화) + 범례(실제 값 — 채권형은 음수·100% 초과 가능)
  function assetSection(assets) {
    if (!assets?.length) return '';
    const pos = assets.filter(([, w]) => w > 0);
    const total = pos.reduce((s, [, w]) => s + w, 0);
    const bar = total
      ? `<div class="bar" role="img" aria-label="자산 구성">${pos
          .map(([c, w]) => {
            const label = ASSET_LABEL[c] ?? c;
            return `<span class="seg" style="width:${((w / total) * 100).toFixed(1)}%;background:${assetVar(c)}" title="${label} ${w.toFixed(1)}%"></span>`;
          })
          .join('')}</div>`
      : '';
    const legend = assets
      .map(([c, w]) => `<span class="lg"><i class="dot" style="background:${assetVar(c)}"></i>${ASSET_LABEL[c] ?? esc(c)} <b>${w.toFixed(1)}%</b></span>`)
      .join('');
    return `<div class="assets"><p class="sec-k">자산 구성</p>${bar}<div class="legend">${legend}</div></div>`;
  }

  function holdingsSection(holdings) {
    if (!holdings?.length) return '';
    const rows = holdings
      .map(([name, w]) => `<li><span class="h-name">${esc(name)}</span>${w != null ? `<span class="h-w">${w.toFixed(2)}%</span>` : ''}</li>`)
      .join('');
    return `<div class="holdings"><p class="sec-k">상위 구성종목</p><ol>${rows}</ol></div>`;
  }

  function card(item) {
    const li = document.createElement('li');
    li.className = 'card';
    li.innerHTML = `
      <button class="card-head" type="button" aria-expanded="false">
        <span class="card-title">
          <span class="name"></span>
          <span class="badge ${item.safe}">${BADGE[item.safe]}</span>
        </span>
        <span class="card-meta"></span>
        <span class="stats">
          ${stat('총보수', fmtTer(item.ter))}
          ${stat('1년 수익률', fmtPct(item.returns.y1), pctClass(item.returns.y1))}
          ${stat('순자산', fmtAum(item.aum))}
        </span>
      </button>
      <div class="card-body">
        <div class="detail-grid">
          ${stat('1개월', fmtPct(item.returns.m1), pctClass(item.returns.m1))}
          ${stat('3개월', fmtPct(item.returns.m3), pctClass(item.returns.m3))}
          ${stat('6개월', fmtPct(item.returns.m6), pctClass(item.returns.m6))}
          ${stat('현재가', fmtNum(item.price))}
          ${stat('거래량', fmtNum(item.volume))}
          ${stat('NAV', fmtNum(item.nav))}
          ${stat('유형', item.category)}
          ${stat('코드', item.code)}
        </div>
        ${assetSection(item.assets)}
        ${holdingsSection(item.holdings)}
        <p class="reason">${item.safeReason}</p>
        ${item.baseIndex ? `<p class="base-index">기초지수: ${item.baseIndex}</p>` : ''}
      </div>`;
    li.querySelector('.name').textContent = item.name;
    li.querySelector('.card-meta').textContent = `${item.issuer ?? ''} · ${item.code}`;
    const head = li.querySelector('.card-head');
    head.addEventListener('click', () => {
      const open = li.classList.toggle('open');
      head.setAttribute('aria-expanded', String(open));
    });
    return li;
  }

  function render() {
    const items = filtered();
    countEl.textContent = `${items.length}종목`;
    listEl.textContent = '';
    if (!items.length) {
      const p = document.createElement('li');
      p.className = 'empty';
      p.textContent = '조건에 맞는 ETF가 없습니다';
      listEl.appendChild(p);
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of items) frag.appendChild(card(item));
    listEl.appendChild(frag);
  }

  render();
})();
