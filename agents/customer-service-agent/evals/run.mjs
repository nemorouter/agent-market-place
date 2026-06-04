#!/usr/bin/env node
// evals/run.mjs — eval + benchmark harness for the Ask AI Guru support agent.
//
// Drives real /api/chat requests (the same path the widget uses), parses the SSE
// stream (answer + nemo_event frames: confidence, citations, tool_call, cost),
// scores each case's `expect` assertions, and benchmarks latency + cost.
//
// Zero dependencies — native fetch + the JSON dataset. Node 18+.
//
// Usage:
//   node evals/run.mjs                         # run all cases against prod
//   EVAL_TARGET_URL=http://localhost:3000 node evals/run.mjs
//   node evals/run.mjs --category kb           # only one category
//   node evals/run.mjs --concurrency 6
//   node evals/run.mjs --judge                 # add LLM-as-judge quality score (needs NEMOROUTER_API_KEY)
//   node evals/run.mjs --json out.json         # write machine-readable report
//
// Exit code: 0 if pass-rate >= EVAL_MIN_PASS_RATE (default 0.9), else 1 (CI gate).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const TARGET = (process.env.EVAL_TARGET_URL || 'https://guru-cs-agent-73504915201.us-central1.run.app').replace(/\/$/, '');
const NEMO_BASE = (process.env.NEMO_BASE_URL || 'https://api.nemorouter.ai').replace(/\/$/, '');
const NEMO_KEY = process.env.NEMOROUTER_API_KEY || '';
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || 'gemini-2.5-flash-lite';
const CONCURRENCY = Number(flag('concurrency', 4));
const ONLY_CATEGORY = flag('category', null);
const DO_JUDGE = Boolean(flag('judge', false));
const MIN_PASS_RATE = Number(process.env.EVAL_MIN_PASS_RATE || 0.9);
const PER_REQUEST_TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 90_000);

const C = { reset: '\x1b[0m', dim: '\x1b[2m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m' };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;

/** POST one question and fully drain the SSE stream into a structured result. */
async function runCase(c) {
  const url = `${TARGET}/api/chat`;
  const body = {
    messages: [{ role: 'user', content: c.question }],
    sessionId: `eval-${c.id}`,
    ...(c.mode ? { mode: c.mode } : {}),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_REQUEST_TIMEOUT_MS);
  const t0 = performance.now();
  let ttfbMs = null;
  const out = { answer: '', confidence: null, webSearched: false, citations: 0, tools: [], costUsd: 0, httpStatus: 0, error: null };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: TARGET },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    out.httpStatus = res.status;
    if (!res.ok || !res.body) {
      out.error = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) out.error = j.error;
      } catch {}
      return finalize();
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data: ')) continue;
        const payload = t.slice(6);
        if (payload === '[DONE]') continue;
        let j;
        try { j = JSON.parse(payload); } catch { continue; }
        if (j.nemo_event === 'confidence') { out.confidence = j.level ?? null; if (j.webSearched) out.webSearched = true; continue; }
        if (j.nemo_event === 'citations') { out.citations = Array.isArray(j.citations) ? j.citations.length : 0; continue; }
        if (j.nemo_event === 'tool_call') { if (j.tool && !out.tools.includes(j.tool)) out.tools.push(j.tool); continue; }
        if (j.nemo_event === 'cost') { out.costUsd = Number(j.costUsd) || out.costUsd; continue; }
        if (j.nemo_event === 'error') { out.error = j.message || 'stream_error'; continue; }
        const delta = j?.choices?.[0]?.delta?.content ?? '';
        if (delta) { if (ttfbMs === null) ttfbMs = performance.now() - t0; out.answer += delta; }
        // terminal usage chunk carries streamed-answer cost
        const usageCost = j?.usage?.response_cost ?? j?.response_cost;
        if (usageCost) out.costUsd += Number(usageCost) || 0;
      }
    }
  } catch (e) {
    out.error = e?.name === 'AbortError' ? 'timeout' : String(e?.message || e);
  }
  function finalize() {
    clearTimeout(timer);
    out.ttfbMs = ttfbMs;
    out.totalMs = performance.now() - t0;
    return out;
  }
  return finalize();
}

