#!/usr/bin/env python3
"""build-knowledge-base.py — manual, one-shot knowledge-base builder for the
Nemo agent's ``nemo_docs_search`` tool.

Scrapes two sources into a single knowledge-base JSON that the gateway tool
loads at runtime (via NEMO_DOCS_KB_PATH):

  1. A local docs directory (Markdown / MDX) — e.g. the site's 05-resources.
  2. A website URL — a polite, same-origin, depth-bounded one-shot crawl.

ZERO third-party dependencies (Python 3.9+ stdlib only) so anyone can run it
from the public repo with no install. Run it MANUALLY whenever the docs change;
commit the output JSON (or point NEMO_DOCS_KB_PATH at it).

Usage:
  # local docs only
  python3 build-knowledge-base.py \\
      --docs ../../nemo-router-mono-repo/01-frontend-end/05-resources \\
      --base-url https://nemorouter.ai \\
      --out knowledge-base.json

  # crawl the live site too (max 40 same-origin pages)
  python3 build-knowledge-base.py \\
      --url https://nemorouter.ai --max-pages 40 \\
      --out knowledge-base.json

Output schema (one array of chunks):
  [{ "id", "title", "url", "keywords": [...], "content" }]
matching nemo_backend/mcp_gateway/tools/nemo_docs/knowledge.py::DocChunk.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path

# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------

_WORD = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "and", "for", "you", "your", "with", "that", "this", "are", "can",
    "our", "out", "all", "any", "from", "into", "per", "via", "use", "used",
    "not", "but", "has", "have", "will", "what", "how", "when", "which", "they",
    "them", "their", "its", "it's", "a", "an", "of", "to", "in", "on", "is",
    "as", "at", "by", "or", "be", "we", "us", "if", "so", "do", "no",
}
_MAX_CHUNK_CHARS = 900
_SNIPPET_KEYWORDS = 10


def _tokenize(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def _keywords(title: str, content: str, limit: int = _SNIPPET_KEYWORDS) -> list[str]:
    """Derive search keywords: title words first, then top content terms."""
    title_toks = [t for t in _tokenize(title) if len(t) > 2 and t not in _STOPWORDS]
    counts = Counter(t for t in _tokenize(content) if len(t) > 3 and t not in _STOPWORDS)
    top = [w for w, _ in counts.most_common(limit)]
    # title terms first, dedup, preserve order
    seen: set[str] = set()
    out: list[str] = []
    for w in title_toks + top:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out[:limit]


def _chunk(text: str, max_chars: int = _MAX_CHUNK_CHARS) -> list[str]:
    """Split long text into paragraph-aligned chunks under max_chars."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if len(buf) + len(p) + 2 <= max_chars:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
            buf = p if len(p) <= max_chars else p[:max_chars]
    if buf:
        chunks.append(buf)
    return chunks or ([text[:max_chars]] if text.strip() else [])


def _slug(*parts: str) -> str:
    s = "-".join(parts).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80] or "chunk"


# ---------------------------------------------------------------------------
# Markdown / MDX docs
# ---------------------------------------------------------------------------

_FRONTMATTER = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)
_CODE_FENCE = re.compile(r"```.*?```", re.DOTALL)
_JSX_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_SYNTAX = re.compile(r"[#>*_`~]+")
_IMPORT = re.compile(r"^\s*(import|export)\s.+$", re.MULTILINE)


def _strip_mdx(raw: str) -> tuple[str, str]:
    """Return (title, plain_text) from a Markdown/MDX document."""
    title = ""
    m = _FRONTMATTER.match(raw)
    body = raw
    if m:
        fm = m.group(1)
        tm = re.search(r'^title:\s*["\']?(.+?)["\']?\s*$', fm, re.MULTILINE)
        if tm:
            title = tm.group(1).strip()
        body = raw[m.end():]
    body = _CODE_FENCE.sub(" ", body)
    body = _IMPORT.sub(" ", body)
    body = _JSX_TAG.sub(" ", body)
    body = _MD_LINK.sub(r"\1", body)
    if not title:
        hm = re.search(r"^#\s+(.+)$", body, re.MULTILINE)
        title = hm.group(1).strip() if hm else ""
    body = _MD_SYNTAX.sub("", body)
    body = re.sub(r"[ \t]+", " ", body)
    return title.strip(), body.strip()


