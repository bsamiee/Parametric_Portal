# Composition

## Composition Root and Lifetime Policy

Eagerly resolving scoped capabilities into an `Eff` runtime captures scope-bound references into a potentially longer-lived reader, producing the same captive dependency violation as injecting a scoped service into a singleton. The current pattern is a plain runtime record with explicit properties and `Eff<RT,T>.Asks`; do not resurrect v4 `Has<...>`/`Readable.asks` machinery.

```csharp
namespace Infra.Composition;

public sealed record AppRuntime(IServiceProvider Scope) {
    public IClock Clock => Scope.GetRequiredService<IClock>();
    public IObjectStore Store => Scope.GetRequiredService<IObjectStore>();
}

static Eff<AppRuntime, Unit> SyncClock() =>
    from clock in Eff<AppRuntime, IClock>.Asks(static (AppRuntime rt) => rt.Clock)
    from store in Eff<AppRuntime, IObjectStore>.Asks(static (AppRuntime rt) => rt.Store)
    from _     in liftEff(() => store.Put("last-sync", clock.UtcNow()))
    select unit;

public sealed class EffLifecycleHost(
    IServiceScopeFactory factory,
    Eff<AppRuntime, Unit> boot,
    Eff<AppRuntime, Unit> drain) : IHostedService {
    async Task RunScoped(Eff<AppRuntime, Unit> program, CancellationToken ct) {
        // BOUNDARY ADAPTER — AsyncServiceScope owns disposal; lifecycle faults propagate to host
        await using AsyncServiceScope scope = factory.CreateAsyncScope();
        using EnvIO envIO = EnvIO.New(token: ct);
        await program.RunUnsafeAsync(new AppRuntime(scope.ServiceProvider), envIO);
    }
    public Task StartAsync(CancellationToken ct) => RunScoped(boot, ct);
    public Task StopAsync(CancellationToken ct) => RunScoped(drain, ct);
}
```

- `Eff<AppRuntime,T>.Asks` defers resolution through explicit runtime-record properties; `SyncClock` demonstrates the payoff: multi-capability composition via LINQ comprehension without a service-locator surface leaking into the domain pipeline
- `RunScoped` captures `factory` (non-static, primary constructor parameter — startup-only, not hot-path) as the sole bridge: `CreateAsyncScope()` guarantees disposal under cancellation, `new AppRuntime(scope.ServiceProvider)` binds runtime to scope lifetime, `using EnvIO` owns the cancellation-linked environment, `RunUnsafeAsync` collapses `Error` into exceptions at the host boundary where `StartAsync`/`StopAsync` propagate failures as shutdown signals
- `boot`/`drain` are pre-composed Eff programs passed at registration — callers sequence via LINQ comprehension before the host sees them; `IHostedService` provides the two-phase contract (`StartAsync` forward, `StopAsync` reverse) without lifecycle ceremony

## Registration Governance and Resolution

Assembly scanning operates open-world — every public concrete type matching an interface predicate enters the service graph. Closing the registration surface requires three structural interlocks: a SmartEnum key vocabulary defining legal variants, attribute-driven key derivation binding each implementation to exactly one vocabulary member at scan time, and a completeness assertion rejecting startup when registered keys diverge from the vocabulary.

