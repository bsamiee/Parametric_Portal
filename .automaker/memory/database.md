---
tags: [database]
summary: database implementation decisions and patterns
relevantTo: [database]
importance: 0.7
relatedFiles: []
usageStats:
  loaded: 0
  referenced: 0
  successfulFeatures: 0
---
# database

#### [Pattern] Deduplication ratio calculated as `(original - batch) / original` rather than `unique / original` (2026-01-12)
- **Problem solved:** Tracking efficiency of batch coalescing to identify wasted dedupe overhead
- **Why this works:** Measures elimination percentage (0-1 scale) which is more intuitive for understanding compression benefit. Value of 0.5 means 50% of requests were duplicates and eliminated. Directly answers 'how much waste was removed?'
- **Trade-offs:** Produces inverted scale from typical compression metrics but aligns better with telemetry use case (identifying redundant patterns). Zero for perfect batching is intuitive