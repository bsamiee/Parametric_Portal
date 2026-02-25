# [H1][ERRORS]
>**Dictum:** *Error handling is rail design: bounded domain failures in `E`, invariant defects in `Cause`, and one deterministic boundary translation pass.*

<br>

This chapter defines how a TypeScript + Effect module keeps error semantics composable under load instead of collapsing into ad-hoc catches. It treats domain failure vocabulary as a first-class algebra, then composes recovery, retry, accumulation, and transport mapping without leaking internals. The target is predictable failure topology: one tag vocabulary per concern, one explicit defect boundary, and one exhaustive transport translation.

---
## [1][TAGGED_ERROR_RAIL_ALGEBRA]
>**Dictum:** *Model one bounded tag first; reason literals and operation labels carry policy semantics, not free-form strings.*

<br>

`Data.TaggedError` is the canonical recoverable rail for domain modules. Keep reason vocabulary finite, derive status/retry policy from that vocabulary, and drive orchestration from the policy surface instead of duplicating routing logic across handlers.

```ts
import { Data, Effect, Match, Option, pipe } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class AccountError extends Data.TaggedError("AccountError")<{
  readonly operation: "parse" | "load" | "patch";
  readonly reason:    "validation" | "not_found" | "conflict" | "rate_limited" | "upstream";
  readonly details?:  string;
  readonly cause?:    unknown;
}> {}
const accountReasonPolicy = {
  validation:   { status: 422, retryable: false },
  not_found:    { status: 404, retryable: false },
  conflict:     { status: 409, retryable: false },
  rate_limited: { status: 429, retryable: true  },
  upstream:     { status: 503, retryable: true  },
} as const satisfies Record<AccountError["reason"], { readonly status: number; readonly retryable: boolean }>;
const toAccountPolicy = (reason: AccountError["reason"]) => accountReasonPolicy[reason];

// --- [FUNCTIONS] -------------------------------------------------------------

const parseAccountId = (rawAccountId: string) =>
  pipe(
    Option.some(rawAccountId.trim()),
    Option.filter((accountId) => accountId.length > 0),
    Option.match({
      onNone: () => Effect.fail(new AccountError({ operation: "parse", reason: "validation", details: "accountId required" })),
      onSome: Effect.succeed,
    }),
  );
const loadAccount = (accountId: string) =>
  Match.value(accountId).pipe(
    Match.when("missing", () => Effect.fail(new AccountError({ operation: "load", reason: "not_found", details: accountId }))),
    Match.when("rate",    () => Effect.fail(new AccountError({ operation: "load", reason: "rate_limited" }))),
    Match.orElse((value) => Effect.succeed({ accountId: value, version: 3, status: "active" as const })),
  );
const patchAccount = (accountId: string, version: number) =>
  Match.value(version === 3).pipe(
    Match.when(true,  () => Effect.succeed({ accountId, version: version + 1, status: "suspended" as const })),
    Match.when(false, () => Effect.fail(new AccountError({ operation: "patch", reason: "conflict", details: "version mismatch" }))),
    Match.exhaustive,
  );
const suspendAccount = (rawAccountId: string) =>
  pipe(
    parseAccountId(rawAccountId),
    Effect.flatMap(loadAccount),
    Effect.flatMap(({ accountId, version }) => patchAccount(accountId, version)),
  );
const suspendAccountTransport = (rawAccountId: string) =>
  suspendAccount(rawAccountId).pipe(
    Effect.mapError((error) => ({ ...toAccountPolicy(error.reason), error }) as const),
  );
```

---
## [2][FAILURE_RAIL_AND_DEFECT_BOUNDARY]
>**Dictum:** *Defects stay defects in core flow; convert at an explicit boundary adapter only when transport requires value-level failure.*

<br>

Use `die`/`dieMessage` for invariant breakage and keep that semantics visible until a boundary intentionally translates `Cause` into recoverable rails. This prevents silent defect laundering inside domain orchestration and keeps postmortem fidelity intact.

