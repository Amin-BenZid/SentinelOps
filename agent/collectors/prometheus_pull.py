"""Pulls metrics from any Prometheus exporter (node_exporter, cAdvisor, an app's
/metrics endpoint...) so SentinelOps can alert on them with the same rules.

Configuration (env):
  PROMETHEUS_TARGETS = "name=url,name2=url2"     e.g. "api=http://api:8000/metrics"
  PROMETHEUS_METRICS = "metric_a,metric_b"       allow-list; exporters expose
                                                 thousands of series, we only keep these
For every target a synthetic `up` metric (1 = scrape ok, 0 = failed) is always
emitted, so "target down" can be alerted with a rule `up < 1`.
Series with labels are stored as `name{label="v",...}` so they stay distinct."""
from __future__ import annotations

import asyncio
import math
import os
import re

import aiohttp

_LINE = re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)(?:\s+\d+)?\s*$')


def parse_targets(spec: str) -> dict[str, str]:
    targets = {}
    for part in filter(None, (p.strip() for p in (spec or "").split(","))):
        if "=" not in part:
            raise ValueError(f"PROMETHEUS_TARGETS entry must be name=url, got {part!r}")
        name, url = part.split("=", 1)
        if not url.startswith(("http://", "https://")):
            raise ValueError(f"target {name}: url must be http(s)")
        targets[name.strip()] = url.strip()
    return targets


def parse_exposition(text: str, allow: set[str]) -> list[tuple[str, float]]:
    """Minimal Prometheus text-format parser: returns [(series_name, value)]."""
    out = []
    for line in text.splitlines():
        if not line or line.startswith("#"):
            continue
        m = _LINE.match(line.strip())
        if not m:
            continue
        name, labels, raw = m.group(1), m.group(2) or "", m.group(3)
        if name not in allow:
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if math.isnan(value) or math.isinf(value):
            continue
        out.append((f"{name}{labels}", value))
    return out


class PrometheusCollector:
    def __init__(self, targets: dict[str, str] | None = None, allow: set[str] | None = None, timeout: float = 4.0):
        self.targets = targets if targets is not None else parse_targets(os.getenv("PROMETHEUS_TARGETS", ""))
        if allow is None:
            allow = {m.strip() for m in os.getenv("PROMETHEUS_METRICS", "").split(",") if m.strip()}
        self.allow = allow
        self.timeout = aiohttp.ClientTimeout(total=timeout)

    @property
    def enabled(self) -> bool:
        return bool(self.targets)

    async def _scrape(self, session: aiohttp.ClientSession, name: str, url: str) -> list[dict]:
        rows = []
        up = 0.0
        try:
            async with session.get(url) as resp:
                if resp.status == 200:
                    text = await resp.text()
                    rows = [{"source": "prometheus", "entity_id": name, "metric_name": series, "metric_value": v}
                            for series, v in parse_exposition(text, self.allow)]
                    up = 1.0
        except Exception:
            pass
        rows.append({"source": "prometheus", "entity_id": name, "metric_name": "up", "metric_value": up})
        return rows

    async def collect(self) -> list[dict]:
        if not self.enabled:
            return []
        async with aiohttp.ClientSession(timeout=self.timeout) as session:
            results = await asyncio.gather(*(self._scrape(session, n, u) for n, u in self.targets.items()))
        return [row for chunk in results for row in chunk]
