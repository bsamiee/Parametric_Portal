# [H1][TESTING]
>**Dictum:** *Tests prove laws, guard allocations, verify boundaries, and detect surviving mutants.*

<br>

Testing methodology for LanguageExt v5 functional C# codebases. Property-based tests encode algebraic laws over domain primitives. Benchmark gates prevent allocation regressions. Integration tests use real infrastructure via Testcontainers. Mutation testing enforces kill-ratio thresholds. Snapshot approval captures serialized structure with deterministic scrubbing. All snippets assume `using static LanguageExt.Prelude;` and explicit types throughout -- no `var`, no `void`, no `null`.

---
## [1][PROPERTY_LAWS]
>**Dictum:** *Laws are mathematical truths independent of implementation; generators exercise the full domain.*

<br>

Property laws outperform example tests because laws are external oracles -- mathematical identities that hold regardless of implementation strategy. When a law breaks, the defect is in the code, never in the specification. Generators that route through production `Fin<T>` factories guarantee the test exercises the same validation boundary as callers, eliminating parallel construction paths that silently diverge under refactoring. FsCheck's shrinking then isolates the minimal counterexample, producing a regression test that encodes the exact boundary condition the implementation failed to honor.

```csharp
namespace Domain.Tests.Properties;

using FsCheck;
using FsCheck.Xunit;
using LanguageExt;
using static LanguageExt.Prelude;

// --- [GENERATORS] ------------------------------------------------------------

public static class DomainGenerators {
    public static Arbitrary<DomainIdentity> DomainIdentityArb() =>
        Arb.From(
            from guid in Arb.Generate<Guid>()
            where guid != Guid.Empty
            select DomainIdentity.Create(candidate: guid)
                .Match(Succ: (DomainIdentity identity) => identity,
                       Fail: (Error _) => throw new UnreachableException()));
    public static Arbitrary<TransactionAmount> TransactionAmountArb() =>
        Arb.From(
            Gen.OneOf(
                Gen.Choose(1, 1_000_000).Select((int raw) =>
                    TransactionAmount.Create(candidate: raw / 100.0m)
                        .Match(Succ: (TransactionAmount amount) => amount,
                               Fail: (Error _) => throw new UnreachableException())),
                Gen.Constant(TransactionAmount.Create(candidate: 0.01m)
                    .Match(Succ: (TransactionAmount amount) => amount,
                           Fail: (Error _) => throw new UnreachableException())),
                Gen.Constant(TransactionAmount.Create(candidate: 0.0001m)
                    .Match(Succ: (TransactionAmount amount) => amount,
                           Fail: (Error _) => throw new UnreachableException()))));
}

// --- [LAWS] ------------------------------------------------------------------

[Properties(Arbitrary = new[] { typeof(DomainGenerators) })]
public sealed class DomainIdentityLaws {
    [Property]
    public bool Identity_law_holds(Guid candidate) =>
        DomainIdentity.Create(candidate: candidate)
            .Map((DomainIdentity identity) => identity)
            .Equals(DomainIdentity.Create(candidate: candidate));
    [Property]
    public bool Closure_rejects_empty() =>
        DomainIdentity.Create(candidate: Guid.Empty).IsFail;
    [Property]
    public bool Roundtrip_preserves_value(DomainIdentity identity) =>
        DomainIdentity.Create(candidate: identity.Value)
            .Map((DomainIdentity recreated) => recreated.Value)
            .Match(Succ: (Guid value) => value == identity.Value,
                   Fail: (Error _) => false);
    // Monad law: Bind associativity -- (m >>= f) >>= g ≡ m >>= (x => f(x) >>= g)
    // Instantiated over Fin<DomainIdentity> with f = g = Create ∘ extract.
    [Property]
    public bool Bind_is_associative(DomainIdentity identity) {
        Fin<DomainIdentity> m = DomainIdentity.Create(candidate: identity.Value);
        Fin<DomainIdentity> left = m
            .Bind((DomainIdentity x) => DomainIdentity.Create(candidate: x.Value))
            .Bind((DomainIdentity x) => DomainIdentity.Create(candidate: x.Value));
        Fin<DomainIdentity> right = m
            .Bind((DomainIdentity x) =>
                DomainIdentity.Create(candidate: x.Value)
                    .Bind((DomainIdentity y) => DomainIdentity.Create(candidate: y.Value)));
        return left.Equals(right);
    }
}

[Properties(Arbitrary = new[] { typeof(DomainGenerators) })]
public sealed class TransactionAmountLaws {
    [Property]
    public bool Positive_amounts_succeed(PositiveInt raw) =>
        TransactionAmount.Create(candidate: (decimal)raw.Get / 100.0m).IsSucc;
    [Property]
    public bool Zero_and_negative_fail(NegativeInt raw) =>
        TransactionAmount.Create(candidate: (decimal)raw.Get).IsFail;
}

// --- [DU_TRANSITION_GENERATORS] ----------------------------------------------
// Gen.OneOf gives each variant equal probability; FsCheck shrinking targets
// the minimal counterexample within the chosen arm.

public static class TransitionGenerators {
    public static Arbitrary<TransactionState> TransactionStateArb() =>
        Arb.From(Gen.OneOf(
            from id in Arb.Generate<DomainIdentity>()
            from amt in Arb.Generate<TransactionAmount>()
            select (TransactionState)new TransactionState.Pending(
                Id: id, Amount: amt, InitiatedAt: SystemClock.Instance.GetCurrentInstant()),
            from id in Arb.Generate<DomainIdentity>()
            select (TransactionState)new TransactionState.Authorized(
                Id: id, AuthorizationToken: "tok-" + id.Value),
            from id in Arb.Generate<DomainIdentity>()
            select (TransactionState)new TransactionState.Settled(
                Id: id, ReceiptHash: "rcpt-" + id.Value),
            from id in Arb.Generate<DomainIdentity>()
            select (TransactionState)new TransactionState.Faulted(
                Id: id, Reason: Error.New(message: "test-fault"))));
    public static Arbitrary<UserId<Unvalidated>> UnvalidatedUserIdArb() =>
        Arb.From(
            from guid in Arb.Generate<Guid>()
            select UserIdOps.FromRaw(raw: guid));
}

// --- [DU_TRANSITION_LAWS] ----------------------------------------------------
// Laws encode algebraic properties of sealed DU state machines (types.md [4])
// and phantom-parameterized types (types.md [5]).

[Properties(Arbitrary = new[] { typeof(DomainGenerators), typeof(TransitionGenerators) })]
public sealed class TransactionTransitionLaws {
    // Law: terminal state absorption -- Authorize on Settled/Faulted always fails;
    // terminal states are absorbing under all transition attempts.
    [Property]
    public bool Terminal_absorbs_authorize(TransactionState state) =>
        state.IsTerminal switch {
            false => true, // non-terminal states are unconstrained -- skip
            true => state.Authorize(token: "any-token")
                .Match(Succ: (TransactionState _) => false,
                       Fail: (Error _) => true)
        };
    // Law: transition monotonicity -- once a state is terminal, IsTerminal
    // is stable across any reachable transition sequence. Applying Authorize
    // to a terminal state cannot produce a non-terminal successor.
    [Property]
    public bool Terminal_is_monotonic(TransactionState state) =>
        state.IsTerminal switch {
            false => true,
            true => state.Authorize(token: "probe")
                .Match(Succ: (TransactionState next) => next.IsTerminal,
                       Fail: (Error _) => true) // Fail is acceptable -- still terminal
        };
    // Law: idempotent authorization -- authorizing an already-authorized state
    // yields a structurally equal authorized value (equivalent under re-application).
    [Property]
    public bool Authorized_is_idempotent(TransactionState state) =>
        state switch {
            TransactionState.Authorized auth =>
                auth.Authorize(token: "ignored")
                    .Match(Succ: (TransactionState next) => next == auth,
                           Fail: (Error _) => false),
            _ => true // law applies only to Authorized variant
        };
}
[Properties(Arbitrary = new[] { typeof(TransitionGenerators) })]
public sealed class PhantomRoundtripLaws {
    // Law: phantom validation round-trip -- a validated UserId survives
    // Extract → Create cycle. The Fin<T> factory is the sole construction
    // path; round-tripping through it must preserve the value.
    [Property]
    public bool Validated_phantom_survives_roundtrip(UserId<Unvalidated> raw) =>
        UserIdOps.Validate(raw: raw)
            .Bind((UserId<Validated> validated) =>
                UserIdOps.Validate(raw: UserIdOps.FromRaw(raw: validated.Value)))
            .Match(Succ: (UserId<Validated> revalidated) => revalidated.Value == raw.Value,
                   Fail: (Error _) => raw.Value == Guid.Empty); // Empty fails both times -- consistent
}
```

