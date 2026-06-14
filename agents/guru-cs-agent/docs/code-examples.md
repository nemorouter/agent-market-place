# Code examples — calling models through Nemo Router

> This is the agent's authoritative source for code. Use these snippets verbatim
> (swap the model id / message). **Never invent package names, imports, model ids,
> or a different base URL.** If a visitor asks for code in a language not shown
> here, give the cURL example and point them to https://nemorouter.ai/docs and the
> dashboard **Keys** page (https://nemorouter.ai/keys).

## The two facts that are always true

- **Base URL is always `https://api.nemorouter.ai/v1`** (OpenAI-compatible). Never `.com`, never a per-model URL.
- **Auth is your virtual key** (starts with `sk-nemo-`) as a Bearer token. Create one at https://nemorouter.ai/keys. Never use a master key.

## Model ids (use these exactly)

Chat: `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`, `gemini-2.5-flash-image`.
Embeddings: `text-embedding-005`, `text-embedding-004`, `text-multilingual-embedding-002`.

There is **no** `gemini-pro` — that model id does not exist on Nemo Router. To call
Gemini, use `gemini-2.5-flash` (fast/cheap) or `gemini-2.5-pro` (most capable). The
live list is at https://nemorouter.ai/models.

## Python (recommended — the OpenAI SDK pointed at Nemo Router)

```python
# pip install openai
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["NEMOROUTER_API_KEY"],   # your sk-nemo- key
    base_url="https://api.nemorouter.ai/v1",
)

response = client.chat.completions.create(
    model="gemini-2.5-flash",                    # or gemini-2.5-pro, gpt-4o, claude-sonnet-4-20250514
    messages=[{"role": "user", "content": "Hello! What is Nemo Router?"}],
)
print(response.choices[0].message.content)
```

Guardrails, cache, and rate limits auto-apply from your org config — no extra code.

## cURL

```bash
curl "https://api.nemorouter.ai/v1/chat/completions" \
  -H "Authorization: Bearer $NEMOROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gemini-2.5-flash", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## Node.js / TypeScript

```ts
// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.NEMOROUTER_API_KEY,        // your sk-nemo- key
  baseURL: "https://api.nemorouter.ai/v1",
});

const response = await client.chat.completions.create({
  model: "gemini-2.5-flash",                     // or gemini-2.5-pro, gpt-4o, claude-sonnet-4-20250514
  messages: [{ role: "user", content: "Hello! What is Nemo Router?" }],
});
console.log(response.choices[0].message.content);
```

## Streaming (Python)

```python
stream = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Write a haiku about routing"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="", flush=True)
```

## Embeddings (Python)

```python
embed = client.embeddings.create(model="text-embedding-005", input="Hello world")
print(embed.data[0].embedding[:5])
```

## Optional: the `nemoroutersdk` package (guardrails / credits / prompts management)

The OpenAI SDK above is all you need to call models. The separate `nemoroutersdk`
Python package is a convenience wrapper for **management** (listing guardrails,
checking your credit balance, managing prompt templates) — it is NOT required to
make chat completions:

```python
# pip install nemoroutersdk
from nemoroutersdk import NemoRouter

client = NemoRouter()                # reads NEMOROUTER_API_KEY from the environment
print(client.credits.balance())     # {"balance": ..., "reserved": ..., "available": ...}
print(client.guardrails.list())
```

Full, always-current examples in 15 languages/frameworks (LangChain, CrewAI, Vercel
AI SDK, Google ADK, etc.) live at https://nemorouter.ai/docs and on the dashboard
**Keys** page.
