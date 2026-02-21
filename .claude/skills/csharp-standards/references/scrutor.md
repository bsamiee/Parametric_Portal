# [H1][SCRUTOR]
>**Dictum:** *Scrutor turns DI composition into algebra: bounded discovery, explicit policy, deterministic decorator topology.*

<br>

Verified baseline (2026-02-21): `Scrutor` `7.0.0` with targets `net462`, `netstandard2.0`, `net8.0`, `net10.0`.<br>
Scrutor extends the built-in Microsoft container; it does not replace it.

**Imports**
- `using Microsoft.Extensions.DependencyInjection;` (`Scan`, `Decorate`, `TryDecorate`, keyed resolution APIs)
- `using Scrutor;` (`RegistrationStrategy`, `ReplacementBehavior`, `DecoratedService<T>`, `ServiceDescriptorAttribute`)
- `using Microsoft.Extensions.DependencyModel;` (`DependencyContext` selectors)

---
## [1][CAPABILITY_SURFACE]
>**Dictum:** *Use the full API deliberately; defaults are convenient but not deterministic at scale.*

<br>

| [INDEX] | [AREA]                    | [SURFACE]                                                                                                                                                                    |
| :-----: | :------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   [1]   | Assembly source selectors | `FromEntryAssembly`, `FromApplicationDependencies`, `FromAssemblyDependencies`, `FromDependencyContext`, `FromAssemblyOf<T>`, `FromAssembliesOf(...)`, `FromAssemblies(...)` |
|   [2]   | Type selection            | `AddClasses()`, `AddClasses(bool)`, `AddClasses(Action<IImplementationTypeFilter>)`, `AddClasses(Action<IImplementationTypeFilter>, bool)`                                   |
|   [3]   | Type filters              | `AssignableTo`, `AssignableToAny`, `WithAttribute`, `WithoutAttribute`, `InNamespaces`, `NotInNamespaces`, `Where`                                                           |
|   [4]   | Service mapping           | `AsSelf`, `As<T>`, `As(types)`, `AsImplementedInterfaces`, `AsSelfWithInterfaces`, `AsMatchingInterface`, `As(selector)`                                                     |
|   [5]   | Lifetime + key policy     | `WithSingletonLifetime`, `WithScopedLifetime`, `WithTransientLifetime`, `WithLifetime(...)`, `WithServiceKey(...)`                                                           |
|   [6]   | Registration strategy     | `RegistrationStrategy.Skip / Append / Throw / Replace(...)`, `ReplacementBehavior.ServiceType / ImplementationType / All`                                                    |
|   [7]   | Attribute registration    | `UsingAttributes`, `ServiceDescriptorAttribute`, `ServiceDescriptorAttribute<TService>`                                                                                      |
|   [8]   | Decoration                | `Decorate`/`TryDecorate` (generic/type/factory/strategy overloads), closed + open generics                                                                                   |
|   [9]   | Decorated handles         | `Decorate(..., out DecoratedService<T>)`, `GetRequiredDecoratedService`, `GetDecoratedServices`                                                                              |

```csharp
namespace App.Bootstrap;

using System;
using Microsoft.Extensions.DependencyInjection;
using Scrutor;

public static class CompositionGraph {
    public static IServiceCollection AddApplicationGraph(IServiceCollection services) =>
        services.Scan(scan => scan
            .FromAssembliesOf(typeof(CompositionGraph), typeof(IQueryHandler<,>))
            .AddClasses(classes => classes
                .AssignableToAny(typeof(ICommandHandler<>), typeof(IQueryHandler<,>))
                .NotInNamespaces("ParametricPortal.Experimental"))
            .UsingRegistrationStrategy(RegistrationStrategy.Replace(ReplacementBehavior.ServiceType))
            .AsImplementedInterfaces()
            .WithLifetime(static (Type type) =>
                type.Name.EndsWith("Cache", StringComparison.Ordinal)
                    ? ServiceLifetime.Singleton
                    : ServiceLifetime.Scoped));
}
```

---
## [2][DETERMINISTIC_DISCOVERY]
>**Dictum:** *Assembly predicates, keyed descriptors, and attributes are one surface for deterministic registration.*

<br>

`FromApplicationDependencies()` can fall back to entry-assembly dependency walking when `DependencyContext.Default` is unavailable. For strict graphs, prefer explicit `FromDependencyContext(...)` predicates.

`UsingAttributes()` reads `ServiceDescriptorAttribute` metadata, enforces assignability for explicit service types, and rejects duplicate `(ServiceType, ServiceKey)` tuples. `WithServiceKey(...)` and keyed resolution APIs should remain deterministic (stable key literals or collision-free selectors). By default, `AddClasses` excludes compiler-generated types; include them only via explicit attribute filters when that behavior is intentional.

