#!/usr/bin/env python3
"""seed-models-chunk.py — keep the agent's KB current on "which / how many models are live".

The model catalog is DYNAMIC data (it lives at /api/public/models on the gateway),
so it never appears in the static docs the crawler ingests. Without it, the support
agent retrieves model *how-to* pages but has no chunk that states the live count or
list, and — per its "answer only from context" prompt — correctly refuses
"how many models are live now?".

This script closes that gap WITHOUT a full re-index:
  1. Fetch the live catalog from {GATEWAY}/api/public/models.
  2. Render a single, human-readable "Live models" doc (also written to
     agents/guru-cs-agent/docs/models.md so future re-ingests keep it).
  3. Embed it via Nemo /v1/embeddings (text-embedding-005, 768-dim) — this routes
     through the gateway, so the embedding cost IS captured in LiteLLM_SpendLogs.
  4. Upsert ONE chunk into nemo.kb_chunks (deletes prior "Live models" chunks first
     so re-runs don't duplicate).

Run it whenever the catalog changes (same cadence as router-stats.ts). Stdlib only.

Env (read from agents/customer-service-agent/.env.local unless overridden):
  NEMOROUTER_API_KEY, NEMO_BASE_URL, EMBEDDING_MODEL
  SUPABASE_URL, SUPABASE_SCHEMA, SUPABASE_SERVICE_ROLE_KEY  (service-role for write)
  PUBLIC_SITE   (default https://nemorouter.ai)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

TITLE = "Live models on Nemo Router"
MODELS_URL = "https://nemorouter.ai/docs/api-reference/models"  # canonical citation
SITE = os.environ.get("PUBLIC_SITE", "https://nemorouter.ai")


def _env_from_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip()
    return env


def _post(url: str, body: dict, headers: dict) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def _get(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def render_doc(models: list[dict]) -> str:
    chat = [m for m in models if m.get("mode") == "chat"]
    emb = [m for m in models if m.get("mode") == "embedding"]
    other = [m for m in models if m.get("mode") not in ("chat", "embedding")]
    total = len(models)

    def names(ms):
        return ", ".join(sorted(m["model_name"] for m in ms))

    lines = [
        f"# {TITLE}",
        "",
        f"Nemo Router currently serves {total} models live through one OpenAI-compatible "
        f"endpoint (https://api.nemorouter.ai/v1). The always-current, machine-readable "
        f"list is at {SITE}/models and {SITE}/api/public/models; the API reference is at {MODELS_URL}.",
        "",
        f"As of the latest catalog refresh there are {len(chat)} chat/completions models "
        f"and {len(emb)} embedding models. Counts change as providers are added — "
        f"{SITE}/models is the source of truth.",
        "",
    ]
    if chat:
        lines += [f"Chat models ({len(chat)}): {names(chat)}.", ""]
    if emb:
        lines += [f"Embedding models ({len(emb)}): {names(emb)}.", ""]
    if other:
        lines += [f"Other models ({len(other)}): {names(other)}.", ""]
    lines += [
        "Each model is reachable by its model name (e.g. `gemini-2.5-flash`) or a "
        "model-group alias; Nemo applies routing, fallback, guardrails, and credit "
        f"tracking automatically. Browse capabilities and pricing per model at {SITE}/models.",
    ]
    return "\n".join(lines)


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    fenv = _env_from_file(repo / "agents/customer-service-agent/.env.local")

    def env(k: str, default: str = "") -> str:
        return os.environ.get(k) or fenv.get(k) or default

    nemo_key = env("NEMOROUTER_API_KEY")
    nemo_base = env("NEMO_BASE_URL", "https://api.nemorouter.ai").rstrip("/")
    emb_model = env("EMBEDDING_MODEL", "text-embedding-005")
    sb_url = env("SUPABASE_URL").rstrip("/")
    sb_schema = env("SUPABASE_SCHEMA", "nemo")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

    missing = [n for n, v in [
        ("NEMOROUTER_API_KEY", nemo_key), ("SUPABASE_URL", sb_url),
        ("SUPABASE_SERVICE_ROLE_KEY", sb_key)] if not v]
    if missing:
        print(f"ERROR: missing env: {', '.join(missing)}", file=sys.stderr)
        return 2

    # 1. live catalog
    cat = json.loads(_get(f"{SITE}/api/public/models"))
    models = cat.get("data", [])
    print(f"[seed] live catalog: {len(models)} models")

    # 2. render + persist the doc
    doc = render_doc(models)
    out = repo / "agents/guru-cs-agent/docs/models.md"
    out.write_text(doc + "\n")
    print(f"[seed] wrote {out.relative_to(repo)} ({len(doc)} chars)")

    # 3. embed via Nemo (cost captured in LiteLLM_SpendLogs)
    er = _post(f"{nemo_base}/v1/embeddings", {"model": emb_model, "input": [doc]},
               {"Authorization": f"Bearer {nemo_key}"})
    vec = er["data"][0]["embedding"]
    print(f"[seed] embedded via {emb_model}: dim={len(vec)} (cost captured at gateway)")

    sb_headers = {"apikey": sb_key, "Authorization": f"Bearer {sb_key}"}

    # 4a. delete prior "Live models" chunk(s)
    dreq = urllib.request.Request(
        f"{sb_url}/rest/v1/kb_chunks?title=eq.{urllib.parse.quote(TITLE)}",
        method="DELETE",
        headers={**sb_headers, "Content-Profile": sb_schema, "Prefer": "return=minimal"},
    )
    try:
        urllib.request.urlopen(dreq, timeout=30)
        print("[seed] cleared prior Live-models chunk(s)")
    except Exception as e:  # noqa: BLE001
        print(f"[seed] delete (ok if none): {e}")

    # 4b. insert the fresh chunk
    payload = [{"title": TITLE, "url": f"{SITE}/models", "content": doc,
                "embedding": "[" + ",".join(str(x) for x in vec) + "]"}]
    ireq = urllib.request.Request(
        f"{sb_url}/rest/v1/kb_chunks",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={**sb_headers, "Content-Type": "application/json",
                 "Content-Profile": sb_schema, "Prefer": "return=minimal"},
    )
    urllib.request.urlopen(ireq, timeout=30)
    print(f"[seed] inserted '{TITLE}' chunk into {sb_schema}.kb_chunks ✓")
    return 0


if __name__ == "__main__":
    sys.exit(main())
