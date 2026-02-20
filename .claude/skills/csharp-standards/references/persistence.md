# [H1][PERSISTENCE]
>**Dictum:** *The database is an effect; DbContext belongs in the Eff shell; queries compose as expressions.*

<br>

EF Core persistence aligned with LanguageExt v5. DbContext access lifts into `Eff<RT,T>` via runtime records -- the persistence layer is an effectful shell around a relational kernel. Queries compose as `IQueryable<T>` expression trees that translate to SQL without materialization until boundaries. Value converters and owned-type configuration bridge the impedance mismatch between sealed DU hierarchies and relational columns. Repository algebras encode operations as data, eliminating method proliferation. All snippets assume `using static LanguageExt.Prelude;` and `using LanguageExt;`.

---
## [1][DBCONTEXT_AS_EFFECT]
>**Dictum:** *The database is an effect; DbContext belongs in the Eff shell.*

<br>

`Eff<RT,T>` wraps DbContext operations so that database access is explicit in the type signature -- callers cannot accidentally invoke SQL without acknowledging the effect. The runtime record carries `AppDbContext` as a property; `Eff<RT, T>.Asks` lifts the accessor into the pipeline. `IO.liftAsync` wraps async EF Core calls, keeping `async`/`await` confined to the `IO` boundary. Scope ownership belongs to the composition root -- never dispose context inside an `Eff` pipeline. Configure the provider once via `DbContextOptionsBuilder` with `EnableRetryOnFailure` for transient fault tolerance and `UseSnakeCaseNamingConvention` for PostgreSQL idiom.

```csharp
namespace Persistence.Context;

using Microsoft.EntityFrameworkCore;
using NodaTime;

// --- [RUNTIME] ---------------------------------------------------------------
public sealed record PersistenceRuntime(
    AppDbContext Database, IClock Clock, CancellationToken Token);

// --- [ACCESS] ----------------------------------------------------------------
public static class DbAccess {
    public static Eff<PersistenceRuntime, AppDbContext> ResolveContext =>
        Eff<PersistenceRuntime, AppDbContext>.Asks(
            static (PersistenceRuntime rt) => rt.Database);
    public static Eff<PersistenceRuntime, CancellationToken> ResolveToken =>
        Eff<PersistenceRuntime, CancellationToken>.Asks(
            static (PersistenceRuntime rt) => rt.Token);
    public static Eff<PersistenceRuntime, Seq<TEntity>> QueryAll<TEntity>(
        Func<AppDbContext, IQueryable<TEntity>> queryFactory) where TEntity : class =>
        from database in ResolveContext
        from token in ResolveToken
        from entities in liftIO(IO.liftAsync(
            async () => toSeq(await queryFactory(database).ToListAsync(token))))
        select entities;
}

// --- [CONFIGURATION] ---------------------------------------------------------
public static class ContextConfiguration {
    public static DbContextOptionsBuilder ConfigurePostgres(
        DbContextOptionsBuilder options, string connectionString) =>
        options.UseNpgsql(connectionString: connectionString,
            npgsqlOptionsAction: static (NpgsqlDbContextOptionsBuilder npgsql) =>
                npgsql.UseNodaTime().EnableRetryOnFailure(
                    maxRetryCount: 3, maxRetryDelay: TimeSpan.FromSeconds(value: 5),
                    errorCodesToAdd: null))
            .UseSnakeCaseNamingConvention();
    public static IO<Unit> ApplyMigrations(AppDbContext database) =>
        IO.liftAsync(async () => { await database.Database.MigrateAsync(); return unit; });
    public static ModelBuilder RegisterPostgresExtensions(ModelBuilder modelBuilder) =>
        modelBuilder.HasPostgresExtension(name: "uuid-ossp").HasPostgresExtension(name: "pg_trgm");
}

// --- [PIPELINE] --------------------------------------------------------------
public static class OrderPersistence {
    public static Eff<PersistenceRuntime, Seq<OrderEntity>> GetActiveOrders(TenantId tenantId) =>
        DbAccess.QueryAll((AppDbContext database) => database.Orders
            .Where((OrderEntity order) => order.TenantId == tenantId.Value)
            .Where(OrderFilters.IsActive)
            .OrderBy(static (OrderEntity order) => order.CreatedAt));
}
```