```ts
import { Cause, Data, Effect, Match, Option, pipe } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class QueryError extends Data.TaggedError("QueryError")<{
  readonly operation: "select_account";
  readonly reason:    "transport" | "not_found";
  readonly cause?:    unknown;
}> {}
const queryTelemetry = {
  event: { boundaryCause: "query.boundary.cause" },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const selectRows = (accountId: string) =>
  Match.value(accountId).pipe(
    Match.when("transport", () => Effect.fail(new QueryError({ operation: "select_account", reason: "transport" }))),
    Match.when("none",      () => Effect.succeed([] as ReadonlyArray<{ readonly accountId: string; readonly status: "active" }>)),
    Match.orElse((value) => Effect.succeed([{ accountId: value, status: "active" as const }] as const)),
  );
const requireSingleRow = <A>(rows: ReadonlyArray<A>) =>
  pipe(
    Option.fromNullable(rows.at(0)),
    Option.match({
      onNone: () => Effect.dieMessage("Invariant violated: expected one row"),
      onSome: Effect.succeed,
    }),
  );
const strictLoad =   (accountId: string) => pipe(selectRows(accountId), Effect.flatMap(requireSingleRow));
const boundaryLoad = (accountId: string) =>
  strictLoad(accountId).pipe(
    Effect.catchAllCause((cause) =>
      Cause.failureOption(cause).pipe(
        Option.match({
          onNone: () => Effect.fail(new QueryError({ operation: "select_account", reason: "transport", cause })),
          onSome: Effect.fail,
        }))),
    Effect.tapErrorCause((cause) => Effect.logError(queryTelemetry.event.boundaryCause, { cause: Cause.pretty(cause) })),
  );
```

---
## [3][RECOVERY_AND_RETRY_NARROWING]
>**Dictum:** *Recovery is union reduction: each catch removes variants; retries run only on metadata-backed retryable variants.*

<br>

This section composes `catchTag` with schedule algebra so residual error rails remain explicit at each stage. Boundary tags collapse immediately to one exported rail (`BillingError`) before the function leaves this section.

```ts
import { Data, DateTime, Duration, Effect, Match, Schedule, pipe } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class BillingError extends Data.TaggedError("BillingError")<{
  readonly operation: "lookup_invoice";
  readonly reason: "invalid_input" | "not_found" | "throttled" | "upstream";
  readonly cause?: unknown;
}> {}
const billingReasonPolicy = {
  invalid_input: { retryable: false },
  not_found:     { retryable: false },
  throttled:     { retryable: true  },
  upstream:      { retryable: true  },
} as const satisfies Record<BillingError["reason"], { readonly retryable: boolean }>;
const toBillingPolicy = (reason: BillingError["reason"]) => billingReasonPolicy[reason];
const billingTelemetry = {
  event: { getInvoiceError: "billing.get_invoice.error" },
} as const;

// --- [FUNCTIONS] -------------------------------------------------------------

const retryPolicy = Schedule.exponential(Duration.millis(40)).pipe(Schedule.jittered, Schedule.intersect(Schedule.recurs(5)));
const lookupInvoice = (invoiceId: string) =>
  Match.value(invoiceId).pipe(
    Match.when("", () => Effect.fail(new BillingError({ operation: "lookup_invoice", reason: "invalid_input" }))),
    Match.when("404", () => Effect.fail(new BillingError({ operation: "lookup_invoice", reason: "not_found" }))),
    Match.when("429", () => Effect.fail(new BillingError({ operation: "lookup_invoice", reason: "throttled" }))),
    Match.when("503", () => Effect.fail(new BillingError({ operation: "lookup_invoice", reason: "upstream" }))),
    Match.orElse((value) => Effect.succeed({ invoiceId: value, amount: 1200 } as const)),
  );
const lookupWithPolicyRetry = (invoiceId: string) =>
  lookupInvoice(invoiceId).pipe(
    Effect.retry(retryPolicy.pipe(Schedule.whileInput((error: BillingError) => toBillingPolicy(error.reason).retryable))),
  );
const getInvoice = (invoiceId: string) =>
  pipe(
    lookupInvoice(invoiceId),
    Effect.catchTag("BillingError", (error) =>
      Match.value(error.reason).pipe(
        Match.when("not_found", () => Effect.succeed({ invoiceId, amount: 0, fallback: true } as const)),
        Match.when("throttled", () =>
          lookupWithPolicyRetry(invoiceId).pipe(
            Effect.mapError((cause) => new BillingError({ operation: "lookup_invoice", reason: "upstream", cause })),
          )),
        Match.when("invalid_input", () => Effect.fail(error)),
        Match.when("upstream", () => Effect.fail(error)),
        Match.exhaustive,
      ),
    ),
    Effect.tapBoth({
      onFailure: (error) => Effect.logWarning(billingTelemetry.event.getInvoiceError, { tag: error._tag, reason: error.reason }),
      onSuccess: () => Effect.void,
    }),
  );
const getInvoiceStamped = (invoiceId: string) =>
  getInvoice(invoiceId).pipe(
    Effect.zip(DateTime.now),
    Effect.map(([invoice, observedAt]) => ({ ...invoice, observedAt: DateTime.formatIso(observedAt) })),
  );
```

