/**
 * Cryptographic utilities: encryption, hashing, token management.
 * Service manages versioned keys; functions use service via R channel.
 */
import { timingSafeEqual } from 'node:crypto';
import { Hex64, Uuidv7 } from '@parametric-portal/types/types';
import { Array as A, Config, Effect, Option, Redacted } from 'effect';
import { HttpError } from '../errors.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const _cfg = {
	iv: 12,
	key: { length: 256, name: 'AES-GCM' } as const,
	maxVersions: 10,
	minBytes: 14,
	version: { current: 1, max: 255, min: 1 },
} as const;

// --- [INTERNAL] --------------------------------------------------------------

const _parse = (bytes: Uint8Array) => {
	const v = bytes[0];
	return bytes.length >= _cfg.minBytes && typeof v === 'number' && v >= _cfg.version.min && v <= _cfg.version.max
		? Option.some({ cipher: bytes.slice(1 + _cfg.iv), iv: bytes.slice(1, 1 + _cfg.iv), v })
		: Option.none();
};

// --- [SERVICE] ---------------------------------------------------------------

class Service extends Effect.Service<Service>()('server/CryptoService', {
	effect: Effect.gen(function* () {
		const keys = new Map<number, CryptoKey>();
		const load = (b64: string) => Effect.tryPromise({
			catch: (e) => e,
			try: () => crypto.subtle.importKey('raw', Hex64.fromBase64(b64).slice(), _cfg.key, false, ['encrypt', 'decrypt']),
		});
		keys.set(_cfg.version.current, yield* Config.redacted('ENCRYPTION_KEY').pipe(
			Effect.flatMap((r) => load(Redacted.value(r))),
			Effect.orDie,
		));
		yield* Effect.all(
			A.makeBy(_cfg.maxVersions, (i) => i + _cfg.version.min)
				.filter((v) => v !== _cfg.version.current)
				.map((v) => Config.option(Config.redacted(`ENCRYPTION_KEY_V${v}`)).pipe(
					Effect.flatMap(Option.match({
						onNone: () => Effect.void,
						onSome: (r) => load(Redacted.value(r)).pipe(
							Effect.tap((k) => Effect.sync(() => keys.set(v, k))),
							Effect.catchAll(() => Effect.void),
						),
					})),
				)),
			{ concurrency: 'unbounded' },
		);
		yield* Effect.logInfo('CryptoService initialized', { versions: [...keys.keys()].sort((a, b) => a - b) });
		return {
			current: _cfg.version.current,
			key: (v: number) => Effect.fromNullable(keys.get(v)).pipe(
				Effect.mapError(() => HttpError.internal(`Key v${v} not found`)),
			),
		};
	}),
}) {}

// --- [FUNCTIONS] -------------------------------------------------------------

const _hash = (input: string): Effect.Effect<Hex64, HttpError.Internal> =>
	Effect.tryPromise({
		catch: () => HttpError.internal('Hash failed'),
		try: () => crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)),
	}).pipe(
		Effect.map((buf) => Hex64.fromBytes(new Uint8Array(buf))),
		Effect.withSpan('crypto.hash'),
	);
const encrypt = (plaintext: string): Effect.Effect<Uint8Array, HttpError.Internal, Service> =>
	Effect.gen(function* () {
		const svc = yield* Service;
		const key = yield* svc.key(svc.current);
		const iv = crypto.getRandomValues(new Uint8Array(_cfg.iv));
		const buf = yield* Effect.tryPromise({
			catch: () => HttpError.internal('Encryption failed'),
			try: () => crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, new TextEncoder().encode(plaintext)),
		});
		return new Uint8Array([svc.current, ...iv, ...new Uint8Array(buf)]);
	}).pipe(Effect.withSpan('crypto.encrypt'));
const decrypt = (bytes: Uint8Array): Effect.Effect<{ readonly migrated: Option.Option<Uint8Array>; readonly value: string }, HttpError.Internal, Service> =>
	Effect.gen(function* () {
		const svc = yield* Service;
		const parsed = yield* Effect.fromNullable(_parse(bytes).pipe(Option.getOrNull)).pipe(
			Effect.mapError(() => HttpError.internal('Invalid encrypted format')),
		);
		const key = yield* svc.key(parsed.v);
		const buf = yield* Effect.tryPromise({
			catch: () => HttpError.internal('Decryption failed'),
			try: () => crypto.subtle.decrypt({ iv: parsed.iv.slice(), name: 'AES-GCM' }, key, parsed.cipher.slice()),
		});
		const value = new TextDecoder().decode(buf);
		const migrated = parsed.v === svc.current
			? Option.none()
			: yield* encrypt(value).pipe(Effect.map(Option.some));
		return { migrated, value };
	}).pipe(Effect.withSpan('crypto.decrypt'));
const token = {
	compare: (a: string, b: string): boolean => {
		const bufA = Buffer.from(a);
		const bufB = Buffer.from(b);
		return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
	},
	hash: _hash,
	pair: Effect.gen(function* () {
		const token = Uuidv7.generateSync();
		const hash = yield* _hash(token);
		return { hash, token } as const;
	}).pipe(Effect.withSpan('crypto.pair')),
	validate: <T extends { readonly expiresAt?: Date | Option.Option<Date> }>(cfg: {
		readonly lookup: (hash: Hex64) => Effect.Effect<Option.Option<T>, HttpError.Auth>;
		readonly messages: { readonly expired: string; readonly notFound: string };
	}) =>
		(hash: Hex64) => cfg.lookup(hash).pipe(
			Effect.flatMap(Option.match({
				onNone: () => Effect.fail(HttpError.auth(cfg.messages.notFound)),
				onSome: Effect.succeed,
			})),
			Effect.filterOrFail(
				(r) => Option.match(
					r.expiresAt instanceof Date ? Option.some(r.expiresAt) : (r.expiresAt ?? Option.none()),
					{ onNone: () => true, onSome: (exp) => exp > new Date() },
				),
				() => HttpError.auth(cfg.messages.expired),
			),
		),
} as const;

// --- [ENTRY_POINT] -----------------------------------------------------------

// biome-ignore lint/correctness/noUnusedVariables: const+namespace merge
const Crypto = {
	decrypt,
	encrypt,
	Service,
	token,
} as const;

// --- [NAMESPACE] -------------------------------------------------------------

namespace Crypto {
	export type Decrypted = Effect.Effect.Success<ReturnType<typeof Crypto.decrypt>>;
	export type Pair = Effect.Effect.Success<typeof Crypto.token.pair>;
	export type Service = typeof Crypto.Service.Service;
	export type ValidateConfig<T extends { readonly expiresAt?: Date | Option.Option<Date> }> = Parameters<typeof Crypto.token.validate<T>>[0];
}

// --- [EXPORT] ----------------------------------------------------------------

export { Crypto };
