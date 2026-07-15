// docs/index.html + style.css + app.js + data.json → docs/artifact.html
// claude.ai Artifact용 단일 파일 스냅샷 (외부 요청 0회, doctype/html/head/body 래퍼 없음 —
// Artifact 게시 시 스켈레톤이 자동으로 감싸므로 콘텐츠만 담는다. 브라우저에서 직접 열어도 렌더링됨)

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DOCS = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'docs');

const [html, css, js, dataRaw] = await Promise.all([
  readFile(path.join(DOCS, 'index.html'), 'utf8'),
  readFile(path.join(DOCS, 'style.css'), 'utf8'),
  readFile(path.join(DOCS, 'app.js'), 'utf8'),
  readFile(path.join(DOCS, 'data.json'), 'utf8'),
]);

const markup = html.match(/<!-- APP:START -->([\s\S]*?)<!-- APP:END -->/)?.[1];
if (!markup) throw new Error('index.html에서 APP:START/APP:END 마커를 찾지 못했습니다');

// </script> 문자열이 데이터에 있으면 인라인 스크립트가 깨지므로 이스케이프
const dataInline = dataRaw.replace(/</g, '\\u003c');

const out = `<title>퇴직연금 안전자산 ETF</title>
<style>
${css}
</style>
${markup}
<script>
window.__ETF_DATA__ = ${dataInline};
${js}
</script>
`;

const outPath = path.join(DOCS, 'artifact.html');
await writeFile(outPath, out);
console.log(`완료: ${outPath} (${(out.length / 1024).toFixed(0)}KB)`);