[IMPORTANT]: Generators call production `Fin<T>` factories -- no parallel construction paths. `Match` in generators is acceptable infrastructure (not domain logic). `[Properties(Arbitrary = ...)]` registers custom arbitraries at the class level. Every smart constructor requires identity, closure, and roundtrip laws at minimum. DU transition laws encode absorption and monotonicity over sealed hierarchies -- these are algebraic invariants of the state machine, not implementation details. Phantom round-trip laws verify that the `Fin<T>` factory is the stable fixpoint of the validation boundary.

---
## [2][INTEGRATION_BOUNDARIES]
>**Dictum:** *Real infrastructure replaces mocks; containers are disposable; state resets between tests.*

<br>

Mocks lie about failure modes -- a mocked database never surfaces connection pool exhaustion, serialization conflicts, or constraint violations that manifest under production load. Testcontainers provisions real PostgreSQL instances per test class, ensuring the test exercises the same driver, wire protocol, and query planner as production. Respawn resets state between tests by truncating tables without dropping/recreating the schema, which is an order of magnitude faster than `EnsureDeleted`/`EnsureCreated` cycles. The combination guarantees isolation without sacrificing feedback speed.

```csharp
namespace Domain.Tests.Integration;

using Npgsql;
using Respawn;
using Testcontainers.PostgreSql;

// --- [FIXTURE] ---------------------------------------------------------------

public sealed class PostgresFixture : IAsyncLifetime {
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder()
        .WithImage(image: "postgres:17-alpine")
        .WithDatabase(database: "testdb")
        .WithUsername(username: "testuser")
        .WithPassword(password: "testpass")
        .Build();
    private Respawner _respawner = default!;
    public string ConnectionString => _container.GetConnectionString();
    public async Task InitializeAsync() {
        await _container.StartAsync();
        await using NpgsqlConnection connection = new(_container.GetConnectionString());
        await connection.OpenAsync();
        _respawner = await Respawner.CreateAsync(connection: connection,
            new RespawnerOptions { DbAdapter = DbAdapter.Postgres,
                                   SchemasToInclude = new[] { "public" } });
    }
    public async Task ResetAsync() {
        await using NpgsqlConnection connection = new(ConnectionString);
        await connection.OpenAsync();
        await _respawner.ResetAsync(connection: connection);
    }
    public async Task DisposeAsync() => await _container.DisposeAsync();
}

// --- [COLLECTION] ------------------------------------------------------------
// Required by xUnit to share PostgresFixture across test classes. Without this
// declaration each [Collection("Postgres")] class gets an isolated container.

[CollectionDefinition("Postgres")]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>;

// --- [TESTS] -----------------------------------------------------------------

[Collection("Postgres")]
public sealed class TransactionRepositoryTests : IAsyncLifetime {
    private readonly PostgresFixture _fixture;
    public TransactionRepositoryTests(PostgresFixture fixture) => _fixture = fixture;
    public Task InitializeAsync() => _fixture.ResetAsync();
    public Task DisposeAsync() => Task.CompletedTask;

    [Fact]
    public async Task Persist_and_retrieve_preserves_domain_identity() {
        await using NpgsqlConnection connection = new(_fixture.ConnectionString);
        await connection.OpenAsync();
        Guid rawId = Guid.NewGuid();
        DomainIdentity domainId = DomainIdentity.Create(candidate: rawId)
            .Match(Succ: (DomainIdentity id) => id,
                   Fail: (Error _) => throw new UnreachableException());
        NpgsqlCommand insert = connection.CreateCommand();
        insert.CommandText = "INSERT INTO transactions (id, amount, status) VALUES ($1, $2, $3)";
        insert.Parameters.AddWithValue(value: domainId.Value);
        insert.Parameters.AddWithValue(value: 100.0000m);
        insert.Parameters.AddWithValue(value: "pending");
        await insert.ExecuteNonQueryAsync();
        NpgsqlCommand select = connection.CreateCommand();
        select.CommandText = "SELECT id FROM transactions WHERE id = $1";
        select.Parameters.AddWithValue(value: domainId.Value);
        Guid retrieved = (Guid)(await select.ExecuteScalarAsync())!;
        Assert.Equal(expected: rawId, actual: retrieved);
    }
}
```