[IMPORTANT]: Runtime is a plain `sealed record` -- no interface indirection. `CancellationToken` lives on the runtime so `Eff` pipelines resolve it implicitly via `ResolveToken` (see `concurrency.md` [4] -- token threading). `IO.liftAsync` keeps `async`/`await` inside the `IO` boundary. `MigrateAsync` is idempotent -- schema rollback is always a new forward migration; `Down()` is unreliable in production. `EnableRetryOnFailure` handles transient PostgreSQL errors (connection drops, deadlocks) with exponential backoff.

---
## [2][QUERY_COMPOSITION]
>**Dictum:** *Queries compose as expressions; materialization happens at boundaries.*

<br>

`IQueryable<T>` composition builds server-evaluated expression trees without touching application memory -- the critical distinction from `IEnumerable<T>` LINQ. Reusable WHERE clauses are `Expression<Func<T, bool>>` values that compose via `.Where()` chaining. Keyset pagination outperforms offset pagination at scale because `OFFSET N` forces the database to scan and discard N rows on every page, while keyset uses an indexed `WHERE id > cursor` seek. Read projections use `.Select()` to push column selection to SQL and `AsNoTracking()` to skip the change tracker, which eliminates the identity map overhead that doubles memory for read-only queries.

```csharp
namespace Persistence.Queries;

using System.Linq.Expressions;
using NodaTime;

// --- [EXPRESSIONS] -----------------------------------------------------------
public interface IHasId { Guid Id { get; } }

public static class OrderFilters {
    public static readonly Expression<Func<OrderEntity, bool>> IsActive =
        static (OrderEntity order) => order.DeletedAt == null;
    public static Expression<Func<OrderEntity, bool>> BelongsToTenant(TenantId tenantId) =>
        (OrderEntity order) => order.TenantId == tenantId.Value;
}

// --- [KEYSET_PAGINATION] -----------------------------------------------------
public static class KeysetPagination {
    public static Eff<PersistenceRuntime, (Seq<TEntity> Items, bool HasNext)>
        GetPage<TEntity>(IQueryable<TEntity> source, Option<Guid> cursor, int pageSize)
        where TEntity : class, IHasId =>
        from token in DbAccess.ResolveToken
        from results in liftIO(IO.liftAsync(async () => {
            IQueryable<TEntity> ordered = source.OrderBy(static (TEntity entity) => entity.Id);
            IQueryable<TEntity> query = cursor
                .Map((Guid cursorId) => ordered.Where((TEntity entity) => entity.Id > cursorId))
                .IfNone(ordered)
                .Take(pageSize + 1);
            Seq<TEntity> fetched = toSeq(await query.ToListAsync(token));
            bool hasNext = fetched.Count > pageSize;
            return (Items: hasNext ? fetched.Take(pageSize) : fetched, HasNext: hasNext);
        }))
        select results;
}

// --- [READ_PROJECTIONS] ------------------------------------------------------
public readonly record struct OrderSummaryDto(
    Guid Id, string CustomerName, decimal TotalAmount, string Status, Instant CreatedAt);

public static class OrderProjections {
    public static IQueryable<OrderSummaryDto> ProjectToSummary(IQueryable<OrderEntity> source) =>
        source.Select(static (OrderEntity order) => new OrderSummaryDto(
            Id: order.Id, CustomerName: order.Customer.Name,
            TotalAmount: order.LineItems.Sum(static (LineItemEntity item) => item.Amount),
            Status: order.StatusDiscriminator, CreatedAt: order.CreatedAt));
    public static Eff<PersistenceRuntime, Seq<OrderSummaryDto>> GetRecentOrders(
        TenantId tenantId, int limit) =>
        from database in DbAccess.ResolveContext
        from token in DbAccess.ResolveToken
        from summaries in liftIO(IO.liftAsync(async () =>
            toSeq(await ProjectToSummary(source: database.Orders.AsNoTracking()
                    .Where(OrderFilters.BelongsToTenant(tenantId: tenantId))
                    .Where(OrderFilters.IsActive)
                    .OrderByDescending(static (OrderEntity order) => order.CreatedAt).Take(limit))
                .ToListAsync(token))))
        select summaries;
}

// --- [MATERIALIZED_REFRESH] --------------------------------------------------
// PostgreSQL REFRESH MATERIALIZED VIEW does not accept WHERE -- it always
// performs a full refresh. For tenant-scoped refresh, invoke a DB function
// defined in a migration (CREATE OR REPLACE FUNCTION ... that rebuilds only
// the target tenant's rows in the summary table within a transaction).
public static class ViewRefresh {
    public static Eff<PersistenceRuntime, Unit> RefreshDashboardMetrics(TenantId tenantId) =>
        from database in DbAccess.ResolveContext
        from token in DbAccess.ResolveToken
        from _ in liftIO(IO.liftAsync(async () => {
            await database.Database.ExecuteSqlAsync(
                $"SELECT refresh_dashboard_metrics_for_tenant({tenantId.Value})",
                cancellationToken: token).ConfigureAwait(false);
            return unit;
        }))
        select unit;
}
```

