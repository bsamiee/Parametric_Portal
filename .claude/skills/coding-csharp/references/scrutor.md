# [H1][SCRUTOR]
>**Dictum:** *Scrutor turns DI composition into algebra: bounded discovery, explicit policy, deterministic decorator topology.*

<br>

Verified baseline: `Scrutor` `7.0.0` targeting `net462`, `netstandard2.0`, `net8.0` (`net8.0` is the highest published target; newer runtimes consume it via forward compatibility). Extends the built-in Microsoft container via `Scan` + `Decorate`/`TryDecorate` on `IServiceCollection`. v6.0+ `AddClasses()` scans only public non-abstract classes by default; pass `publicOnly: false` to include internal types. Imports: `using Scrutor;` (`RegistrationStrategy`, `ReplacementBehavior`, `DecoratedService<T>`, `ServiceDescriptorAttribute`).

---
## [1][BOUNDED_DISCOVERY]
>**Dictum:** *Assembly predicates and type filters are the first defense against registration drift.*

<br>

`FromDependencyContext(context, predicate)` is the strict path -- explicit context, no silent fallback. `FromApplicationDependencies()` falls back to entry-assembly dependency walking when `DependencyContext.Default` is unavailable, silently narrowing the scan and swallowing assembly load failures. Filter methods chain intersectively (AND semantics); use `AssignableToAny(...)` for union semantics. `WithLifetime(Func<Type, ServiceLifetime>)` enables per-type lifetime resolution without multiple scan blocks.

```csharp
namespace App.Bootstrap;

using System;
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyModel;
using Scrutor;

public static class ModuleDiscovery {
    public static IServiceCollection AddBoundedModules(
        IServiceCollection services, DependencyContext context) =>
        services.Scan(scan => scan
            .FromDependencyContext(
                context,
                static (Assembly assembly) =>
                    assembly.GetName().Name?.StartsWith(
                        "ParametricPortal.", StringComparison.Ordinal) == true)
            .AddClasses(classes => classes
                .AssignableToAny(typeof(ICommandHandler<>), typeof(IQueryHandler<,>))
                .NotInNamespaces("ParametricPortal.Experimental"))
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .AsImplementedInterfaces()
            .WithLifetime(static (Type type) =>
                type.Name.EndsWith("Cache", StringComparison.Ordinal)
                    ? ServiceLifetime.Singleton
                    : ServiceLifetime.Scoped));
}
```

[CRITICAL]: `AssignableTo<T>().AssignableTo<U>()` yields types implementing BOTH (intersective `IntersectWith`). Use `AssignableToAny(typeof(T), typeof(U))` for types implementing EITHER. `InNamespaces` uses prefix matching (hierarchical); `InExactNamespaces` uses exact matching only.

---
## [2][REGISTRATION_STRATEGY]
>**Dictum:** *Default append is drift-prone; explicit strategy is the only deterministic path.*

<br>

| [INDEX] | [STRATEGY]     | [MECHANISM]                          | [WHEN]                                              |
| :-----: | :------------- | :----------------------------------- | :-------------------------------------------------- |
|   [1]   | `Append`       | `services.Add`                       | Multiple implementations of same interface          |
|   [2]   | `Skip`         | `services.TryAdd`                    | Plugin systems; first-wins (ServiceType check only) |
|   [3]   | `Throw`        | `DuplicateTypeRegistrationException` | Strict modules -- duplicates indicate config bugs   |
|   [4]   | `Replace(...)` | Remove matching, then add            | Explicit override of default implementations        |

`ReplacementBehavior` is a `[Flags]` enum: `ServiceType` (1) matches by registered service type, `ImplementationType` (2) matches by concrete type, `All` (3) matches either. `Replace()` with no argument defaults to `ServiceType`. `Skip` checks ServiceType only -- silently drops a second implementation of the same interface even when the concrete type differs.

```csharp
namespace App.Bootstrap;

using Microsoft.Extensions.DependencyInjection;
using Scrutor;

public static class StrategyExamples {
    // Strict: duplicates throw at startup
    public static IServiceCollection AddStrictModule(IServiceCollection services) =>
        services.Scan(scan => scan
            .FromAssemblyOf<StrategyExamples>()
            .AddClasses(classes => classes.AssignableTo<IDomainService>())
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .AsImplementedInterfaces()
            .WithScopedLifetime());
    // Override: replace implementation but preserve sibling registrations
    public static IServiceCollection OverrideDefaults(IServiceCollection services) =>
        services.Scan(scan => scan
            .FromAssemblyOf<StrategyExamples>()
            .AddClasses(classes => classes.AssignableTo<IOverride>())
            .UsingRegistrationStrategy(
                RegistrationStrategy.Replace(ReplacementBehavior.ImplementationType))
            .AsImplementedInterfaces()
            .WithScopedLifetime());
}
```