[IMPORTANT]: Each test class resets via `_fixture.ResetAsync()` in `InitializeAsync`. Respawn truncates all checkpoint tables without schema recreation. Testcontainers handles port allocation, image pulling, and cleanup automatically. `[Collection("Postgres")]` serializes test classes sharing the same container to prevent port conflicts.

---
## [2A][EFF_PIPELINES]
>**Dictum:** *Test runtime records are plain stubs; Fin-returning properties replace interface mocks.*

<br>

`Eff<RT,T>` pipelines require a test runtime record with stub property implementations. Construct the record inline; `Run()` collapses the effect to `Fin<T>` for assertion. `@catch` recovery paths require a second run with a stub that returns the trigger error.

```csharp
namespace Domain.Tests.Effects;

using LanguageExt;
using static LanguageExt.Prelude;

// --- [RUNTIME] ---------------------------------------------------------------

public sealed record TestRuntime(
    IGatewayProvider Gateway,
    IClock Clock,
    CancellationToken CancellationToken = default);

// Test stub that always succeeds
public sealed class StubGateway : IGatewayProvider {
    public Fin<TransactionState> Authorize(DomainIdentity id, string token) =>
        Fin.Succ<TransactionState>(new TransactionState.Authorized(Id: id, AuthorizationToken: token));
}

// Test stub that always fails with a specific error
public sealed class FaultingGateway : IGatewayProvider {
    public Fin<TransactionState> Authorize(DomainIdentity id, string token) =>
        Fin.Fail<TransactionState>(Error.New(message: "gateway-timeout"));
}

// --- [TESTS] -----------------------------------------------------------------

public sealed class AuthorizationPipelineTests {
    private static TestRuntime MakeRuntime(IGatewayProvider gateway) =>
        new(Gateway: gateway, Clock: SystemClock.Instance);

    [Fact]
    public void Success_path_returns_authorized_state() {
        Fin<TransactionState> result = AuthorizationPipeline
            .Authorize<TestRuntime>(id: SomeIdentity(), token: "tok-001")
            .Run(runtime: MakeRuntime(gateway: new StubGateway()));
        Assert.True(result.IsSucc);
    }

    // @catch recovery: stub triggers the error; pipeline must return fallback.
    [Fact]
    public void Gateway_timeout_falls_back_to_faulted_state() {
        Fin<TransactionState> result = AuthorizationPipeline
            .AuthorizeWithFallback<TestRuntime>(id: SomeIdentity(), token: "tok-001")
            .Run(runtime: MakeRuntime(gateway: new FaultingGateway()));
        result.Match(
            Succ: (TransactionState state) => Assert.IsType<TransactionState.Faulted>(state),
            Fail: (Error _) => throw new UnreachableException());
    }

    private static DomainIdentity SomeIdentity() =>
        DomainIdentity.Create(candidate: Guid.NewGuid())
            .Match(Succ: (DomainIdentity id) => id,
                   Fail: (Error _) => throw new UnreachableException());
}
```