---
## [4][ACCUMULATION_CONTRACTS_WITH_STREAM_AND_CHUNK]
>**Dictum:** *`validateAll`, `validateFirst`, and `mode: "validate"` encode distinct error-retention contracts; choose one explicitly and document loss semantics.*

<br>

`Stream` handles ingestion, `Chunk` preserves decoded payload order, and `HashMap` projects residual reason frequency without widening rail vocabulary. This keeps accumulation policy explicit for bulk import and replay workflows.

```ts
import { Chunk, Clock, Data, Effect, HashMap, Match, Option, Schema as S, Stream, pipe } from "effect";

// --- [SCHEMA] ----------------------------------------------------------------

const RowSchema = S.Struct({
  tenantId: S.UUID,
  seats:    S.Number.pipe(S.int(), S.nonNegative()),
  plan:     S.Literal("free", "pro", "enterprise"),
});

// --- [ERRORS] ----------------------------------------------------------------

class ImportError extends Data.TaggedError("ImportError")<{
  readonly row:    number;
  readonly reason: "decode" | "policy";
  readonly cause?: unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const decodeRow = (value: unknown, row: number) =>
  pipe(
    S.decodeUnknown(RowSchema)(value),
    Effect.mapError((cause) => new ImportError({ row, reason: "decode", cause })),
    Effect.filterOrFail(
      (entry) => entry.seats <= 2000,
      (entry) => new ImportError({ row, reason: "policy", cause: entry.seats }),
    ),
  );
const decodeStream = (rows: ReadonlyArray<unknown>) =>
  pipe(
    Stream.fromIterable(rows),
    Stream.zipWithIndex,
    Stream.mapEffect(([value, row]) => decodeRow(value, row)),
    Stream.runCollect,
  );
const reasonHistogram = (errors: ReadonlyArray<ImportError>) =>
  errors.reduce(
    (acc, error) =>
      HashMap.set(
        acc,
        error.reason,
        pipe(
          HashMap.get(acc, error.reason),
          Option.match({
            onNone: () => 1,
            onSome: (value) => value + 1,
          }),
        ),
      ),
    HashMap.empty<ImportError["reason"], number>(),
  );
const allOrFailures =  (rows: ReadonlyArray<unknown>) => Effect.validateAll  (rows, decodeRow);
const firstValid =     (rows: ReadonlyArray<unknown>) => Effect.validateFirst(rows, decodeRow);
const residualMatrix = (rows: ReadonlyArray<unknown>) =>
  Effect.all(rows.map(decodeRow), { mode: "validate" }).pipe(
    Effect.match({
      onFailure: (residuals) =>
        residuals.map((residual, row) =>
          Option.match(residual, {
            onNone: () =>      ({ row, _tag: "ok" as const }),
            onSome: (error) => ({ row, _tag: "invalid" as const, reason: error.reason }),
          })),
      onSuccess: (values) => values.map((_, row) => ({ row, _tag: "ok" as const })),
    }),
  );
const ingest = (rows: ReadonlyArray<unknown>) =>
  Effect.all({ startedAtMs: Clock.currentTimeMillis, decoded: decodeStream(rows) }).pipe(
    Effect.match({
      onFailure: (error) =>                    ({ _tag: "invalid" as const, histogram: reasonHistogram([error]) }),
      onSuccess: ({ startedAtMs, decoded }) => ({ _tag: "ok" as const, startedAtMs, rows: Chunk.fromIterable(decoded) }),
    }),
  );
```

