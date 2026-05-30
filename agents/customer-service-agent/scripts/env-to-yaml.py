#!/usr/bin/env python3
"""env-to-yaml.py — convert a .env.<env> file into a Cloud Run --env-vars-file YAML.

Cloud Run's --set-env-vars uses commas as a delimiter, which breaks on values like
ALLOWED_ORIGINS=a,b,c. --env-vars-file (YAML) handles them safely. We also drop the
deploy-only meta keys so they don't leak into the app's runtime environment.

Usage: python3 scripts/env-to-yaml.py .env.prod > /tmp/env.yaml
"""
import sys

# Keys used only by the deploy script itself — not needed inside the running app.
SKIP = {"CLOUD", "GCP_PROJECT", "GCP_REGION", "SERVICE_NAME"}


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: env-to-yaml.py <.env file>", file=sys.stderr)
        return 1
    out = []
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            if key in SKIP or not key:
                continue
            # YAML-safe double-quoted scalar.
            value = value.strip().replace("\\", "\\\\").replace('"', '\\"')
            out.append(f'{key}: "{value}"')
    sys.stdout.write("\n".join(out) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