[IMPORTANT]: Runtime records are plain `sealed record` -- no interfaces. `Run()` at test boundary is the only `Match`-adjacent operation. `@catch` recovery is verified by injecting the error-producing stub and asserting the fallback shape, not by inspecting the error channel.

---
## [3][QUALITY_GATES]
>**Dictum:** *Allocation budgets, mutation thresholds, and snapshot approval are CI-enforced invariants.*

<br>

Three complementary gates catch defects that unit tests cannot: allocation benchmarks detect GC pressure that compounds non-linearly under load (a 64-byte regression at 10K RPS becomes 640KB/sec of Gen0 pressure); mutation testing exposes surviving mutants where the test suite accepts semantically different code (untested behavior is unspecified behavior); snapshot approval catches structural drift in serialized contracts where field reordering or type changes silently break downstream consumers. Each gate enforces a distinct quality dimension -- running all three in CI provides defense in depth.

**Allocation benchmarks** -- BenchmarkDotNet with `[MemoryDiagnoser]` measures heap allocations per operation. CI parses JSON export and fails on regression:

```csharp
namespace Domain.Benchmarks;

using BenchmarkDotNet.Attributes;
using BenchmarkDotNet.Jobs;
using LanguageExt;
using static LanguageExt.Prelude;

// --- [BENCHMARKS] ------------------------------------------------------------

[MemoryDiagnoser]
[SimpleJob(RuntimeMoniker.Net10_0)]
public sealed class CollectionPipelineBenchmarks {
    private readonly Seq<int> _seqSource = toSeq(Enumerable.Range(start: 0, count: 10_000));
    private readonly int[] _arraySource = Enumerable.Range(start: 0, count: 10_000).ToArray();

    [Benchmark(Baseline = true)]
    public Seq<int> Seq_Choose_pipeline() =>
        _seqSource
            .Choose((int n) => n % 2 == 0 switch {
                true => Some(n * 3),
                false => None
            });

    [Benchmark]
    public int[] Linq_Where_Select_pipeline() =>
        _arraySource
            .Where((int n) => n % 2 == 0)
            .Select((int n) => n * 3)
            .ToArray();
}
```

