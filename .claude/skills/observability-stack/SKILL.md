---
name: observability-stack
description: Pulumi-native observability infrastructure generator. Alloy (OTEL collector) + Prometheus + Grafana across cloud (K8s) and selfhosted (Docker). Metrics only — logs/traces to debug sink.
---

# Observability Stack Generator

> **Stack:** Alloy -> Prometheus -> Grafana (metrics only). Logs/traces -> `otelcol.exporter.debug` (discarded).
> **Runtime:** `OTEL_LOGS_EXPORTER=none`, `OTEL_TRACES_EXPORTER=none`, `OTEL_METRICS_EXPORTER=otlp` (deploy.ts:95-97).
> **Versions:** Alloy 1.13+ (OTel Collector v0.142.0), Prometheus 3.9+ (native histograms stable, feature flag is no-op), Grafana 12.3+ (dashboard schema v2, tabs, switch variables)
> **Promtail EOL:** March 2, 2026 -- use Alloy as unified collector.

| Use this skill | Use OTHER skill |
|----------------|-----------------|
| Deploy observability via Pulumi | **pulumi-k8s-generator**: Non-observability K8s resources |
| OTEL collector configs (Alloy) | **k8s-debug**: Debug deployed observability pods |
| Scrape/alert rules, dashboards | **pulumi-k8s-validator**: Audit existing infra code |
| Mode migration cloud<->selfhosted | **dockerfile-validator**: Container image builds |

## Canonical Implementation -- `infrastructure/src/deploy.ts` (207 LOC)

| Lines | Symbol | Purpose |
|-------|--------|---------|
| 14 | `_CONFIG.images` | Image tags: `grafana/alloy:latest`, `grafana/grafana:latest`, `prom/prometheus:latest` |
| 22 | `_CONFIG.ports` | `alloyGrpc: 4317`, `alloyHttp: 4318`, `alloyMetrics: 12345`, `prometheus: 9090`, `grafana: 3000` |
| 29-36 | `_Ops.alloy(promUrl)` | Alloy config: OTLP receiver (4317 grpc, 4318 http), `prometheus.remote_write`, logs/traces -> debug |
| 59 | `_Ops.grafana(promUrl)` | Prometheus datasource provisioning YAML (single datasource, `isDefault: true`) |
| 63 | `_Ops.meta(ns, component, name?)` | Metadata factory: labels `{ component, stack: 'parametric', tier: 'observe' }` + namespace |
| 68 | `_Ops.names` | `{ alloy: 'observe-alloy', grafana: 'observe-grafana', prometheus: 'observe-prometheus' }` |
| 71 | `_Ops.prometheus(alloyHost)` | Scrape config: 15s interval, `alloy:12345` + `localhost:9090` targets |
| 120-126 | `_k8sObserve(ns, items)` | Array-driven factory: PVC + ConfigMap + Deployment + Service per item |
| 147-150 | Cloud: Alloy | ConfigMap (147) + DaemonSet pod spec (148) + DaemonSet (149) + Service (150) |
| 151-154 | Cloud: Prom/Grafana | `_k8sObserve([prometheus, grafana])` with cmd, config, ports, storage |
| 187-189 | Selfhosted: observe | 3 `docker.Container` resources with `uploads` (config) + `volumes` (data) |

### Architecture: `_k8sObserve` Factory (lines 120-126)

Array-driven polymorphic factory. Accepts `ReadonlyArray<{ name, image, port, cmd, config, configFile, configPath, dataPath, storageGi }>`. For each item, creates exactly 4 resources: PVC, ConfigMap, Deployment, Service. No conditionals -- shape-driven.

### Data Flow

```
App (Effect OTEL, deploy.ts:94-97) --OTLP--> Alloy(:4317/:4318) --remote_write--> Prometheus(:9090)
                                                |--debug sink--> (logs discarded, deploy.ts:32)
                                                \--debug sink--> (traces discarded, deploy.ts:32)
Grafana(:3000) --PromQL--> Prometheus(:9090)
```

## Lookup Strategy

**Context7 MCP:** `@pulumi/kubernetes`, `@pulumi/docker`, Alloy component API, Prometheus 3.x config.
**Skip:** Patterns in `references/`, topology, alert templates, dashboard models.

## Generation Workflow

### 1. Requirements

| Mode | Infrastructure | deploy.ts Lines | Use Case |
|------|---------------|-----------------|----------|
| `cloud` | K8s (EKS/GKE/AKS) | 131-176 | Production, multi-node, HA |
| `selfhosted` | Docker containers | 178-194 | Dev, single-node, staging |

Gather: mode, retention (15d default, deploy.ts:152/188 via env), HA, TLS. Use **AskUserQuestion** only for ambiguous info.

### 2. Load References

Read all three `references/` files before generating.

### 3. Generate Resources

**Cloud (deploy.ts:147-154):**
- Alloy ConfigMap + DaemonSet + Service (3 named ports: `grpc:4317`, `http:4318`, `metrics:12345`)
- `_k8sObserve` array with prometheus (cmd flags, 9090, PVC) and grafana (datasource provisioning, 3000, PVC)
- Alloy resource limits: `200m/256Mi` limits, `100m/128Mi` requests (deploy.ts:148)