def scrape_docs(docs_dir: Path, base_url: str) -> list[dict]:
    chunks: list[dict] = []
    files = sorted(docs_dir.rglob("*.md")) + sorted(docs_dir.rglob("*.mdx"))
    for fp in files:
        try:
            raw = fp.read_text(encoding="utf-8")
        except Exception:
            continue
        title, text = _strip_mdx(raw)
        if not text:
            continue
        rel = fp.relative_to(docs_dir).with_suffix("")
        url = base_url.rstrip("/") + "/" + str(rel).replace("index", "").strip("/")
        title = title or fp.stem.replace("-", " ").title()
        for i, body in enumerate(_chunk(text)):
            chunks.append(
                {
                    "id": _slug(str(rel), str(i)),
                    "title": title if i == 0 else f"{title} ({i + 1})",
                    "url": url,
                    "keywords": _keywords(title, body),
                    "content": body,
                }
            )
    print(f"[docs] {len(files)} files -> {len(chunks)} chunks", file=sys.stderr)
    return chunks


# ---------------------------------------------------------------------------
# Website crawl (one-shot, same-origin, depth/page bounded)
# ---------------------------------------------------------------------------


class _TextExtractor(HTMLParser):
    _SKIP = {"script", "style", "nav", "header", "footer", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[str] = []
        self._skip_depth = 0
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v:
                    self.links.append(v)

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif self._skip_depth == 0:
            t = data.strip()
            if t:
                self.parts.append(t)


def scrape_site(start_url: str, max_pages: int) -> list[dict]:
    origin = urllib.parse.urlparse(start_url)
    seen: set[str] = set()
    queue = [start_url]
    chunks: list[dict] = []
    while queue and len(seen) < max_pages:
        url = queue.pop(0)
        norm = url.split("#")[0].rstrip("/")
        if norm in seen:
            continue
        seen.add(norm)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "nemo-kb-builder/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:  # noqa: S310 (manual, trusted URL)
                ctype = resp.headers.get("Content-Type", "")
                if "text/html" not in ctype:
                    continue
                html = resp.read().decode("utf-8", errors="ignore")
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            print(f"[site] skip {url}: {exc}", file=sys.stderr)
            continue
        ex = _TextExtractor()
        ex.feed(html)
        text = re.sub(r"[ \t]+", " ", "\n\n".join(ex.parts)).strip()
        title = (ex.title or url).strip()
        for i, body in enumerate(_chunk(text)):
            if len(body) < 80:
                continue
            chunks.append(
                {
                    "id": _slug(urllib.parse.urlparse(norm).path or "home", str(i)),
                    "title": title if i == 0 else f"{title} ({i + 1})",
                    "url": norm,
                    "keywords": _keywords(title, body),
                    "content": body,
                }
            )
        # enqueue same-origin links
        for href in ex.links:
            absu = urllib.parse.urljoin(url, href)
            p = urllib.parse.urlparse(absu)
            if p.netloc == origin.netloc and absu.split("#")[0].rstrip("/") not in seen:
                queue.append(absu)
    print(f"[site] crawled {len(seen)} pages -> {len(chunks)} chunks", file=sys.stderr)
    return chunks


# ---------------------------------------------------------------------------
# Config-driven mode — an agent.config.yaml/json declares its knowledge sources
# ---------------------------------------------------------------------------


def load_agent_config(path: Path) -> dict:
    """Load an agent config. JSON is stdlib; YAML needs PyYAML (optional)."""
    text = path.read_text(encoding="utf-8")
    if path.suffix in (".yaml", ".yml"):
        try:
            import yaml  # type: ignore
        except ImportError:
            raise SystemExit(
                f"{path} is YAML but PyYAML isn't installed. Either `pip install pyyaml` "
                "or provide the config as .json (same schema)."
            ) from None
        return yaml.safe_load(text)
    return json.loads(text)


def scrape_from_config(cfg: dict, config_dir: Path) -> list[dict]:
    """Scrape every knowledge.source declared in an agent config."""
    chunks: list[dict] = []
    knowledge = cfg.get("knowledge") or {}
    sources = knowledge.get("sources") or []
    if not sources:
        print("[config] no knowledge.sources declared — empty KB", file=sys.stderr)
    for src in sources:
        kind = src.get("type")
        if kind == "docs":
            docs_dir = (config_dir / src["path"]).resolve()
            if not docs_dir.is_dir():
                print(f"[config] skip docs source (not a dir): {docs_dir}", file=sys.stderr)
                continue
            chunks += scrape_docs(docs_dir, src.get("base_url", "https://nemorouter.ai"))
        elif kind == "website":
            chunks += scrape_site(src["url"], int(src.get("max_pages", 40)))
        else:
            print(f"[config] unknown source type: {kind!r}", file=sys.stderr)
    return chunks


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a Nemo agent knowledge base (manual, one-shot).")
    ap.add_argument("--config", type=Path, help="Agent config (yaml/json) declaring knowledge.sources.")
    ap.add_argument("--docs", type=Path, help="Local docs dir (Markdown/MDX) to scrape.")
    ap.add_argument("--base-url", default="https://nemorouter.ai", help="Base URL for doc page links.")
    ap.add_argument("--url", help="Website URL to crawl (one-shot, same-origin).")
    ap.add_argument("--max-pages", type=int, default=40, help="Max pages to crawl from --url.")
    ap.add_argument("--out", type=Path, help="Output KB JSON path (default: <agent-id>-knowledge-base.json in config mode).")
    args = ap.parse_args()

    cfg: dict | None = None
    chunks: list[dict] = []

    if args.config:
        cfg = load_agent_config(args.config)
        agent_id = cfg.get("id", "agent")
        print(f"[config] agent '{agent_id}' — model={cfg.get('model')} tools={cfg.get('tools')} "
              f"store={(cfg.get('knowledge') or {}).get('store', 'json')}", file=sys.stderr)
        chunks += scrape_from_config(cfg, args.config.resolve().parent)
        if args.out is None:
            args.out = Path(f"{agent_id}-knowledge-base.json")
    else:
        if not args.docs and not args.url:
            ap.error("provide --config, or at least one of --docs / --url")
        if args.out is None:
            ap.error("--out is required in non-config mode")
        if args.docs:
            if not args.docs.is_dir():
                ap.error(f"--docs is not a directory: {args.docs}")
            chunks += scrape_docs(args.docs, args.base_url)
        if args.url:
            chunks += scrape_site(args.url, args.max_pages)

    # de-dup by id
    by_id: dict[str, dict] = {}
    for c in chunks:
        by_id.setdefault(c["id"], c)
    out = list(by_id.values())

    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[done] wrote {len(out)} chunks -> {args.out}", file=sys.stderr)

    store = (cfg.get("knowledge") or {}).get("store", "json") if cfg else "json"
    if store == "vector":
        print(
            "\nNext (store=vector, Phase 2): ingest this JSON into the per-org pgvector table "
            "nemo.docs_chunks (RLS-scoped to your organization_id), keyed by agent id. The "
            "nemo_docs_search tool reads your tenant corpus — never another org's.",
            file=sys.stderr,
        )
    else:
        print(
            f"\nNext (store=json): point the gateway at it ->\n  export NEMO_DOCS_KB_PATH={args.out.resolve()}\n"
            "  (restart nemo-backend; nemo_docs_search loads it, else falls back to the curated KB)",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
