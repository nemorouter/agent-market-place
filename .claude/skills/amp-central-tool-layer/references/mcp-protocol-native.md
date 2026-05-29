# MCP-protocol native — v2 design

> **Status:** TODO. The v2 wire format that makes Nemo Router "an MCP server" addressable by any MCP-compliant client.

## What MCP is, briefly

**Model Context Protocol** is Anthropic's open spec for how LLM clients (the *host*) connect to external capability providers (the *server*). It standardizes:

- **Discovery** — host asks "what can you do?", server returns a typed manifest
- **Tools** — server exposes callable functions with JSON Schema arg descriptions
- **Resources** — server exposes readable URIs (think: docs, files)
- **Prompts** — server exposes pre-baked prompt templates
- **Sampling** (advanced) — server can ask the host's LLM to complete something

The wire format is JSON-RPC 2.0. Two transports: **stdio** (for local server processes — e.g., Claude Desktop spawning a Python script) and **HTTP** (for remote servers — what we'd implement).

Spec: <https://modelcontextprotocol.io/specification>

## Why MCP-native matters for Nemo

Tens of thousands of users have **already** installed MCP-aware clients (Claude Desktop, Cursor, Continue.dev, Cline, …). Once `mcp.nemorouter.ai` is an MCP server, every one of those users can connect to Nemo Router with three lines of config — no SDK, no adapter library, no per-tool integration. We harvest existing distribution.

The economics: ~3 weeks of engineering for v2 (the JSON-RPC handler + descriptor + docs) unlocks every MCP-aware host on the market. Nothing else in our roadmap has that leverage ratio.

## Scope — what we implement for v2

We implement the **`tools/*` method family**, which is enough to unlock the value. The other method families come later if customer demand emerges.

| MCP method | Our implementation | Phase |
|---|---|---|
| `initialize` | Capability handshake; returns `{ tools: { listChanged: false } }` | v2 |
| `tools/list` | Same data as `GET /v1/mcp/tools`, just JSON-RPC framed | v2 |
| `tools/call` | Same dispatcher as `POST /v1/mcp/tools/{id}/call` | v2 |
| `notifications/initialized` | Acknowledge handshake | v2 |
| `ping` | Health (optional but trivial) | v2 |
| `resources/list`, `resources/read` | Maps to Nemo's docs / prompts? Held — Phase 3 evaluation | later |
| `prompts/list`, `prompts/get` | Could expose `nemo-prompts` library (sibling skill `nemo-prompts`)? Held | later |
| `sampling/createMessage` | Server-initiated LLM call — interesting because Nemo IS an LLM router; held | later |

## Implementation sketch

Single new route inside `nemo-backend/mcp_gateway/routes.py`:

```python
from fastapi import APIRouter, Header, HTTPException
from typing import Annotated
from .mcp_jsonrpc import handle_jsonrpc_request

router = APIRouter()

@router.post("/v1/mcp/jsonrpc")
async def mcp_jsonrpc_endpoint(
    request: dict,
    authorization: Annotated[str, Header()],
    auth=Depends(virtual_key_auth),  # SAME middleware as everywhere else
):
    """MCP JSON-RPC 2.0 transport. Dispatches to the same internal handlers
    as the REST routes."""
    return await handle_jsonrpc_request(request, auth=auth)
```

And the dispatcher (`mcp_gateway/mcp_jsonrpc.py`):

```python
from .tool_registry import list_tools_for_key, call_tool

MCP_PROTOCOL_VERSION = "2024-11-05"
NEMO_SERVER_INFO = {"name": "nemo-router", "version": "1.0.0"}

async def handle_jsonrpc_request(req: dict, *, auth) -> dict:
    method = req.get("method")
    params = req.get("params", {})
    rid = req.get("id")

    if method == "initialize":
        return _ok(rid, {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": NEMO_SERVER_INFO,
        })

    if method == "tools/list":
        tools = await list_tools_for_key(auth)  # SAME function as GET /v1/mcp/tools
        return _ok(rid, {"tools": [_to_mcp_tool_shape(t) for t in tools]})

    if method == "tools/call":
        tool_id = params["name"]
        args = params.get("arguments", {})
        result = await call_tool(tool_id=tool_id, args=args, auth=auth)  # SAME function
        return _ok(rid, {
            "content": [{"type": "text", "text": _format_result(result)}],
            "isError": False,
        })

    if method == "ping":
        return _ok(rid, {})

    return _err(rid, -32601, f"Method not found: {method}")


def _to_mcp_tool_shape(tool: dict) -> dict:
    """Our internal tool shape → MCP-spec shape.
    Our schema is OpenAI-function-calling compat which is JSON Schema —
    MCP also wants JSON Schema, so this is mostly a key rename."""
    return {
        "name": tool["id"],
        "description": tool["description"],
        "inputSchema": tool["schema"]["parameters"],
    }


def _ok(rid, result): return {"jsonrpc": "2.0", "id": rid, "result": result}
def _err(rid, code, msg): return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": msg}}
```

The critical line: the JSON-RPC dispatcher calls **the same internal functions** as the REST handlers. No code duplication, no semantic drift. Bug fixes in `call_tool()` benefit both REST and MCP consumers instantly.

## Authentication

MCP spec doesn't mandate an auth scheme — that's transport-level. For HTTP transport, the convention is `Authorization: Bearer <token>` (which our existing virtual-key middleware already handles).

```
POST /v1/mcp/jsonrpc HTTP/1.1
Host: mcp.nemorouter.ai
Content-Type: application/json
Authorization: Bearer sk-nemo-...

{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
```

The Claude Desktop / Cursor config supports custom headers, so customers paste `Authorization: Bearer sk-nemo-...` once and the host sends it on every JSON-RPC request.

## Discovery — `.well-known/mcp-server.json`

A small static-ish endpoint returns the server's identity so MCP clients can verify they're talking to a real MCP server without first issuing `initialize`:

```
GET https://api.nemorouter.ai/.well-known/mcp-server.json

{
  "protocol_version": "2024-11-05",
  "name": "nemo-router",
  "version": "1.0.0",
  "description": "Nemo Router managed tool gateway. Authenticate with sk-nemo-xxx.",
  "endpoints": {
    "jsonrpc": "https://api.nemorouter.ai/v1/mcp/jsonrpc"
  },
  "transports": ["http"],
  "auth": {
    "type": "bearer",
    "header": "Authorization",
    "scheme": "Bearer",
    "docs_url": "https://nemorouter.ai/docs/get-an-api-key"
  },
  "tool_count_hint": 50,
  "homepage": "https://nemorouter.ai",
  "support": "support@nemorouter.ai"
}
```

This endpoint requires NO auth (it's discovery metadata). Cache 24h via CDN.

## Hostname — `mcp.nemorouter.ai` vs reusing `api.nemorouter.ai`

Two options:

**Option A — reuse `api.nemorouter.ai/v1/mcp/jsonrpc`.** Zero new DNS, the existing hostname already routes to `nemo-backend`. Risk: nothing material.

**Option B — add `mcp.nemorouter.ai` as a friendly alias (CNAME to `api.nemorouter.ai`).** Slightly easier to communicate to MCP host vendors ("our MCP server is at mcp.nemorouter.ai"); zero new infra cost (DNS only); does not violate interpretation 4.A in `amp-architecture/references/constraint-checklist.md` (it's not a new API service, it's a hostname pointing at the same service).

**Recommendation:** Option B. Same backend, friendlier URL. Costs nothing.

Note: adding `mcp.nemorouter.ai` is a hostname add, not a service add. Check the `validate-no-new-services.sh` allowlist update in `amp-architecture/references/open-source-boundary.md` and the constraint-checklist.

## Capabilities we DON'T claim in `initialize`

Important to be honest with clients about what works:

- `prompts.*` — `False` until Phase 3 evaluation (could expose `nemo-prompts` library)
- `resources.*` — `False` until Phase 3 evaluation (could expose nemo-docs)
- `sampling.*` — `False` (advanced; held)
- `roots.*` — `False`
- `logging.*` — `False` (we have nemo-observability; not exposed via MCP)
- `experimental.*` — `False`

`tools.listChanged` — `False` for v2. The catalog rarely changes; clients can poll `tools/list` on reconnect. Returning `True` would require a subscription protocol we don't want to implement yet.

## Error handling

JSON-RPC standard error codes plus MCP-specific:

| Code | Meaning | When |
|---|---|---|
| -32700 | Parse error | Body isn't valid JSON |
| -32600 | Invalid request | Body doesn't match JSON-RPC envelope |
| -32601 | Method not found | Method not in our supported list |
| -32602 | Invalid params | Tool args fail JSON Schema validation |
| -32603 | Internal error | Anything else unexpected |
| -32000 | Server error (Nemo-specific) | Tool execution failed (vendor error) |
| -32001 | Insufficient credits | Maps to 402 |
| -32002 | Tool not granted | Maps to 403 |

Every error response includes a `data` payload with `nemo.trace_id` so customers can debug.

## Observability — same as REST

Every JSON-RPC `tools/call` emits the same span shape as REST tool calls (`amp-billing-observability/references/trace-shape.md`). Cost, latency, guardrail decisions, all consistent. The wire format doesn't change the trace shape.

## Testing

Test matrix for v2:

| Client | Test |
|---|---|
| Hand-rolled curl | JSON-RPC `initialize` → `tools/list` → `tools/call` round-trip |
| Claude Desktop | Add config, verify catalog appears, execute one tool |
| Cursor | Same |
| `mcp-cli` (Anthropic's reference CLI) | Capability negotiation + tool exec |
| Custom MCP Python client | Cross-language interop |

Each of these is a CI integration test once v2 is on the path. Mock the upstream tool (Slack, GitHub) but use the real MCP wire format.

## What we publish at v2 launch

- `mcp.nemorouter.ai` DNS live
- `/v1/mcp/jsonrpc` route shipping in `nemo-backend`
- `/.well-known/mcp-server.json` published
- Docs page: `nemorouter.ai/docs/integrations/mcp` — config snippets for Claude Desktop, Cursor, generic MCP clients
- Blog post: "Nemo Router is now an MCP server" (DevRel + nemo-youtube)
- Anthropic MCP marketplace submission (no code; metadata only)

## What we DON'T do at v2 launch

- Implement `prompts.*` / `resources.*` / `sampling.*` (held; revisit at v3)
- Implement stdio transport (only HTTP)
- Implement WebSocket transport (only HTTP request/response)
- Implement subscription / `listChanged` notifications (catalog stable; clients can poll)

## Risk register

| Risk | Mitigation |
|---|---|
| MCP spec evolves; our implementation lags | Pin to `2024-11-05`; bump deliberately when spec moves; CI runs against Anthropic's reference test suite |
| MCP client sends malformed JSON-RPC | Standard `-32700` / `-32600`, never 500 |
| Tool args don't match our JSON Schema | `-32602` with the Pydantic validation error in `data` |
| Customer hits a tool they're not granted | `-32002`; mirror REST 403 with same audit log entry |
| MCP host doesn't support custom headers (auth) | Doc workaround: query string `?api_key=...` — DEPRECATED but functional fallback (logged + rate-limited harder; encourage migration to header) |