/** Score the `expect` assertions against an observed result. Returns {pass, checks[]}. */
function score(c, r) {
  const checks = [];
  const a = (r.answer || '').toLowerCase();
  const e = c.expect || {};
  const add = (name, pass, detail) => checks.push({ name, pass, detail });

  // An expected, correct refusal (e.g. the prompt-injection guardrail firing) is a PASS,
  // not an error — list those codes in `okErrors`.
  if (r.error) {
    const tolerated = Array.isArray(e.okErrors) && e.okErrors.includes(r.error);
    add(tolerated ? `blocked-ok:${r.error}` : 'no-error', tolerated, r.error);
  } else {
    add('no-error', true, `HTTP ${r.httpStatus}`);
  }

  if (e.confidenceIn) add(`confidence∈[${e.confidenceIn}]`, e.confidenceIn.includes(r.confidence), `got ${r.confidence}`);
  if (typeof e.webSearched === 'boolean') add(`webSearched=${e.webSearched}`, r.webSearched === e.webSearched, `got ${r.webSearched}`);
  if (e.toolUsed) add(`tool:${e.toolUsed}`, r.tools.includes(e.toolUsed), `tools=[${r.tools}]`);
  if (e.contains) for (const s of e.contains) add(`contains:"${s}"`, a.includes(s.toLowerCase()), '');
  if (e.containsAny) add(`containsAny:[${e.containsAny.join('|')}]`, e.containsAny.some((s) => a.includes(s.toLowerCase())), '');
  if (e.notContains) for (const s of e.notContains) add(`!contains:"${s}"`, !a.includes(s.toLowerCase()), '');

  return { pass: checks.every((x) => x.pass), checks };
}

