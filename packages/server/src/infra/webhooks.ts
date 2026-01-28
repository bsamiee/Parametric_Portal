/**
 * Outbound webhook delivery: retry, signatures, dead-letter, circuit breaker.
 *
 * @effect/platform — HttpClient (delivery), HttpClientRequest (headers/body)
 * @effect/workflow — Workflow.make (delivery saga with compensation)
 * effect           — Schedule (retry), Schema (endpoint/event validation)
 * internal         — Crypto (signing), JobService (queue), Resilience (breaker+retry), CacheService (registry)
 */
export const _dependencies = [
	'@effect/platform',			// HttpClient.post, HttpClientRequest.setHeaders, HttpClientResponse.schemaBodyJson
	'@effect/workflow',			// Workflow.make (saga: deliver → retry → dead-letter → compensate)
	'effect',					// Schedule.exponential, Schema.Struct (endpoint registry)
	'./security/crypto',		// Crypto.hmac('sha256', secret, payload) for X-Webhook-Signature
	'./infra/jobs',				// JobService.enqueue('webhook:deliver', payload) for reliable delivery
	'./utils/resilience',		// Resilience.run (bulkhead → timeout → retry → circuit) per-endpoint
	'./platform/cache',			// CacheService (endpoint registry cache, delivery status, dead-letter)
	'./observe/metrics',		// MetricsService (deliveries, failures, latency histograms)
] as const;