[CRITICAL]: Keyset pagination fetches `pageSize + 1` rows to determine `hasNext` without a COUNT query -- COUNT on large tables forces a sequential scan in PostgreSQL. Expression trees execute server-side; `.Select()` pushes column selection to SQL; `AsNoTracking()` skips the change tracker. Write models use OCC via `RowVersion`/`UpdatedAt` -- never mix tracked and untracked entities in the same pipeline.

---
## [3][TYPE_MAPPING]
>**Dictum:** *The database schema speaks primitives; the domain speaks types.*

<br>

`ValueConverter<TModel, TProvider>` bridges domain primitives and DU variants to relational columns -- the converter is the only place where the domain type system touches the storage schema. DU variants map to string discriminators via switch expressions; `Instant` maps to `DateTimeOffset` via NodaTime's lossless conversion. `OwnsOne` maps value objects to parent table columns (table splitting), eliminating the need for a separate join while keeping the domain model compositional. `OwnsMany` maps collections to a child table with automatic cascade. Value objects are `readonly record struct` with no identity and no `DbSet<T>` -- EF Core handles their lifecycle within the aggregate root.

```csharp
namespace Persistence.TypeMapping;

using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using NodaTime;
using System.Text.Json;

// --- [DOMAIN_PRIMITIVE_CONVERTER] --------------------------------------------
public sealed class DomainIdentityConverter : ValueConverter<DomainIdentity, Guid> {
    public DomainIdentityConverter() : base(
        convertToProviderExpression: static (DomainIdentity identity) => identity.Value,
        convertFromProviderExpression: static (Guid raw) => DomainIdentity.Create(candidate: raw)
            .Match(
                Succ: static (DomainIdentity valid) => valid,
                Fail: (Error error) => throw new InvalidOperationException(
                    $"Failed to reconstitute DomainIdentity from stored value {raw}: {error}"))) { }
}

// --- [INSTANT_CONVERTER] -----------------------------------------------------
public sealed class InstantConverter : ValueConverter<Instant, DateTimeOffset> {
    public InstantConverter() : base(
        convertToProviderExpression: static (Instant instant) => instant.ToDateTimeOffset(),
        convertFromProviderExpression: static (DateTimeOffset dto) =>
            Instant.FromDateTimeOffset(dateTimeOffset: dto)) { }
}

// --- [DU_DISCRIMINATOR_CONVERTER] --------------------------------------------
// Expression trees (CS8514) prohibit switch expressions; promote to static methods.
public sealed class TransactionStatusConverter : ValueConverter<TransactionState, string> {
    public TransactionStatusConverter() : base(
        convertToProviderExpression: static (TransactionState state) => ToDiscriminator(state),
        convertFromProviderExpression: static (string discriminator) => FromDiscriminator(discriminator)) { }
    private static string ToDiscriminator(TransactionState state) => state switch {
        TransactionState.Pending => "pending", TransactionState.Authorized => "authorized",
        TransactionState.Settled => "settled", TransactionState.Faulted => "faulted",
        _ => throw new UnreachableException()
    };
    private static TransactionState FromDiscriminator(string discriminator) => discriminator switch {
        "pending" => new TransactionState.Pending(),
        "authorized" => new TransactionState.Authorized(),
        "settled" => new TransactionState.Settled(), "faulted" => new TransactionState.Faulted(),
        _ => throw new UnreachableException()
    };
}

// --- [JSON_COLUMN_CONVERTER] -------------------------------------------------
public sealed class JsonColumnConverter<T> : ValueConverter<T, string> where T : class {
    public JsonColumnConverter() : base(
        convertToProviderExpression: static (T value) =>
            JsonSerializer.Serialize(value, JsonSerializerOptions.Default),
        convertFromProviderExpression: static (string json) =>
            JsonSerializer.Deserialize<T>(json, JsonSerializerOptions.Default)
                ?? throw new InvalidOperationException(
                    $"Failed to deserialize JSON column to {typeof(T).FullName}")) { }
}

// --- [VALUE_OBJECTS] ---------------------------------------------------------
public readonly record struct Address(string Street, string City, string PostalCode, string Country);
public readonly record struct AuditStamp(Instant OccurredAt, string ActorId);

// --- [OWNED_CONFIGURATION] ---------------------------------------------------
public static readonly Action<EntityTypeBuilder<CustomerEntity>> ConfigureCustomer =
    static (EntityTypeBuilder<CustomerEntity> builder) => {
        builder.HasKey(static (CustomerEntity customer) => customer.Id);
        builder.OwnsOne(static (CustomerEntity customer) => customer.BillingAddress,
            static (OwnedNavigationBuilder<CustomerEntity, Address> address) => {
                address.Property(static (Address addr) => addr.Street)
                    .HasColumnName(name: "billing_street").HasMaxLength(maxLength: 200);
                address.Property(static (Address addr) => addr.City)
                    .HasColumnName(name: "billing_city").HasMaxLength(maxLength: 100);
            });
        builder.OwnsMany(static (CustomerEntity customer) => customer.OrderHistory,
            static (OwnedNavigationBuilder<CustomerEntity, AuditStamp> audit) => {
                audit.ToTable(name: "customer_order_history");
                audit.Property(static (AuditStamp stamp) => stamp.OccurredAt)
                    .HasConversion<InstantConverter>();
            });
    };
```

