# Live models on Nemo Router

Nemo Router currently serves 7 models live through one OpenAI-compatible endpoint (https://api.nemorouter.ai/v1). The always-current, machine-readable list is at https://nemorouter.ai/models and https://nemorouter.ai/api/public/models; the API reference is at https://nemorouter.ai/docs/api-reference/models.

As of the latest catalog refresh there are 4 chat/completions models and 3 embedding models. Counts change as providers are added — https://nemorouter.ai/models is the source of truth.

Chat models (4): gemini-2.5-flash, gemini-2.5-flash-image, gemini-2.5-flash-lite, gemini-2.5-pro.

Embedding models (3): text-embedding-004, text-embedding-005, text-multilingual-embedding-002.

Each model is reachable by its model name (e.g. `gemini-2.5-flash`) or a model-group alias; Nemo applies routing, fallback, guardrails, and credit tracking automatically. Browse capabilities and pricing per model at https://nemorouter.ai/models.