**Selfhosted (deploy.ts:187-189):**
- 3 `docker.Container` resources with `uploads` (config injection) + named volumes via `_Ops.dockerVol`
- Grafana gets `GF_SECURITY_ADMIN_PASSWORD` from `_Ops.secret()` (deploy.ts:189)
- All containers join shared network via `_Ops.dockerNets(networkId)` (deploy.ts:181)

All resources MUST be Pulumi TypeScript. Never raw YAML, Helm, or docker-compose.

### 4. Validate

| Check | Scope | What to Verify |
|-------|-------|----------------|
| Alloy OTLP ports 4317/4318 exposed | All | Both grpc + http ports in Service spec and container ports |
| Alloy metrics port 12345 exposed | All | Prometheus scrapes this port for Alloy's own metrics |
| Prometheus scrapes all components | All | `scrape_configs` includes alloy + self targets (deploy.ts:71) |
| Grafana datasource provisioned | All | `_Ops.grafana(promUrl)` generates correct Prometheus URL |
| Resource requests/limits set | Cloud | Alloy has both (deploy.ts:148); Prom/Grafana via `_k8sObserve` (no limits -- gap) |
| Named volumes for stateful data | Selfhosted | `_Ops.dockerVol` creates named Docker volumes (deploy.ts:54) |
| TLS for inter-component traffic | Cloud (prod) | Currently not configured -- known gap |

Post-generation: `pnpm exec nx run infrastructure:typecheck` then `pulumi preview --diff`.

## Production Considerations

| Concern | Current Status | Recommendation |
|---------|---------------|----------------|
| TLS | Not configured for observe tier | cert-manager or AWS ACM for inter-component comms |
| Security contexts | Missing on all observe pods (deploy.ts:148-149, 123) | Add `runAsNonRoot: true`, `readOnlyRootFilesystem: true` |
| Image tags | `:latest` for alloy, grafana, prometheus (deploy.ts:14) | Pin to specific versions for production |
| NetworkPolicies | Not defined | Allow only: Alloy<-App (4317/4318), Prometheus<-Alloy (9090 remote_write), Grafana->Prometheus (9090 PromQL) |
| Resource limits | Alloy only (deploy.ts:148) | Add to Prometheus/Grafana via extended `_k8sObserve` item shape |
| Grafana auth | Admin password only (selfhosted, deploy.ts:189) | SSO via auth proxy for cloud |

## Troubleshooting

| Issue | What to Check | Fix |
|-------|---------------|-----|
| Alloy not receiving OTLP | `kubectl logs -l app=alloy -n parametric`; verify 4317/4318 in Service ports | Check NetworkPolicy, app's `OTEL_EXPORTER_OTLP_ENDPOINT` (deploy.ts:94) |
| Prometheus targets down | `curl http://prometheus:9090/api/v1/targets`; check `state` field | Verify `alloy:12345` resolves; check Alloy metrics port exposed |
| Grafana datasource failed | Grafana UI -> Connections -> Data sources -> Test | Verify `http://prometheus.parametric.svc.cluster.local:9090` reachable |
| No metrics from app | Check `OTEL_METRICS_EXPORTER=otlp` set (deploy.ts:96) | Ensure app has OTEL SDK initialized; check Alloy receiver logs |
| Prometheus storage full | `kubectl exec -n parametric prometheus-0 -- df -h /prometheus` | Increase PVC via `storageGi` param; reduce `retention.time` |

## Deprecations

| Deprecated | Replacement | Status |
|------------|-------------|--------|
| Promtail | Alloy | EOL March 2, 2026 |
| `lokiexporter` | `otlphttp` | Removed in OTEL Collector 0.140+ |
| Standalone OTEL Collector | Alloy | Alloy 1.13+ includes OTel Collector v0.142.0 |
| Raw YAML K8s manifests | Pulumi TypeScript | Enforced in this project |
| River syntax (name) | "Alloy configuration syntax" | Renamed in Alloy 1.8+ |

## Extension: Loki + Tempo

Metrics-only by default. Full 3-signal integration details in `references/stack_architecture.md#extension-adding-loki--tempo`.

| Signal | Image | Alloy Change | Grafana Change | Runtime Env |
|--------|-------|-------------|----------------|-------------|
| Logs (Loki) | `grafana/loki:3.6.x` | `otelcol.exporter.debug` -> `otelcol.exporter.loki` -> `loki.write` | Add Loki datasource | `OTEL_LOGS_EXPORTER=otlp` |
| Traces (Tempo) | `grafana/tempo:2.7.x` | `otelcol.exporter.debug` -> `otelcol.exporter.otlp` -> Tempo | Add Tempo datasource + derived fields | `OTEL_TRACES_EXPORTER=otlp` |

Loki schema: `store: "tsdb"`, `schema: "v13"`, `period: "24h"` -- **immutable after first deploy**.

## References

- `references/stack_architecture.md` -- Topology, resource sizing, Prometheus 3.9+ (version matrix with feature flags), Loki/Tempo extension
- `references/alert_rules.md` -- Alert templates with threshold rationale, recording rules (classic + native histogram), ConfigMap provisioning
- `references/grafana_dashboards.md` -- Dashboard panels (Grafana 12.3+, schema v2 with TabsLayout), native histogram heatmap, Loki extension panels
