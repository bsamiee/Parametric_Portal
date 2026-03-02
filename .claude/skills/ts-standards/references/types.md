# Types

## Type Extraction Utilities

```typescript
// Extract - Extract types from union
type AllTypes = 'a' | 'b' | 'c' | 1 | 2 | 3;
type StringTypes = Extract<AllTypes, string>; // 'a' | 'b' | 'c'
type NumberTypes = Extract<AllTypes, number>; // 1 | 2 | 3
// Exclude - Remove types from union
type WithoutNumbers = Exclude<AllTypes, number>; // 'a' | 'b' | 'c'
// NonNullable - Remove null and undefined
type MaybeString = string | null | undefined;
type DefiniteString = NonNullable<MaybeString>; // string
// ReturnType - Extract function return type
function getUser() {
  return { id: 1, name: 'Ahmad' };
}
type User = ReturnType<typeof getUser>; // { id: number; name: string }
// Parameters - Extract function parameter types
function createUser(name: string, age: number) {
  return { name, age };
}
type CreateUserParams = Parameters<typeof createUser>; // [string, number]
// ConstructorParameters - Extract constructor parameters
class Point {
  constructor(public x: number, public y: number) {}
}
type PointParams = ConstructorParameters<typeof Point>; // [number, number]
// InstanceType - Extract instance type from constructor
type PointInstance = InstanceType<typeof Point>; // Point
```

---

## Custom Utilities

```typescript
// Nullable - Add null and undefined
type Nullable<T> = T | null | undefined;
// ValueOf - Get union of all property values
type ValueOf<T> = T[keyof T];
interface Codes {
  success: 200;
  notFound: 404;
  error: 500;
}
type StatusCode = ValueOf<Codes>;  // 200 | 404 | 500
// RequireAtLeastOne - Require at least one property
type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
  Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];
interface Options {
  id?:    number;
  name?:  string;
  email?: string;
}
type AtLeastOne = RequireAtLeastOne<Options>;  // Must have at least one of id, name, or email
// RequireOnlyOne - Require exactly one property
type RequireOnlyOne<T, Keys extends keyof T = keyof T> =
  Pick<T, Exclude<keyof T, Keys>> &
  {
    [K in Keys]-?:
      Required<Pick<T, K>> &
      Partial<Record<Exclude<Keys, K>, undefined>>;
  }[Keys];
type OnlyOne = RequireOnlyOne<Options>;  // Must have exactly one of id, name, or email
// Merge - Deep merge two types
type Merge<T, U> = Omit<T, keyof U> & U;
interface Base {
  id:   number;
  name: string;
}
interface Extension {
  name:  string; // Override
  email: string; // Add
}
type Combined = Merge<Base, Extension>;  // { id: number; name: string; email: string }
// ConditionalKeys - Get keys matching condition
type ConditionalKeys<T, Condition> = {
  [K in keyof T]: T[K] extends Condition ? K : never;
}[keyof T];
type FunctionKeys = ConditionalKeys<typeof Math, Function>;  // 'abs' | 'acos' | 'sin' | ...
```

---

## Tuple Utilities

```typescript
// First - Get first element type
type First<T extends any[]> = T extends [infer F, ...any[]] ? F : never;
type FirstType = First<[string, number, boolean]>; // string
// Last - Get last element type
type Last<T extends any[]> = T extends [...any[], infer L] ? L : never;
type LastType = Last<[string, number, boolean]>; // boolean
// Tail - Remove first element
type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : never;
type TailTypes = Tail<[string, number, boolean]>; // [number, boolean]
// Prepend - Add element to beginning
type Prepend<T extends any[], U> = [U, ...T];
type WithString = Prepend<[number, boolean], string>; // [string, number, boolean]
// Reverse - Reverse tuple
type Reverse<T extends any[]> =
  T extends [infer First, ...infer Rest]
    ? [...Reverse<Rest>, First]
    : [];
type Reversed = Reverse<[1, 2, 3]>; // [3, 2, 1]
```

---

## String Utilities

```typescript
// Split - Split string into tuple
type Split<S extends string, D extends string> =
  S extends `${infer T}${D}${infer U}`
    ? [T, ...Split<U, D>]
    : [S];
type Parts = Split<'a-b-c', '-'>; // ['a', 'b', 'c']
// Join - Join tuple into string
type Join<T extends string[], D extends string> =
  T extends [infer F extends string, ...infer R extends string[]]
    ? R extends []
      ? F
      : `${F}${D}${Join<R, D>}`
    : '';
type Joined = Join<['a', 'b', 'c'], '-'>; // 'a-b-c'
// Replace - Replace substring
type Replace<
  S extends string,
  From extends string,
  To extends string
> = S extends `${infer L}${From}${infer R}`
  ? `${L}${To}${R}`
  : S;
type Replaced = Replace<'hello world', 'world', 'TypeScript'>;  // 'hello TypeScript'
// TrimLeft - Remove leading whitespace
type TrimLeft<S extends string> =
  S extends ` ${infer Rest}` ? TrimLeft<Rest> : S;
type Trimmed = TrimLeft<'  hello'>; // 'hello'
```