```csharp
namespace Infra.Composition;

[SmartEnum<string>] // Thinktecture.Runtime.Extensions — source-generated Get/Items/Switch
public sealed partial class BackendVariant {
    public static readonly BackendVariant Primary = new("primary", lifetime: ServiceLifetime.Singleton);
    public static readonly BackendVariant Replica = new("replica", lifetime: ServiceLifetime.Scoped);
    public static readonly BackendVariant Archive = new("archive", lifetime: ServiceLifetime.Scoped);
    public ServiceLifetime Lifetime { get; }
}

public sealed record RegistrationGap(Type ServiceType, Seq<BackendVariant> Missing)
    : Expected($"{ServiceType.Name} missing [{string.Join(", ", Missing)}]", code: 6001);

[AttributeUsage(AttributeTargets.Class)]
public sealed class BackendVariantAttribute(string key) : Attribute {
    public BackendVariant Variant { get; } = BackendVariant.Get(key);
}

public static class RegistrationGovernance {
    public static IServiceCollection ScanKeyed<TService>(
        this IServiceCollection services, Seq<Assembly> boundary) {
        services.Scan(scan => scan
            .FromAssemblies(boundary)
            .AddClasses(static (IImplementationTypeFilter f) =>
                f.AssignableTo<TService>()
                 .WithAttribute<BackendVariantAttribute>()
                 .InNamespaceOf<TService>())
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .AsImplementedInterfaces()
            .WithServiceKey(static (Type t) =>
                t.GetCustomAttribute<BackendVariantAttribute>()!.Variant)
            .WithLifetime(static (Type t) =>
                t.GetCustomAttribute<BackendVariantAttribute>()!.Variant.Lifetime));
        // BOUNDARY ADAPTER — Scrutor Scan is void-returning
        AssertComplete<TService>(services).ThrowIfFail();
        return services;
    }
    static Fin<Seq<BackendVariant>> AssertComplete<TService>(IServiceCollection services) {
        Seq<BackendVariant> registered = toSeq(services)
            .Filter(static (ServiceDescriptor d) =>
                d.IsKeyedService && d.ServiceType == typeof(TService))
            .Map(static (ServiceDescriptor d) => (BackendVariant)d.ServiceKey!);
        return toSeq(BackendVariant.Items)
            .Filter((BackendVariant v) => !registered.Contains(v))
            .Match(
                Empty: () => FinSucc(registered),
                Tail: static (BackendVariant h, Seq<BackendVariant> t) =>
                    FinFail<Seq<BackendVariant>>(new RegistrationGap(typeof(TService), cons(h, t))));
    }
}
```

- `BackendVariant` carries `ServiceLifetime` — the vocabulary IS the configuration; `WithLifetime(static t => ...Variant.Lifetime)` derives lifetime from the SmartEnum member, not hard-coded at the scan site. `BackendVariant.Get(key)` in the attribute constructor validates against the closed vocabulary at type-load time
- `RegistrationStrategy.Throw` fires when two implementations share a service-type/key pair at scan time; `InNamespaceOf<TService>()` fences the scan to the service's declaring namespace prefix, preventing cross-package types from entering the graph
- `AssertComplete` returns `Fin<Seq<BackendVariant>>` — the registered set is a validated projection, not just an assertion. `Filter` lambda captures `registered` (non-static — structurally required since the set-difference binds to the materialized scan result; startup-only allocation). `RegistrationGap` is a typed `Expected` fault carrying `ServiceType` and `Missing` as machine-routable structured data

## Cross-Cutting Decoration and Interception

Ad-hoc `Decorate` call sequences make interception order implicit in registration sequence — reordering any call silently changes chain topology without compiler feedback, and Scrutor's `Decorate<T>` predicate matches only non-keyed descriptors (`ServiceKey == null`), silently excluding every enum-keyed or object-keyed registration from the decoration pass.