---
## [3][DECORATOR_TOPOLOGY]
>**Dictum:** *Decoration order is architecture; the last Decorate call wraps outermost.*

<br>

Decoration reads bottom-up: the final `Decorate` call produces the outermost wrapper. `Decorate` throws `DecorationException` when no matching registration exists; `TryDecorate` returns `false` for optional modules. Capture `DecoratedService<T>` via `out` parameter to verify topology at runtime -- internally backed by .NET 8+ keyed services with `+Decorated` suffix keys. `GetRequiredDecoratedService` resolves the pre-decoration inner; `GetDecoratedServices` yields all layers.

```csharp
namespace App.Bootstrap;

using Microsoft.Extensions.DependencyInjection;
using Scrutor;

// --- [CLOSED_GENERIC] --------------------------------------------------------

public static class ClosedDecoration {
    public static IServiceCollection AddDecoratedBus(IServiceCollection services) {
        DecoratedService<ICommandBus> busHandle;
        services.AddScoped<ICommandBus, CommandBus>();
        services.Decorate<ICommandBus, RetryCommandBus>();
        services.Decorate<ICommandBus, TracingCommandBus>(out busHandle);
        // Resolution order: TracingCommandBus -> RetryCommandBus -> CommandBus
        return services;
    }
}

// --- [OPEN_GENERIC] ----------------------------------------------------------

public static class OpenGenericDecoration {
    public static IServiceCollection AddDecoratedHandlers(IServiceCollection services) {
        services.AddScoped(typeof(IQueryHandler<,>), typeof(QueryHandler<,>));
        bool cachingApplied = services.TryDecorate(
            serviceType: typeof(IQueryHandler<,>),
            decoratorType: typeof(CachingQueryHandler<,>));
        services.Decorate(
            serviceType: typeof(IQueryHandler<,>),
            decoratorType: typeof(TracingQueryHandler<,>));
        return services;
    }
}
```

[IMPORTANT]: Open generic decoration targets closed registrations compatible with the open definition. Decorators with type constraints (e.g., `where TCmd : IAccessRestricted`) silently skip non-matching closed types via `MakeGenericType` catch -- correct since v4.0.0 but allocates `ArgumentException` per mismatch at startup. Factory-based decoration bypasses `ValidateOnBuild` -- prefer type-based decoration where container validation matters.

---
## [4][EFF_DECORATOR]
>**Dictum:** *Eff-wrapping decorators compose within the effect pipeline -- never collapse via Match and re-lift.*

<br>

When domain services return `Eff<RT,T>` (CSP0504), decorators must compose via `Map`/`MapFail`/`Bind` within the pipeline. The runtime-record pattern threads dependencies via `Eff<RT, T>.Asks` -- no `Has<RT>` interfaces. `Retry` uses algebraic `Schedule` combinators per `effects.md` [8].

```csharp
namespace App.Bootstrap;

using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;

// --- [CONTRACTS] -------------------------------------------------------------

public interface IOrderPipeline {
    Eff<OrderRuntime, OrderConfirmation> Execute(OrderRequest request);
}
public sealed record OrderRuntime(
    IOrderPipeline Orders, ActivitySource Tracing);

// --- [TRACING_DECORATOR] -----------------------------------------------------

public sealed class TracingOrderDecorator : IOrderPipeline {
    private readonly IOrderPipeline _inner;
    public TracingOrderDecorator(IOrderPipeline inner) => _inner = inner;
    public Eff<OrderRuntime, OrderConfirmation> Execute(OrderRequest request) =>
        from tracing in Eff<OrderRuntime, ActivitySource>.Asks(
            static (OrderRuntime rt) => rt.Tracing)
        let activity = tracing.StartActivity(name: "order.execute")
        from result in _inner.Execute(request: request)
            .Map((OrderConfirmation confirmation) => {
                activity?.SetTag("order.id", confirmation.OrderId);
                return confirmation;
            })
            .MapFail((Error error) => {
                activity?.SetStatus(ActivityStatusCode.Error, error.Message);
                return error;
            })
        select result;
}

// --- [RETRY_DECORATOR] -------------------------------------------------------

public sealed class RetryOrderDecorator : IOrderPipeline {
    private readonly IOrderPipeline _inner;
    public RetryOrderDecorator(IOrderPipeline inner) => _inner = inner;
    public Eff<OrderRuntime, OrderConfirmation> Execute(OrderRequest request) =>
        _inner.Execute(request: request)
            .Retry(schedule: Schedule.exponential(baseDelay: 100 * ms)
                | Schedule.recurs(times: 3)
                | Schedule.jitter(factor: 0.1));
}

// --- [REGISTRATION] ----------------------------------------------------------

public static class EffDecoratorGraph {
    public static IServiceCollection AddOrderPipeline(IServiceCollection services) {
        services.AddScoped<IOrderPipeline, OrderPipeline>();
        services.Decorate<IOrderPipeline, RetryOrderDecorator>();
        services.Decorate<IOrderPipeline, TracingOrderDecorator>();
        return services;
    }
}
```