```bash
dotnet run -c Release --project src/Domain.Benchmarks -- --exporters json
dotnet run --project tools/BenchmarkGate -- \
    --current artifacts/results/Domain.Benchmarks-report.json \
    --baseline benchmarks/baseline.json \
    --max-alloc-regression 10 --max-duration-regression 15
```

**Mutation testing** -- Stryker.NET mutates source and re-runs tests. Thresholds: `high` (80) is target, `low` (60) triggers investigation, `break` (50) fails the build. Exclude generated code and migrations -- mutating them produces false negatives:

```json
{
    "$schema": "https://raw.githubusercontent.com/stryker-mutator/stryker-net/master/src/Stryker.Core/Stryker.Core/stryker-config.schema.json",
    "stryker-config": {
        "project": "Domain.csproj",
        "test-projects": ["Domain.Tests.csproj"],
        "thresholds": { "high": 80, "low": 60, "break": 50 },
        "mutate": [
            "src/**/*.cs",
            "!src/**/Generated/**/*.cs",
            "!src/**/Migrations/**/*.cs"
        ],
        "reporters": ["html", "json", "dashboard"],
        "concurrency": 4,
        "language-version": "preview"
    }
}
```

**Snapshot approval** -- Verify serializes results against `.verified.txt` files. Scrubbers replace non-deterministic values with stable placeholders. `[ModuleInitializer]` configures scrubbing once per assembly:

```csharp
namespace Domain.Tests.Snapshots;

using NodaTime;
using VerifyXunit;

// --- [SETTINGS] --------------------------------------------------------------

public static class VerifyConfiguration {
    [ModuleInitializer]
    public static void Initialize() {
        VerifierSettings.ScrubMembersWithType<Instant>();
        VerifierSettings.ScrubMembersWithType<Guid>();
        VerifierSettings.DontScrubDateTimes();
        VerifierSettings.UseStrictJson();
    }
}

// --- [TESTS] -----------------------------------------------------------------

[UsesVerify]
public sealed class TransactionSnapshotTests {
    [Fact]
    public Task Pending_transaction_snapshot() {
        // Use a known-valid GUID to ensure deterministic success path
        Fin<DomainIdentity> identity = DomainIdentity.Create(
            candidate: Guid.Parse("550e8400-e29b-41d4-a716-446655440000"));
        Fin<TransactionAmount> amount = TransactionAmount.Create(candidate: 250.50m);
        IClock clock = SystemClock.Instance;
        Fin<TransactionState.Pending> pending =
            from id in identity
            from amt in amount
            select new TransactionState.Pending(
                Id: id, Amount: amt, InitiatedAt: clock.GetCurrentInstant());
        return pending.Match(
            Succ: (TransactionState.Pending state) => Verify(target: state),
            Fail: (Error error) => Verify(target: error));
    }
}
```