```csharp
namespace Infra.Composition;

public readonly record struct StoreKey(StorageRegion Region, bool IsRaw);

[SmartEnum<string>]
public sealed partial class PipelineKey {
    public static readonly PipelineKey Store = new("store");
    public static readonly PipelineKey Database = new("database");
}

[SmartEnum<string>]
public sealed partial class Concern {
    public static readonly Concern Validation = new("validation",
        static (IObjectStore inner, IServiceProvider _) => new ValidatingStore(inner));
    public static readonly Concern Metrics = new("metrics",
        static (IObjectStore inner, IServiceProvider sp) =>
            new MetricsStore(inner, sp.GetRequiredService<IMeterFactory>()));
    public static readonly Concern Resilience = new("resilience",
        static (IObjectStore inner, IServiceProvider sp) =>
            new ResilientStore(inner, sp.GetRequiredKeyedService<ResiliencePipeline>(PipelineKey.Store)));
    public Func<IObjectStore, IServiceProvider, IObjectStore> Decorate { get; }
    private Concern(string key, Func<IObjectStore, IServiceProvider, IObjectStore> decorate)
        : this(key) { Decorate = decorate; }
}

public static class DecoratorChain {
    static readonly Seq<Concern> Ordering =
        toSeq(Concern.Items).Strict();
    public static IServiceCollection Assemble(IServiceCollection services) =>
        toSeq(Enum.GetValues<StorageRegion>())
            .Fold(
                Ordering.Fold(services,
                    static (IServiceCollection acc, Concern c) =>
                        acc.Decorate<IObjectStore>(c.Decorate)),
                static (IServiceCollection acc, StorageRegion region) =>
                    acc.AddKeyedSingleton<IObjectStore>(region,
                        (IServiceProvider sp, object? _) =>
                            Ordering.Fold(
                                sp.GetRequiredKeyedService<IObjectStore>(new StoreKey(region, IsRaw: true)),
                                (IObjectStore inner, Concern c) => c.Decorate(inner, sp))));
}
```

- `Concern` as `[SmartEnum]` carries its own `Decorate` factory — the vocabulary IS the projection; adding a concern forces a constructor argument, no dispatch table to forget. `Ordering` defaults to `Items` (declaration order), overridable by explicit `Seq` construction
- `Ordering.Fold(services, ...)` applies `Decorate` per concern in declaration sequence — Scrutor's `CanDecorate` checks `Equals(null, descriptor.ServiceKey)`, so only non-keyed descriptors match; the second fold manually replicates decoration over `StoreKey(region, IsRaw: true)` keyed raw services, bypassing Scrutor's predicate entirely
- `StoreKey` record struct replaces the `(region, "raw")` string sentinel — structural equality via compiler-generated `Equals`/`GetHashCode`, no string literals in the key vocabulary. Inner fold lambdas capture `sp` and `region` (both non-static) — `sp` is only available inside the factory delegate, `region` is the current fold element; startup-only allocation, not hot-path

## Runtime Drift

- `ValidateOnBuild = true` in `HostApplicationBuilderSettings` fires at `Build()` — catches unresolvable descriptors before first request; mandatory in all non-Development profiles
- `ValidateScopes = true` catches scoped-inside-singleton captive dependencies at resolution time — enable unconditionally; build-time validator misses factory-resolved transients capturing scoped services
- Descriptor count assertion at composition root end — expected cardinality vs `services.Count(d => d.ServiceType == typeof(T))` detects stale/duplicate registrations from scan drift
- `DecoratedService<T>.GetRequiredDecoratedService<T>()` traversal at startup health check — verifies expected decorator depth and ordering, detecting silent `TryDecorate` skip on non-string keys
- Configuration-bound profile assertion — `IHostEnvironment.EnvironmentName` must match vocabulary member; unknown values fail-fast at startup

## Rules

- [ALWAYS] Cross-cutting concerns via Scrutor decorators or middleware — never in-method duplication.
- [NEVER] Scoped service resolved inside singleton constructor or field.
- [ALWAYS] Single composition root per host entry point. No IServiceCollection manipulation after Build().
- [NEVER] Decorate/TryDecorate on non-string-keyed services without sentinel key workaround.
- [ALWAYS] Decorator ordering as fold over explicit concern sequence — never implicit registration order.
- [ALWAYS] ValidateOnBuild and ValidateScopes in all non-Development profiles.
- [NEVER] Runtime service location (GetService/GetRequiredService) in domain transforms — composition root responsibility only.
- [ALWAYS] Keyed service vocabularies are SmartEnum<T> — never raw strings. String literal keys forbidden outside test fixtures.
- [OVERLAP: effects.md] Resilience policies registered as keyed services, injected via decorators — effects.md owns pipeline definition, composition.md owns injection site.
- [OVERLAP: API boundary] Middleware/filter ordering is declared in the composition root; endpoint contracts live with the owning API module while this file owns pipeline topology.
