# 0004. Traefik HelmChartConfig

Date: 2025-01-15
Status: Accepted

---
## Context

K3s bundles Traefik. Customization requires either replacing it or using K3s's HelmChartConfig CRD.

---
## Decision

Configure Traefik v3.3.5 via **HelmChartConfig** in `/var/lib/rancher/k3s/server/manifests/`.

---
## Alternatives Considered

| Option          | Rejected Because                              |
| --------------- | --------------------------------------------- |
| Disable + Helm  | Extra step, version sync burden               |
| Nginx Ingress   | Different CRDs, less native to K3s            |
| Caddy Ingress   | Less mature, smaller community                |
| Default Traefik | Missing ACME, rate limiting, security headers |

---
## Consequences

[+] HelmChartConfig patches bundled chart
[+] No external Helm repo dependency
[+] ACME TLS challenge built-in
[+] IngressRoute CRDs more expressive than Ingress
[+] Traefik v3 features (HTTP/3, OpenTelemetry)
[+] Automatic certificate provisioning
[-] K3s controls Traefik updates
[-] Debugging requires understanding K3s manifests