[CRITICAL]: Benchmark gates compare allocation regression percentage -- not absolute values -- to accommodate platform variance. Mutation testing runs on the domain layer only; `break: 50` fails unconditionally. Snapshot `.verified.txt` files are committed to source control and reviewed in PRs. `ScrubMembersWithType<Instant>()` replaces all temporal values with stable `Instant_1`, `Instant_2` placeholders.

---
## [4][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Property laws for every smart constructor -- identity, closure, roundtrip, and Bind associativity at minimum.
- [ALWAYS] DU variant generators use `Gen.OneOf` covering all arms -- never bypass private constructors.
- [ALWAYS] `Eff<RT,T>` pipelines use plain `sealed record` runtimes with stub properties -- no interface mocks, no `IHasCancel` hierarchy.
- [ALWAYS] FsCheck generators call production `Fin<T>` factories -- no parallel construction paths.
- [ALWAYS] Benchmark gates in CI with allocation regression thresholds -- `[MemoryDiagnoser]` on every benchmark class.
- [ALWAYS] Real infrastructure via Testcontainers over mocks -- Respawn for deterministic state reset.
- [ALWAYS] Mutation testing thresholds: `high: 80`, `low: 60`, `break: 50` -- domain layer only.
- [ALWAYS] Snapshot scrubbing for `Instant`, `Guid`, and all temporal/identity types via `ScrubMembersWithType<T>()`.
- [ALWAYS] Explicit types in test code -- `Fin<DomainIdentity>` not `var` -- tests are documentation.
- [NEVER] Mocks for infrastructure dependencies -- use Testcontainers, Respawn, and real adapters.
- [NEVER] Expected values derived from implementation -- property laws and external oracles only.
- [NEVER] Mutation testing on generated code or migrations -- exclude via `mutate` patterns.
- [NEVER] `var` in test declarations -- explicit types preserve intent across refactors.

---
## [5][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                  | [WHEN]                                  | [KEY_TRAIT]                                                |
| :-----: | :------------------------- | :-------------------------------------- | ---------------------------------------------------------- |
|   [1]   | **Property law**           | Smart constructor validation            | `Prop.ForAll` + `[Property]` attribute                     |
|   [2]   | **FsCheck generator**      | Domain primitive generation             | `Arb.From` + `Fin<T>` factory in generator                 |
|   [3]   | **Benchmark gate**         | Allocation regression detection         | `[MemoryDiagnoser]` + CI JSON threshold enforcement        |
|   [4]   | **Testcontainers fixture** | Real database integration test          | `PostgreSqlContainer` + `IAsyncLifetime`                   |
|   [5]   | **Respawn checkpoint**     | Deterministic state reset between tests | `Respawner.CreateAsync` + `ResetAsync`                     |
|   [6]   | **Stryker.NET config**     | Mutation testing threshold enforcement  | `break: 50` / `low: 60` / `high: 80` in stryker-config     |
|   [7]   | **Verify snapshot**        | Serialized structure approval           | `Verify(target)` + `.verified.txt` in source control       |
|   [8]   | **Scrubber configuration** | Non-deterministic value replacement     | `ScrubMembersWithType<Instant>()` in `[ModuleInitializer]` |
|   [9]   | **Eff test runtime**       | Testing `Eff<RT,T>` pipelines           | Plain `sealed record` runtime + stub `Fin<T>` properties   |
|  [10]   | **DU variant generator**   | Exhaustive PBT over sealed hierarchies  | `Gen.OneOf` with one arm per DU case                       |
