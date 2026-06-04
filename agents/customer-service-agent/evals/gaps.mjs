#!/usr/bin/env node
// evals/gaps.mjs — print the agent's ranked knowledge gaps (continuous-learning report).
//
// The questions the agent couldn't confidently answer, grouped + ranked by frequency.
// Feed this back into your docs, then `npm run ingest` to close the loop.
//
// Usage:
//   ADMIN_TOKEN=… node evals/gaps.mjs
//   ADMIN_TOKEN=… EVAL_TARGET_URL=https://<agent-url> node evals/gaps.mjs

const TARGET = (process.env.EVAL_TARGET_URL || 'https://guru-cs-agent-73504915201.us-central1.run.app').replace(/\/$/, '');
const TOKEN = process.env.ADMIN_TOKEN || '';
const C = { reset: '\x1b[0m', dim: '\x1b[2m', cyan: '\x1b[36m', bold: '\x1b[1m', yellow: '\x1b[33m' };

if (!TOKEN) {
  console.error('Set ADMIN_TOKEN (the agent admin bearer) to read knowledge gaps.');
  process.exit(2);
}

const res = await fetch(`${TARGET}/api/admin/gaps`, { headers: { authorization: `Bearer ${TOKEN}` } });
if (!res.ok) {
  console.error(`gaps fetch failed: HTTP ${res.status}`);
  process.exit(1);
}
const { gaps, total } = await res.json();
console.log(`\n${C.bold}Knowledge gaps${C.reset} ${C.dim}· ${TARGET}${C.reset}`);
console.log(C.dim + `  ${gaps.length} distinct unanswered questions · ${total} total occurrences\n` + C.reset);
if (!gaps.length) {
  console.log('  🎉 No gaps logged — the KB is answering everything confidently.\n');
  process.exit(0);
}
for (const g of gaps) {
  const web = g.webSearchedRate > 0 ? ` ${C.yellow}(web tried ${Math.round(g.webSearchedRate * 100)}%)${C.reset}` : '';
  console.log(`  ${C.bold}${String(g.count).padStart(3)}×${C.reset} ${C.cyan}${g.question}${C.reset}${web}`);
}
console.log(C.dim + `\n  → Add answers for the top items to ./docs (or your site), then \`npm run ingest\`.\n` + C.reset);