```csharp
namespace App.Bootstrap;

using System;
using System.Reflection;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyModel;
using Scrutor;

[ServiceDescriptor(typeof(IReadStore), ServiceLifetime.Scoped, serviceKey: "read-store")]
public sealed class PostgresReadStore : IReadStore;

[ServiceDescriptor(typeof(IWriteStore), ServiceLifetime.Singleton)]
public sealed class WriteStore : IWriteStore;

public static class DeterministicDiscovery {
    public static IServiceCollection AddModules(IServiceCollection services, DependencyContext context) =>
        services
            .Scan(scan => scan
                .FromDependencyContext(
                    context,
                    static (Assembly assembly) =>
                        assembly.GetName().Name?.StartsWith("ParametricPortal.", StringComparison.Ordinal) == true)
                .AddClasses(classes => classes
                    .AssignableToAny(typeof(ICommandPipeline<>), typeof(IQueryPipeline<,>)))
                    .UsingRegistrationStrategy(RegistrationStrategy.Throw)
                    .AsImplementedInterfaces()
                    .WithServiceKey(static (Type type) => type.FullName ?? type.Name)
                    .WithScopedLifetime())
            .Scan(scan => scan
                .FromDependencyContext(
                    context,
                    static (Assembly assembly) =>
                        assembly.GetName().Name?.StartsWith("ParametricPortal.", StringComparison.Ordinal) == true)
                .AddClasses(classes => classes.WithAttribute<ServiceDescriptorAttribute>())
                    .UsingRegistrationStrategy(RegistrationStrategy.Throw)
                    .UsingAttributes());

    public static IReadStore ResolveReadStore(IServiceProvider provider) =>
        provider.GetRequiredKeyedService<IReadStore>("read-store");
}
```

---
## [3][DECORATOR_TOPOLOGY]
>**Dictum:** *Decoration order is architecture; optional decoration must surface as data, not exceptions.*

<br>

For open generic decoration, Scrutor decorates closed registrations compatible with the open definition; it does not decorate the open definition itself. `Decorate(...)` throws when no matching registration exists; `TryDecorate(...)` returns `false` for optional modules. Use `DecoratedService<T>` handles when topology must be verified.

```csharp
namespace App.Bootstrap;

using System.Collections.Generic;
using System.Linq;
using Microsoft.Extensions.DependencyInjection;
using Scrutor;

public static class DecoratorTopology {
    public static IServiceProvider BuildProvider(IServiceCollection services) {
        DecoratedService<ICommandBus> decoratedBus;
        DecoratedService<object> decoratedQueryHandlers;
        services.AddScoped<ICommandBus, CommandBus>();
        services.AddScoped(typeof(IQueryHandler<,>), typeof(QueryHandler<,>));
        services.Decorate<ICommandBus, MetricsCommandBus>(out decoratedBus);
        bool queryCachingApplied = services.TryDecorate(
            serviceType: typeof(IQueryHandler<,>),
            decoratorType: typeof(CachingQueryHandler<,>));
        services.Decorate(
            serviceType: typeof(IQueryHandler<,>),
            decoratorType: typeof(TracingQueryHandler<,>),
            out decoratedQueryHandlers);
        IServiceProvider provider = services.BuildServiceProvider(new ServiceProviderOptions {
            ValidateOnBuild = true,
            ValidateScopes = true
        });
        ICommandBus underlyingBus = provider.GetRequiredDecoratedService(decoratedBus);
        IEnumerable<object> queryLayers = provider.GetDecoratedServices(decoratedQueryHandlers).ToArray();
        _ = (queryCachingApplied, underlyingBus, queryLayers);
        return provider;
    }
}
```

---
## [4][COMPOSITION_ROOT_GATE]
>**Dictum:** *Registration belongs in composition roots; domain pipelines stay runtime-agnostic.*

<br>

```csharp
namespace App.Bootstrap;

using System;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyModel;

public static class RuntimeProvider {
    public static IServiceProvider Build(Action<IServiceCollection> externalModules) {
        IServiceCollection services = new ServiceCollection();
        externalModules(services);
        CompositionGraph.AddApplicationGraph(services);
        DeterministicDiscovery.AddModules(
            services,
            context: DependencyContext.Default
                ?? throw new InvalidOperationException("DependencyContext.Default unavailable."));
        return DecoratorTopology.BuildProvider(services);
    }
}
```

---
## [5][RULES]
>**Dictum:** *Scrutor quality is determinism under change.*

<br>

- [ALWAYS] Bound scanning to explicit assemblies/namespaces.
- [ALWAYS] Choose `RegistrationStrategy` explicitly; default append behavior is drift-prone.
- [ALWAYS] Prefer `RegistrationStrategy.Throw` for strict modules and `Replace(...)` only with explicit replacement intent.
- [ALWAYS] Remember `Replace()` defaults to `ReplacementBehavior.ServiceType`; use `ImplementationType` only when preserving sibling implementations is intentional.
- [ALWAYS] Use deterministic key selectors or stable literals with `WithServiceKey(...)`.
- [ALWAYS] Validate provider build via `ValidateOnBuild` + `ValidateScopes`.
- [ALWAYS] Capture `DecoratedService<T>` when decorator order or underlying instances matter.
- [ALWAYS] Use `Decorate` for required decorator topology and `TryDecorate` only for genuinely optional modules.
- [ALWAYS] Keep Scrutor usage in composition roots/boundary adapters; never in domain transforms.
- [NEVER] Pull compiler-generated types into scans unless an explicit attribute filter documents that intent.
- [NEVER] Use `FromApplicationDependencies()` without a predicate in large solutions.
- [NEVER] Mix broad scan blocks with ad-hoc manual overrides without explicit strategy boundaries.
- [NEVER] Encode service-variant routing with imperative branching when keyed registration resolves it structurally.
