# Consumer matrix — every surface that calls the central tool layer

> **Status:** TODO. Concrete code sketches per consumer. All Phase numbers cross-ref `references/rollout-sequencing.md`.

## The matrix

| # | Consumer | Auth | Payload format | What it gets | Phase |
|---|---|---|---|---|---|
| 1 | agent-market-place widget | sk-nemo-xxx in browser sessionStorage (per Rule #15) | REST JSON | Server-side agent loop with vault + ledger + guardrails + trace | v1 |
| 2 | agent-market-place playground | sk-nemo-xxx in dashboard session (per nemo-playground) | REST JSON | Same — shared runtime | v1 |
| 3 | Nemo Support Agent | sk-nemo-support (anonymous-rate-limited key) | REST JSON | Same — shared runtime, on our own site | v1 dogfood |
| 4 | dify-integration plugin | sk-nemo-xxx in Dify plugin credentials UI | REST JSON | Customer's Dify agent gets entire Nemo tool catalog with one key | v3a |
| 5 | onyx-integration agent | sk-nemo-xxx in Onyx env var or settings | REST JSON | Onyx users get Nemo tool catalog without per-customer tool credential mgmt | v3b |
| 6 | LangChain / LlamaIndex / AutoGen / Vercel AI SDK | sk-nemo-xxx in code | REST JSON via adapter lib | Tool calls as native framework constructs | v3c |
| 7 | Native MCP clients (Claude Desktop, Cursor, mcp-anything) | sk-nemo-xxx in MCP client config | MCP JSON-RPC 2.0 | Nemo Router IS an MCP server — works in any MCP host | v2 |

## Per-consumer integration sketches

### #1, #2, #3 — Marketplace surfaces (already designed)

See `amp-agent-runtime/references/agent-loop.md`. The widget / playground / support agent all share `@nemorouter/agent-runtime`, which calls `POST /v1/agents/sessions/{id}/messages` server-side. That route internally calls `/v1/mcp/tools/{id}/call` for each tool the agent uses. The customer never directly issues an MCP call — the agent runtime hides it.

### #4 — `dify-integration` plugin (Phase 3a)

Customer installs Nemo Router as a Dify "model provider plugin" (already exists per `nemo-dify` skill). Phase 3a extends the same plugin with **tool support**:

```python
# dify-integration/plugins/nemorouter/tools/nemo_tools.py — sketch
from dify_plugin import ToolProvider
import httpx

class NemoToolsProvider(ToolProvider):
    """Exposes Nemo's tool catalog to Dify agents under the customer's sk-nemo-xxx."""

    def __init__(self, api_key: str, base_url: str = "https://api.nemorouter.ai"):
        self.api_key = api_key
        self.base_url = base_url

    async def list_tools(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.base_url}/v1/mcp/tools",
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            resp.raise_for_status()
            return resp.json()["tools"]

    async def call_tool(self, tool_id: str, args: dict) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/v1/mcp/tools/{tool_id}/call",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"args": args},
            )
            resp.raise_for_status()
            return resp.json()["result"]
```

UX: customer pastes their `sk-nemo-xxx` in the Dify plugin config → Dify agent canvas shows all Nemo-catalog tools alongside their existing Dify tools → costs hit the Nemo credit ledger.

### #5 — `onyx-integration` agents (Phase 3b)

Onyx agents already use Nemo for LLM calls. Phase 3b lets them use Nemo for tools too:

```python
# onyx-integration/backend/onyx/agents/nemo_tool_handler.py — sketch
import httpx
import os

NEMO_KEY = os.environ["NEMOROUTER_API_KEY"]
NEMO_BASE = os.environ.get("NEMOROUTER_BASE_URL", "https://api.nemorouter.ai")

class NemoToolHandler:
    """Onyx tool handler backed by the Nemo central tool layer."""

    async def execute(self, tool_name: str, params: dict) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{NEMO_BASE}/v1/mcp/tools/{tool_name}/call",
                headers={"Authorization": f"Bearer {NEMO_KEY}"},
                json={"args": params},
            )
            resp.raise_for_status()
            data = resp.json()
            return {
                "result": data["result"],
                "cost_credits": data["cost_credits"],
                "latency_ms": data["latency_ms"],
            }

    async def available_tools(self) -> list[dict]:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{NEMO_BASE}/v1/mcp/tools",
                headers={"Authorization": f"Bearer {NEMO_KEY}"},
            )
            return resp.json()["tools"]
```

Onyx users get Slack/GitHub/Notion/etc. without each customer organization administering vendor credentials per their own Onyx deployment.

### #6 — Customer-written agents

The simplest case — customer hits the REST endpoint from any HTTP-capable language.

**Raw curl:**

```bash
# List tools
curl https://api.nemorouter.ai/v1/mcp/tools \
  -H "Authorization: Bearer sk-nemo-..."

# Call one
curl -X POST https://api.nemorouter.ai/v1/mcp/tools/slack-send/call \
  -H "Authorization: Bearer sk-nemo-..." \
  -H "Content-Type: application/json" \
  -d '{"args": {"channel": "#general", "text": "Hello from my agent"}}'
```

**LangChain adapter** (we publish `@nemorouter/langchain` / `nemorouter-langchain`):

```python
from langchain_core.tools import StructuredTool
from langgraph.prebuilt import create_react_agent
from langchain_anthropic import ChatAnthropic
from nemorouter.langchain import nemo_tools  # NEW adapter lib

# One call returns a list[StructuredTool] of every tool the key is granted
tools = await nemo_tools(api_key="sk-nemo-...")

model = ChatAnthropic(model="claude-sonnet-4-6", api_key="sk-nemo-...")  # also via Nemo
agent = create_react_agent(model, tools)

result = await agent.ainvoke({"messages": [{"role": "user", "content": "Help"}]})
```

**LlamaIndex adapter** (sibling package, `nemorouter-llamaindex`):

```python
from llama_index.core.agent import ReActAgent
from llama_index.llms.openai import OpenAI  # OpenAI-compat against api.nemorouter.ai
from nemorouter.llamaindex import nemo_tools

llm = OpenAI(api_key="sk-nemo-...", api_base="https://api.nemorouter.ai/v1", model="claude-sonnet-4-6")
tools = await nemo_tools(api_key="sk-nemo-...")  # returns list[FunctionTool]
agent = ReActAgent.from_tools(tools, llm=llm)
```

**AutoGen, Vercel AI SDK, etc.** — same pattern. Each adapter lib is ~150 lines: list tools, convert JSON Schema to framework-native tool object, wrap the call function. Easy community contribution.

### #7 — Native MCP clients (Claude Desktop, Cursor, etc.) — Phase 2

After v2 ships `/v1/mcp/jsonrpc`, customers add Nemo Router as an MCP server in their MCP-aware client:

**Claude Desktop** (`~/.claude/mcp_settings.json`):

```json
{
  "mcpServers": {
    "nemo-router": {
      "transport": "http",
      "url": "https://mcp.nemorouter.ai/v1/mcp/jsonrpc",
      "headers": {
        "Authorization": "Bearer sk-nemo-..."
      }
    }
  }
}
```

Restart Claude Desktop → all tools in the customer's Nemo key are now usable inside Claude conversations. Full vault + ledger + guardrails + trace work transparently.

**Cursor** (`~/.cursor/mcp_servers.json`): same shape.

**Custom MCP host** (any language with an MCP client lib): same JSON-RPC contract.

Discovery URL — anyone can introspect the server's capabilities:

```bash
curl https://api.nemorouter.ai/.well-known/mcp-server.json
# returns: { "protocol_version": "2024-11-05", "name": "nemo-router", "tools_endpoint": "...", ... }
```

## What each consumer DOESN'T have to do (because gateway handles it)

| Concern | Consumer's job | Gateway's job |
|---|---|---|
| Tool credentials | Nothing — never sees a vendor API key | Pull from `super_admin.tool_accounts` → Secret Manager |
| Credit reservation | Nothing — happens server-side | `reserve_credits(service='tool')` before call |
| Tool I/O guardrails | Nothing — fires automatically | Inspect args + response per `amp-billing-observability/references/guardrails-tool-io.md` |
| Cost computation | Read `x-nemo-tool-cost-credits` header (optional) | Tiered flat rate + Nemo fee per `amp-billing-observability/references/tiered-flat-rate.md` |
| Audit logging | Nothing — gateway logs to `nemo.tool_call_log` | INSERT per call |
| Trace emission | Read `x-nemo-trace-id` header (optional, for support) | Emit span per `amp-billing-observability/references/trace-shape.md` |
| Vendor rate-limit handling | Nothing — gateway semaphores it | Per-tool semaphore in `mcp_gateway/providers/<protocol>.py` |
| Per-tool RBAC | Nothing — gateway enforces per-key grants | RLS check against `nemo.key_tool_grants` |

This is the whole pitch for centralization in one table. Every row that says "Nothing" in the Consumer column is value the gateway delivers for free.

## How consumers discover what tools they have

Same answer for everyone: `GET /v1/mcp/tools` (REST) or `tools/list` (MCP JSON-RPC). Returns tools the calling key is granted. RLS-scoped. Identical response shape regardless of consumer.

```json
{
  "tools": [
    {
      "id": "github-read",
      "display_name": "GitHub (read)",
      "description": "Read repos, issues, PRs, code via GitHub API.",
      "category": "basic",
      "pricing": { "flat_rate_credits": 0.001, "tier": "basic" },
      "schema": {
        "name": "github_read",
        "description": "Read GitHub resources",
        "parameters": {
          "type": "object",
          "properties": { ... }
        }
      }
    }
  ]
}
```

The `schema` field is OpenAI-function-calling compatible AND MCP-compliant (same JSON Schema dialect). Drop-in to LangChain, Dify, Onyx, Claude Desktop, raw OpenAI client — all of them.

## Consistency requirement (do not break)

The response shape from `/v1/mcp/tools` is contractual across all consumers. Adding fields is OK (backwards-compat). Removing fields or changing types requires:

1. New version (e.g., `Accept: application/vnd.nemo.tools.v2+json`)
2. Old version supported for 18 months
3. Migration doc in `nemo-sdk-conformance`

Mirrors the existing API versioning posture in Nemo Router.