[IMPORTANT]: Register converters via `.HasConversion<DomainIdentityConverter>()`, `.HasConversion<InstantConverter>()`, `.HasConversion<JsonColumnConverter<T>>().HasColumnType("jsonb")`. Configuration uses `Action<EntityTypeBuilder<T>>` lambdas to avoid `IEntityTypeConfiguration<T>` methods. `_ => throw new UnreachableException()` is the permitted defensive arm until C# ships first-class DU exhaustiveness. Value objects (`readonly record struct` with `OwnsOne`/`OwnsMany`) are persistence-layer composites with no identity -- distinct from domain primitives (`DomainIdentity`, `TenantId`) which are branded scalars mapped via `ValueConverter`.

---
## [4][REPOSITORY_ALGEBRA]
>**Dictum:** *Repositories are interpreters; queries are data.*

<br>

Sealed DU query algebra encodes repository operations as data -- adding a new query shape means adding a case, not a method signature that ripples through interfaces and implementations. The `Fold` catamorphism provides exhaustive dispatch: the compiler enforces that every interpreter handles every case. This inverts the expression problem: new operations require updating all interpreters (visible at compile time), while new interpreters require zero changes to the algebra. Contrast with `IRepository<T>` where adding `GetByPredicate` forces changes to every implementation with no compiler safety net.

```csharp
namespace Persistence.Algebra;

using System.Linq.Expressions;

// --- [QUERY_ALGEBRA] ---------------------------------------------------------
public abstract record RepoQuery<TKey, TEntity, TResult> where TEntity : class {
    private protected RepoQuery() { }
    public sealed record GetById(TKey Id) : RepoQuery<TKey, TEntity, Option<TEntity>>;
    public sealed record GetByPredicate(Expression<Func<TEntity, bool>> Predicate)
        : RepoQuery<TKey, TEntity, Seq<TEntity>>;
    public sealed record GetPage(
        Expression<Func<TEntity, bool>> Predicate, Option<TKey> Cursor, int PageSize)
        : RepoQuery<TKey, TEntity, (Seq<TEntity> Items, bool HasNext)>;
    public sealed record Exists(TKey Id) : RepoQuery<TKey, TEntity, bool>;
    // SAFETY: _ arm unreachable -- sealed hierarchy exhaustive
    public TFold Fold<TFold>(
        Func<GetById, TFold> onGetById, Func<GetByPredicate, TFold> onGetByPredicate,
        Func<GetPage, TFold> onGetByPage, Func<Exists, TFold> onExists) =>
        this switch {
            GetById query => onGetById(arg: query),
            GetByPredicate query => onGetByPredicate(arg: query),
            GetPage query => onGetByPage(arg: query),
            Exists query => onExists(arg: query),
            _ => throw new UnreachableException()
        };
}
```

