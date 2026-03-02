---
paths: ["packages/server/**/*"]
---

# Telemetry Conventions

## Span Naming

`{verb} {object}` format, low-cardinality only. No user IDs, request UUIDs, or timestamps in span names — cardinality explosion crashes metric backends. Examples: `create user` (not `create user 42`), `validate token` (not `validate token xyz-123`).

## Span Context by Scope

| Scope           | Implementation                                                              |
| --------------- | --------------------------------------------------------------------------- |
| Route handler   | `Telemetry.span('name', opts)` — request context, error annotation, metrics |
| Service method  | `Telemetry.span('name', { metrics: false })` — span only, no route metrics  |
| Internal helper | `Effect.fn('Name.method')` — lightweight, no request context                |

Route handlers NEVER use `Effect.fn` — loses request context and metrics.

## SpanKind Inference

Prefix-driven: `auth.*` -> SERVER, `cache.*` -> INTERNAL, `job.*` -> PRODUCER. Never set SpanKind manually when prefix convention applies.

## Annotations & Metrics

`Effect.annotateCurrentSpan(key, value)` for per-request attributes (tenant ID, region). Resource attributes (service name, version, environment) set once at SDK init — never per-request. `Metric.counter`, `Metric.histogram`, `Metric.gauge` for RED signals (Rate/Errors/Duration). `Metric.trackDuration(effect)` wraps any effect with latency histogram.

## Trace Propagation

`@effect/platform` HttpClient propagates W3C `traceparent`/`tracestate` headers automatically on outbound requests. Inbound extraction via `NodeSdk` middleware. Never manually inject or extract trace context — the SDK layer handles propagation end-to-end.

## Error Annotation

`_annotateError()` auto-captures type/message/stack. Never annotate errors manually into span attributes.

## Logging

`Logger.json` for production (structured JSONL). `Logger.pretty` for local dev. `Logger.batched(interval, callback)` for all production services — unbatched per-request logging saturates stdout and backpressures the event loop at scale. `Logger.withMinimumLogLevel` to filter at source, not at consumer. `console.log` permitted in tests and local REPL only.