---

## Mapped Types

```typescript
// Basic mapped type
type ReadOnly<T> = {
  readonly [K in keyof T]: T[K];
};
// Optional properties
type Partial<T> = {
  [K in keyof T]?: T[K];
};
// Required properties
type Required<T> = {
  [K in keyof T]-?: T[K]; // Remove optional modifier
};
// Key remapping with 'as'
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};
interface Person {
  name: string;
  age:  number;
}
type PersonGetters = Getters<Person>;  // { getName: () => string; getAge: () => number; }
// Filtering keys
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};
type StringFields = PickByType<Person, string>; // { name: string }
```

---

## Recursive Types

```typescript
// JSON type
type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };
// Deep partial
type DeepPartial<T> = T extends object ? {
  [K in keyof T]?: DeepPartial<T[K]>;
} : T;
// Deep readonly
type DeepReadonly<T> = T extends object ? {
  readonly [K in keyof T]: DeepReadonly<T[K]>;
} : T;
// Path type for nested objects
type PathsToProps<T> = T extends object ? {
  [K in keyof T]: K extends string
    ? T[K] extends object
      ? K | `${K}.${PathsToProps<T[K]>}`
      : K
    : never;
}[keyof T] : never;
interface User {
  profile: {
    name: string;
    settings: {
      theme: string;
    };
  };
}
type UserPaths = PathsToProps<User>;  // 'profile' | 'profile.name' | 'profile.settings' | 'profile.settings.theme'
```

---

# Type-Level Programming

```typescript
// Type-level addition (limited)
type Length<T extends any[]> = T['length'];
type Concat<A extends any[], B extends any[]> = [...A, ...B];
// Type-level conditionals
type If<Condition extends boolean, Then, Else> =
  Condition extends true ? Then : Else;
// Type-level equality
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends
  (<T>() => T extends Y ? 1 : 2) ? true : false;
// Assert equal types (for testing)
type Assert<T extends true> = T;
type Test = Assert<Equal<1 | 2, 2 | 1>>; // OK
```

---

## Higher-Kinded Types (Simulation)

```typescript
// Type-level function simulation
interface TypeClass<F> {
  map: <A, B>(f: (a: A) => B, fa: any) => any;
}
// Functor pattern
type Maybe<T> = { type: 'just'; value: T } | { type: 'nothing' };
const MaybeFunctor: TypeClass<Maybe<any>> = {
  map: <A, B>(f: (a: A) => B, ma: Maybe<A>): Maybe<B> => {
    return ma.type === 'just'
      ? { type: 'just', value: f(ma.value) }
      : { type: 'nothing' };
  }
};
// Builder pattern with generics
type Builder<T, K extends keyof T = never> = {
  with<P extends Exclude<keyof T, K>>(
    key: P,
    value: T[P]
  ): Builder<T, K | P>;
  build(): K extends keyof T ? T : never;
};
```

---

## Conditional Types

```typescript
// Basic conditional type
type IsString<T> = T extends string ? true : false;
// Distributive conditional types
type ToArray<T> = T extends any ? T[] : never;
type StringOrNumberArray = ToArray<string | number>; // string[] | number[]
// Non-distributive (use tuple)
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;
type BothArray = ToArrayNonDist<string | number>; // (string | number)[]
// Nested conditionals for type extraction
type Flatten<T> = T extends Array<infer U>
  ? U extends Array<infer V>
    ? Flatten<V>
    : U
  : T;
type Nested = Flatten<string[][][]>; // string
// Exclude null/undefined
type NonNullable<T> = T extends null | undefined ? never : T;
```

---

## Quick Reference

| Pattern               | Use Case                       |
| --------------------- | ------------------------------ |
| `Partial<T>`          | Make all properties optional   |
| `Required<T>`         | Make all properties required   |
| `Readonly<T>`         | Make all properties readonly   |
| `Pick<T, K>`          | Select subset of properties    |
| `Omit<T, K>`          | Remove subset of properties    |
| `Record<K, T>`        | Create object type with keys K |
| `Extract<T, U>`       | Extract types assignable to U  |
| `Exclude<T, U>`       | Remove types assignable to U   |
| `NonNullable<T>`      | Remove null and undefined      |
| `ReturnType<T>`       | Extract function return type   |
| `Parameters<T>`       | Extract function parameters    |
| `Awaited<T>`          | Unwrap Promise type            |
| `T extends U ? X : Y` | Conditional type logic         |
| `infer R`             | Extract types from patterns    |
| `K in keyof T`        | Iterate over object keys       |
| `as NewKey`           | Remap keys in mapped types     |
| `T extends any`       | Distributive conditionals      |
| `[T] extends [any]`   | Non-distributive check         |
| `-?` modifier         | Remove optional                |
| `readonly` modifier   | Make immutable                 |
