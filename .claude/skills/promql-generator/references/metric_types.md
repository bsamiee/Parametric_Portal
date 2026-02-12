# Metric Types

Merged into `promql_functions.md` -- see "Metric Types", "Function Decision Tree", and "Histogram vs Summary" sections.

## Quick Type Identification

```
Counting events that only increase?  -> Counter (_total suffix)
Current state that goes up/down?     -> Gauge (unit suffix)
Need percentiles/distribution?       -> Histogram (_bucket/_sum/_count) or Native Histogram
None of the above?                   -> Reconsider if metric is needed
```

Counter + Histogram cover ~90% of use cases. Prefer Histogram over Summary because histograms are aggregatable across instances (quantiles are non-additive) and allow flexible percentile computation at query time.

## Native Histogram Identification (3.8+ stable, 3.9+ no feature flag)

```
No _bucket/_sum/_count suffixes?     -> Likely native histogram (opaque encoding)
scrape_native_histograms: true?      -> Required in scrape config since 3.9
NHCB conversion enabled?             -> Classic histograms converted to native at ingest
```

Native histograms eliminate the `le` label and reduce series cardinality by orders of magnitude. Use `histogram_avg()`, `histogram_fraction()`, `histogram_stddev()` for richer analysis than classic histograms provide.
