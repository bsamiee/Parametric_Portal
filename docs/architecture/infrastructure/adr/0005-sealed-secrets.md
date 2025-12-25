# 0005. Sealed Secrets

Date: 2025-01-15
Status: Accepted

---
## Context

GitOps requires all manifests in git. Secrets cannot be stored in plaintext. Need cluster-specific encryption.

---
## Decision

Use **Bitnami Sealed Secrets v2.17** for secret encryption.

---
## Alternatives Considered

| Option             | Rejected Because                              |
| ------------------ | --------------------------------------------- |
| SOPS + age         | Requires key distribution, manual decryption  |
| External Secrets   | External secret store dependency (Vault, AWS) |
| HashiCorp Vault    | Operational overhead for single VPS           |
| Kubernetes secrets | Plaintext in git, security violation          |

---
## Consequences

[+] Asymmetric encryption with cluster-specific key
[+] Encrypted secrets commit to git safely
[+] Controller auto-decrypts at runtime
[+] No external dependencies
[+] Full GitOps—secrets in git, encrypted
[+] Audit trail via git history
[-] Manual `kubeseal` step for each secret update
[-] Certificate backup required for disaster recovery