[CRITICAL]: Decoration order: `OrderPipeline` -> `RetryOrderDecorator` -> `TracingOrderDecorator` (outermost observes retried result). Decorators compose within `Eff` via `Map`/`MapFail` -- collapsing via `Match` and re-lifting destroys monadic context and violates PREMATURE_MATCH_COLLAPSE (see `patterns.md`).

---
## [5][KEYED_REGISTRATION]
>**Dictum:** *Service keys encode variant routing structurally; keyed decoration requires explicit key matching.*

<br>

`ServiceDescriptorAttribute<TService>` enables attribute-driven keyed registration with compile-time service type validation. `UsingAttributes()` reads metadata, validates assignability, and rejects duplicate `(ServiceType, ServiceKey)` tuples. `AsSelfWithInterfaces()` registers the concrete type as itself AND forwards all interface resolutions to the same instance -- true singleton behavior across multiple interface resolves (unlike `AsImplementedInterfaces()` which creates independent registrations). Non-keyed decorators do NOT affect keyed services -- `CanDecorate` checks `ServiceKey` equality.

```csharp
namespace App.Bootstrap;

using System;
using Microsoft.Extensions.DependencyInjection;
using Scrutor;

// --- [ATTRIBUTE_DRIVEN] ------------------------------------------------------

[ServiceDescriptor<IReadStore>(ServiceLifetime.Scoped, serviceKey: "read-store")]
public sealed class PostgresReadStore : IReadStore;
[ServiceDescriptor<IWriteStore>(ServiceLifetime.Singleton)]
public sealed class WriteStore : IWriteStore;

// --- [VARIANT_ROUTING] -------------------------------------------------------

public static class KeyedDiscovery {
    public static IServiceCollection AddAttributeModules(IServiceCollection services) =>
        services.Scan(scan => scan
            .FromAssemblyOf<KeyedDiscovery>()
            .AddClasses(classes => classes.WithAttribute<ServiceDescriptorAttribute>())
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .UsingAttributes());
    public static IServiceCollection AddVariantProcessors(IServiceCollection services) =>
        services.Scan(scan => scan
            .FromAssemblyOf<KeyedDiscovery>()
            .AddClasses(classes => classes.AssignableTo<IPaymentProcessor>())
            .UsingRegistrationStrategy(RegistrationStrategy.Throw)
            .AsImplementedInterfaces()
            .WithServiceKey(static (Type type) => type.Name)
            .WithScopedLifetime());
    public static IReadStore ResolveReadStore(IServiceProvider provider) =>
        provider.GetRequiredKeyedService<IReadStore>("read-store");
}
```

[IMPORTANT]: `WithServiceKey` returns `ILifetimeSelector` -- chain key BEFORE lifetime: `.AsImplementedInterfaces().WithServiceKey("key").WithScopedLifetime()`. Key selectors returning `null` produce non-keyed registrations, enabling conditional keying within a single scan block.

---
## [6][RULES]
>**Dictum:** *Scrutor quality is determinism under change.*

<br>

- [ALWAYS] Bound scanning to explicit assemblies/namespaces via `FromDependencyContext` with predicates.
- [ALWAYS] Choose `RegistrationStrategy` explicitly per `Scan` block -- CSP0406 enforces `UsingRegistrationStrategy` on every `Scan` call in composition-root and boundary scopes.
- [ALWAYS] Prefer `RegistrationStrategy.Throw` for strict modules; `Replace(...)` only with explicit override intent.
- [ALWAYS] Validate provider build via `ValidateOnBuild = true` + `ValidateScopes = true`.
- [ALWAYS] Capture `DecoratedService<T>` via `out` parameter when decorator order or underlying instances matter at runtime.
- [ALWAYS] Use `Decorate` for required topology; `TryDecorate` only for genuinely optional modules.
- [ALWAYS] Keep Scrutor usage in composition roots/boundary adapters; never in domain transforms.
- [ALWAYS] Use deterministic key selectors or stable literals with `WithServiceKey(...)`.
- [NEVER] Use `FromApplicationDependencies()` without a predicate -- falls back silently, swallows load failures.
- [NEVER] Pull compiler-generated types into scans unless `WithAttribute<CompilerGeneratedAttribute>()` explicitly documents that intent.
- [NEVER] Mix broad scan blocks with ad-hoc manual overrides without explicit strategy boundaries.
- [NEVER] Encode service-variant routing with imperative branching when keyed registration resolves it structurally.
- [NEVER] Use factory-based decoration when type-based decoration suffices -- factories bypass `ValidateOnBuild`.