[CRITICAL]: Interpreter maps: `GetById` to `FindAsync` + `Optional`, `GetByPredicate` to `.Where().ToListAsync()` + `toSeq`, `GetPage` to `KeysetPagination.GetPage`, `Exists` to `AnyAsync`. All async calls lift via `IO.liftAsync`. The `private protected` constructor prevents external subtypes from breaking exhaustiveness. See `composition.md` [5] for the algebraic compression pattern.

---
## [5][RULES]
>**Dictum:** *Rules compress into constraints.*

<br>

- [ALWAYS] Wrap DbContext access in `Eff<RT,T>` via runtime record -- database operations are effects.
- [ALWAYS] Compose queries as `IQueryable<T>` expression trees -- materialize to `Seq<T>` at boundaries only.
- [ALWAYS] Use `ValueConverter<TModel, TProvider>` for domain primitive and DU column mapping.
- [ALWAYS] Map value objects via `OwnsOne`/`OwnsMany` -- no identity, no `DbSet<T>`.
- [ALWAYS] Encode repository operations as sealed DU query algebra with `Fold` catamorphism.
- [ALWAYS] Keyset pagination: `OrderBy(entity.Id).Where(entity.Id > cursor).Take(pageSize + 1)`.
- [ALWAYS] Read projections use `AsNoTracking()` and `.Select()` for SQL push-down.
- [ALWAYS] Migrations are idempotent and append-only -- rollback is a new forward migration.
- [ALWAYS] `EnableRetryOnFailure` on `NpgsqlDbContextOptionsBuilder` for transient fault tolerance.
- [NEVER] Materialize `IQueryable<T>` mid-composition -- `ToListAsync`/`ToSeq` at boundary only.
- [NEVER] Expose `DbContext` outside persistence -- consumers use `Eff<RT,T>` pipelines.
- [NEVER] Navigation property eager loading in read projections -- `.Select()` suffices.
- [NEVER] Offset pagination on large tables -- `OFFSET N` forces sequential scan; use keyset.
- [NEVER] `IEntityTypeConfiguration<T>` with override methods -- use `Action<EntityTypeBuilder<T>>` lambdas.

---
## [6][QUICK_REFERENCE]

| [INDEX] | [PATTERN]                | [WHEN]                                   | [KEY_TRAIT]                                |
| :-----: | :----------------------- | :--------------------------------------- | :----------------------------------------- |
|   [1]   | **DbContext as Eff**     | Database access in effect pipeline       | `Eff<RT,T>.Asks` + `IO.liftAsync`          |
|   [2]   | **Query composition**    | Reusable WHERE clauses                   | `Expression<Func<T, bool>>` + `IQueryable` |
|   [3]   | **Keyset pagination**    | Cursor-based paging without COUNT        | `OrderBy.Where(Id > cursor).Take(N+1)`     |
|   [4]   | **Read projection**      | CQRS read model DTO                      | `AsNoTracking` + `.Select()` push-down     |
|   [5]   | **Value converters**     | Domain type to database column mapping   | `ValueConverter<TModel, TProvider>`        |
|   [6]   | **JSON column**          | Complex value object in single column    | `JsonColumnConverter<T>` + `jsonb`         |
|   [7]   | **Owned types**          | Value object persistence                 | `OwnsOne` (split) / `OwnsMany` (table)     |
|   [8]   | **Repository algebra**   | Typed query DU over method proliferation | Sealed DU + `Fold` catamorphism            |
|   [9]   | **Materialized refresh** | Cached aggregate recalculation           | `Eff<RT, Unit>` + `ExecuteSqlInterpolated` |
|  [10]   | **Idempotent migration** | Schema evolution on startup              | `MigrateAsync` + `EnableRetryOnFailure`    |
