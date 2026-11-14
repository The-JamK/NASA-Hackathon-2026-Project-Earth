"""Read a .env file without shell evaluation.

Values may contain spaces, equals signs, or shell metacharacters. We split on
the first '=' only, strip optional surrounding quotes, and never log values.
"""

from __future__ import annotations

from pathlib import Path


def load_env(path: str | Path) -> dict[str, str]:
    env: dict[str, str] = {}
    source = Path(path)
    if not source.exists():
        return env
    for raw in source.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        env[key] = value
    return env