---
## [5][STM_TMAP_CONCURRENT_REASON_AGGREGATION]
>**Dictum:** *Concurrent error aggregation belongs in transactional rails when counter integrity matters under parallel writers.*

<br>

`STM` + `TMap` gives deterministic counter updates without lock choreography, then commits a stable `HashMap` snapshot into Effect land. Use this when accumulation must remain race-safe and replayable.

```ts
import { Data, Effect, HashMap, STM, TMap, pipe } from "effect";

// --- [ERRORS] ----------------------------------------------------------------

class IngestError extends Data.TaggedError("IngestError")<{
  readonly tenantId: string;
  readonly reason:   "decode" | "policy" | "upstream";
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const aggregateReasonsTx = (errors: ReadonlyArray<IngestError>) =>
  pipe(
    TMap.empty<string, number>(),
    STM.flatMap((counts) =>
      pipe(
        errors,
        STM.forEach((error) => TMap.merge(counts, `${error.tenantId}:${error.reason}`, 1, (left, right) => left + right)),
        STM.as(counts),
      )),
    STM.flatMap(TMap.toHashMap),
  );
const aggregateReasons = (errors: ReadonlyArray<IngestError>) =>
  aggregateReasonsTx(errors).pipe(
    STM.commit,
    Effect.map((counts) => ({ cardinality: HashMap.size(counts), counts } as const)),
  );
```

---
## [6][PLATFORM_BOUNDARY_TRANSLATION_RAIL]
>**Dictum:** *Transport mapping is a single exhaustive projection from domain rails to platform rails; decode errors and domain errors converge at the edge only.*

<br>

Collapse parse and domain failures into one reason rail, then project that rail to canonical platform errors (`BadRequest`, `NotFound`, `Conflict`, `ServiceUnavailable`) with explicit coverage. Reuse the same policy-table posture from Section 1: one canonical reason map, lookup dispatch, and exhaustive reason coverage. Keep the mapping total and status-stable (`conflict -> 409`) so handler behavior is deterministic.

```ts
import { Data, Effect, Match, Schema as S, pipe } from "effect";
import { HttpApiError } from "@effect/platform";

// --- [SCHEMA] ----------------------------------------------------------------

const InvoiceRequest = S.Struct({ invoiceId: S.String.pipe(S.nonEmptyString(), S.maxLength(1000)) });

// --- [ERRORS] ----------------------------------------------------------------

class BillingRail extends Data.TaggedError("BillingRail")<{
  readonly reason: "invalid_input" | "not_found" | "conflict" | "upstream";
  readonly cause?: unknown;
}> {}

// --- [FUNCTIONS] -------------------------------------------------------------

const decodeRequest = (input: unknown) =>
  S.decodeUnknown(InvoiceRequest)(input).pipe(
    Effect.mapError((cause) => new BillingRail({ reason: "invalid_input", cause })),
  );
const billingReasonPolicy = {
  invalid_input: () => new HttpApiError.BadRequest(undefined),
  not_found:     () => new HttpApiError.NotFound(undefined),
  conflict:      () => new HttpApiError.Conflict(undefined),
  upstream:      () => new HttpApiError.ServiceUnavailable(undefined),
} as const satisfies Record<
  BillingRail["reason"],
  () => HttpApiError.BadRequest | HttpApiError.NotFound | HttpApiError.Conflict | HttpApiError.ServiceUnavailable
>;
const toHttpError = (reason: BillingRail["reason"]) => billingReasonPolicy[reason]();
const routeProgram = (rawInput: unknown) =>
  pipe(
    decodeRequest(rawInput),
    Effect.flatMap(({ invoiceId }) =>
      Match.value(invoiceId).pipe(
        Match.when("404", () => Effect.fail(new BillingRail({ reason: "not_found" }))),
        Match.when("409", () => Effect.fail(new BillingRail({ reason: "conflict"  }))),
        Match.when("503", () => Effect.fail(new BillingRail({ reason: "upstream"  }))),
        Match.orElse((value) => Effect.succeed({ status: 200 as const, body: { invoiceId: value } })),
      ),
    ),
    Effect.mapError((error) => toHttpError(error.reason)),
  );
```
