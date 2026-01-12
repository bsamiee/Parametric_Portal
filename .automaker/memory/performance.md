---
tags: [performance]
summary: performance implementation decisions and patterns
relevantTo: [performance]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
---
# performance

#### [Gotcha] N+1 warning threshold is `batchSize <= 1` not `< 1`, catching both zero-size and single-item batches (2026-01-12)
- **Situation:** Detecting when batch coalescing failed to reduce requests, indicating potential N+1 query pattern
- **Root cause:** Batch size of 1 means no actual batching occurred - original request was not deduplicated. Zero size is impossible in normal operation but prevents silent failures if batch building fails. Both conditions indicate same problem: no compression happened
- **How to avoid:** Threshold is strict but N+1 is a performance anti-pattern worth alerting on always. May generate false positives for legitimate single-request scenarios, but cost of investigation is low vs missing real N+1 pattern