/** Optional LLM-as-judge: 1-5 quality score for the answer vs the ideal. Best-effort. */
async function judge(c, r) {
  if (!NEMO_KEY || !c.ideal || r.error) return null;
  const prompt =
    `You are grading a customer-support answer. Question: "${c.question}"\n` +
    `Ideal behavior: "${c.ideal}"\n` +
    `Actual answer: "${(r.answer || '').slice(0, 1200)}"\n\n` +
    `Score 1-5 how well the actual answer meets the ideal (5=excellent, 1=wrong/unhelpful). ` +
    `Reply with ONLY a JSON object: {"score": <1-5>, "why": "<short>"}`;
  try {
    const res = await fetch(`${NEMO_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${NEMO_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 150 }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await res.json();
    const txt = j?.choices?.[0]?.message?.content ?? '';
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);
const quantile = (arr, q) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * s.length))]);
};

async function main() {
  const ds = JSON.parse(await readFile(join(__dir, 'dataset.json'), 'utf8'));
  let cases = ds.cases;
  if (ONLY_CATEGORY) cases = cases.filter((c) => c.category === ONLY_CATEGORY);
  console.log(`\n${C.bold}Ask AI Guru — eval + benchmark${C.reset}`);
  console.log(dim(`  target:   ${TARGET}`));
  console.log(dim(`  cases:    ${cases.length}${ONLY_CATEGORY ? ` (category=${ONLY_CATEGORY})` : ''}  concurrency=${CONCURRENCY}  judge=${DO_JUDGE}`));
  console.log('');

  // Bounded-concurrency map.
  const results = new Array(cases.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= cases.length) break;
        const c = cases[i];
        const r = await runCase(c);
        const s = score(c, r);
        const jd = DO_JUDGE ? await judge(c, r) : null;
        results[i] = { c, r, s, jd };
        const tag = s.pass ? ok('PASS') : bad('FAIL');
        const extra = `${r.confidence ?? '–'}${r.webSearched ? '+web' : ''} ${Math.round(r.totalMs)}ms${jd ? ` judge=${jd.score}/5` : ''}`;
        console.log(`  ${tag} ${C.cyan}${c.id}${C.reset} ${dim('· ' + c.category + ' · ' + extra)}`);
        if (!s.pass) for (const ck of s.checks.filter((x) => !x.pass)) console.log(`       ${bad('✗')} ${ck.name} ${dim(ck.detail || '')}`);
      }
    }),
  );

  // ── Summary ──────────────────────────────────────────────────────────────
  const passed = results.filter((x) => x.s.pass).length;
  const byCat = {};
  for (const x of results) {
    const k = x.c.category;
    byCat[k] ??= { pass: 0, total: 0 };
    byCat[k].total++;
    if (x.s.pass) byCat[k].pass++;
  }
  const lat = results.filter((x) => !x.r.error).map((x) => x.r.totalMs);
  const ttfb = results.filter((x) => x.r.ttfbMs != null).map((x) => x.r.ttfbMs);
  const cost = results.reduce((a, x) => a + (x.r.costUsd || 0), 0);
  const judged = results.filter((x) => x.jd?.score != null);
  const avgJudge = judged.length ? (judged.reduce((a, x) => a + x.jd.score, 0) / judged.length).toFixed(2) : null;

  console.log(`\n${C.bold}Summary${C.reset}`);
  console.log(`  overall:   ${passed}/${results.length} (${pct(passed, results.length)}%)`);
  for (const [k, v] of Object.entries(byCat)) console.log(dim(`    ${k.padEnd(10)} ${v.pass}/${v.total} (${pct(v.pass, v.total)}%)`));
  console.log(`  latency:   p50 ${quantile(lat, 0.5)}ms · p95 ${quantile(lat, 0.95)}ms · ttfb p50 ${quantile(ttfb, 0.5)}ms`);
  console.log(`  cost:      $${cost.toFixed(4)} total · $${(cost / (results.length || 1)).toFixed(4)}/query`);
  if (avgJudge) console.log(`  judge:     ${avgJudge}/5 avg (${judged.length} graded)`);

  const report = {
    target: TARGET,
    ranAt: new Date().toISOString(),
    overall: { passed, total: results.length, passRate: passed / (results.length || 1) },
    byCategory: byCat,
    latencyMs: { p50: quantile(lat, 0.5), p95: quantile(lat, 0.95), ttfbP50: quantile(ttfb, 0.5) },
    costUsd: { total: Number(cost.toFixed(6)), perQuery: Number((cost / (results.length || 1)).toFixed(6)) },
    judge: avgJudge ? { avg: Number(avgJudge), graded: judged.length } : null,
    cases: results.map((x) => ({
      id: x.c.id, category: x.c.category, pass: x.s.pass,
      confidence: x.r.confidence, webSearched: x.r.webSearched, tools: x.r.tools,
      totalMs: Math.round(x.r.totalMs), ttfbMs: x.r.ttfbMs != null ? Math.round(x.r.ttfbMs) : null,
      costUsd: x.r.costUsd, error: x.r.error,
      failedChecks: x.s.checks.filter((c) => !c.pass).map((c) => c.name),
      judge: x.jd ?? undefined,
      answer: (x.r.answer || '').slice(0, 500),
    })),
  };
  const outPath = typeof flag('json', null) === 'string' ? flag('json', null) : join(__dir, 'report.json');
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(dim(`\n  report → ${outPath}`));

  const passRate = passed / (results.length || 1);
  console.log(passRate >= MIN_PASS_RATE ? ok(`\n✓ pass-rate ${pct(passed, results.length)}% ≥ ${pct(MIN_PASS_RATE, 1)}%\n`) : bad(`\n✗ pass-rate ${pct(passed, results.length)}% < ${pct(MIN_PASS_RATE, 1)}% (gate)\n`));
  process.exit(passRate >= MIN_PASS_RATE ? 0 : 1);
}

main().catch((e) => {
  console.error(bad(`eval runner crashed: ${e?.stack || e}`));
  process.exit(2);
});
