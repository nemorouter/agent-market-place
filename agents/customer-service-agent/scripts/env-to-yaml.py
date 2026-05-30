#!/usr/bin/env python3
"""env-to-yaml.py — render a .env.<env> file as deploy-tool input.

  yaml (default) → Cloud Run --env-vars-file format ("KEY: \"value\"")
  kv             → space/line-separated KEY=VALUE for `az containerapp --env-vars`

Both drop deploy-only meta keys so they don't leak into the app runtime, and both
keep comma-bearing values (e.g. ALLOWED_ORIGINS=a,b,c) intact.

Usage:
  python3 scripts/env-to-yaml.py .env.prod          # yaml
  python3 scripts/env-to-yaml.py .env.prod kv       # KEY=VALUE lines
"""
import sys

# Keys used only by the deploy script — not needed inside the running app.
SKIP = {
    "CLOUD",
    "GCP_PROJECT", "GCP_REGION",
    "AZURE_RESOURCE_GROUP", "AZURE_LOCATION",
    "AWS_REGION", "AWS_PROFILE",
    "SERVICE_NAME",
}


def pairs(path: str):
    with open(path, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if not key or key in SKIP:
                continue
            yield key, value.strip()


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: env-to-yaml.py <.env file> [yaml|kv]", file=sys.stderr)
        return 1
    fmt = sys.argv[2] if len(sys.argv) > 2 else "yaml"
    out = []
    for key, value in pairs(sys.argv[1]):
        if fmt == "kv":
            out.append(f"{key}={value}")
        else:
            safe = value.replace("\\", "\\\\").replace('"', '\\"')
            out.append(f'{key}: "{safe}"')
    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
