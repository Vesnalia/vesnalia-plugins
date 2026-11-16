---
name: otel
description: Configure and troubleshoot the OpenTelemetry plugin that exports VesnALIA turn spans, token and cost metrics and provider usage windows over OTLP/HTTP. Use when the user asks to send VesnALIA telemetry to a collector, or asks why spans or metrics are missing.
---

# OpenTelemetry export

The plugin sends OTLP/HTTP JSON from VesnALIA to a collector. It never exports prompt, response, tool, title, path or error text. There is no setting that changes this.

## Configure

```
alia plugin config otel set endpoint http://collector:4318
alia plugin config otel set headers 'x-otlp-token=SECRET'
alia plugin config otel set resourceAttributes 'deployment.environment=home'
```

| Setting | Meaning |
| --- | --- |
| `endpoint` | Base URL. The plugin adds `/v1/traces` and `/v1/metrics`. Empty: plugin stays in needs-configuration. |
| `headers` | `name=value,name=value`. Secret. |
| `resourceAttributes` | `name=value,name=value`, added to the resource. |
| `traces`, `metrics`, `usageWindows` | Switch one signal off. |
| `flushSeconds`, `usagePollSeconds` | Send and quota poll intervals. |
| `metricsRefreshSeconds` | How often every metric series is sent again (default 3600, 0 = never). Between refreshes only changed series are sent. |

## Check

- `alia plugin list` shows the plugin state. `alia plugin logs otel -n 50` shows export errors.
- Spans and metrics start at the next finished turn. History before install is not exported.
