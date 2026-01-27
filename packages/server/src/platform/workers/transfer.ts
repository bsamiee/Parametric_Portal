/**
 * Worker script for transfer parsing operations.
 * Runs in worker_threads context, handles ParseTransfer RPC requests.
 * Fetches from presigned URLs, streams progress, returns partial results.
 */
import * as NodeRuntime from '@effect/platform-node/NodeRuntime';
import * as NodeWorkerRunner from '@effect/platform-node/NodeWorkerRunner';
import * as RpcServer from '@effect/rpc/RpcServer';
import { Array as A, Effect, Either, Layer, Option, Stream, Tuple } from 'effect';
import type ExcelJS from 'exceljs';
import type JSZipType from 'jszip';
import { Readable } from 'node:stream';
import { TransferError } from '../../utils/transfer.ts';
import {
	TransferRpc,
	type ParseFormatType,
	type ParseProgressType,
	type ParseResultType,
} from './contract.ts';

// --- [TYPES] -----------------------------------------------------------------

type ParseItem = { content: string; ordinal: number; type: string };
type ParseErrorItem = { code: string; detail: Option.Option<string>; ordinal: number };
type ParseRow = Either.Either<ParseItem, ParseErrorItem>;
type ProgressOrResult = ParseProgressType | ParseResultType;
type AccumState = {
	bytesProcessed: number;
	lastProgressBytes: number;
	lastProgressRows: number;
	progressEvents: ProgressOrResult[];
	rows: ParseRow[];
};

// --- [DRIVERS] ---------------------------------------------------------------

const _drivers = {
	excel: () => Effect.promise(() => import('exceljs')),
	papa: () => Effect.promise(() => import('papaparse')),
	sax: () => Effect.promise(() => import('sax')),
	yaml: () => Effect.promise(() => import('yaml')),
	zip: () => Effect.promise(async () => (await import('jszip')).default),
} as const;

// --- [CONSTANTS] -------------------------------------------------------------

const PROGRESS_ROW_INTERVAL = 100;
const PROGRESS_BYTE_INTERVAL = 10 * 1024;

// --- [PROGRESS] --------------------------------------------------------------

const _emitProgress = (
	bytesProcessed: number,
	totalBytes: number,
	rowsProcessed: number,
	startTime: number,
): ParseProgressType => ({
	bytesProcessed,
	eta: Option.fromNullable(
		totalBytes > 0 && bytesProcessed > 0
			? ((Date.now() - startTime) / bytesProcessed) * (totalBytes - bytesProcessed)
			: null,
	),
	percentage: totalBytes > 0 ? (bytesProcessed / totalBytes) * 100 : 0,
	rowsProcessed,
	totalBytes,
});

const _shouldEmitProgress = (
	rowsProcessed: number,
	bytesProcessed: number,
	lastProgressRows: number,
	lastProgressBytes: number,
): boolean =>
	rowsProcessed - lastProgressRows >= PROGRESS_ROW_INTERVAL ||
	bytesProcessed - lastProgressBytes >= PROGRESS_BYTE_INTERVAL;

// --- [RESULT_BUILDER] --------------------------------------------------------

const _buildResult = (rows: readonly ParseRow[]): ParseResultType => {
	const [errors, items] = A.separate(rows);
	return { errors, items };
};

const _accumRow = (
	state: AccumState,
	row: ParseRow,
	byteSize: number,
	totalBytes: number,
	startTime: number,
): AccumState => {
	const bytesProcessed = state.bytesProcessed + byteSize;
	const rows = [...state.rows, row];
	const shouldEmit = _shouldEmitProgress(
		rows.length,
		bytesProcessed,
		state.lastProgressRows,
		state.lastProgressBytes,
	);
	const progressEvents = shouldEmit
		? [...state.progressEvents, _emitProgress(bytesProcessed, totalBytes, rows.length, startTime)]
		: state.progressEvents;
	const lastProgressRows = shouldEmit ? rows.length : state.lastProgressRows;
	const lastProgressBytes = shouldEmit ? bytesProcessed : state.lastProgressBytes;
	return { bytesProcessed, lastProgressBytes, lastProgressRows, progressEvents, rows };
};

const _initState = (): AccumState => ({
	bytesProcessed: 0,
	lastProgressBytes: 0,
	lastProgressRows: 0,
	progressEvents: [],
	rows: [],
});

// --- [PARSERS] ---------------------------------------------------------------

const _parseDelimited = (
	content: string,
	sep: string,
	assetType: string,
	totalBytes: number,
	startTime: number,
): Effect.Effect<ProgressOrResult[], TransferError.Parse> =>
	_drivers.papa().pipe(
		Effect.map((Papa) => {
			const result = Papa.parse<Record<string, string>>(content, {
				delimiter: sep,
				header: true,
				skipEmptyLines: 'greedy',
				transformHeader: (header) => header.trim().toLowerCase().replaceAll('_', ''),
			});

			const rows: ParseRow[] = result.data.map((data, idx) => {
				const ordinal = idx + 1;
				const parsedType = data['type'] ?? assetType;
				return parsedType
					? Either.right({ content: data['content'] ?? '', ordinal, type: parsedType })
					: Either.left({ code: 'MISSING_TYPE', detail: Option.none<string>(), ordinal });
			});

			const bytesProcessed = totalBytes;
			const finalResult = _buildResult(rows);
			const progress = _emitProgress(bytesProcessed, totalBytes, rows.length, startTime);

			return [progress, finalResult] as ProgressOrResult[];
		}),
	);

const _parseStreamed = (
	content: string,
	sep: string,
	assetType: string,
	lib: 'yaml' | undefined,
	totalBytes: number,
	startTime: number,
): Effect.Effect<ProgressOrResult[], TransferError.Parse> =>
	(lib === 'yaml' ? _drivers.yaml() : Effect.succeed({ parse: JSON.parse })).pipe(
		Effect.map((mod) => {
			const lines = content.split(sep).filter((line) => line.trim() !== '');

			const finalState = lines.reduce((state, rawLine, i) => {
				const line = rawLine.trim();
				const ordinal = i + 1;
				const byteSize = Buffer.byteLength(line);

				const parsed = Either.try({
					catch: () => ({ code: 'INVALID_RECORD', detail: Option.none<string>(), ordinal }),
					try: () => mod.parse(line) as Record<string, unknown>,
				});

				const row = Either.match(parsed, {
					onLeft: (err) => Either.left(err),
					onRight: (obj) => {
						const parsedType = (obj['type'] as string | undefined) ?? assetType;
						const parsedContent = String(obj['content'] ?? line);
						return parsedType
							? Either.right({ content: parsedContent, ordinal, type: parsedType })
							: Either.left({ code: 'MISSING_TYPE', detail: Option.none<string>(), ordinal });
					},
				});

				return _accumRow(state, row, byteSize, totalBytes, startTime);
			}, _initState());

			const finalResult = _buildResult(finalState.rows);
			return [...finalState.progressEvents, finalResult] as ProgressOrResult[];
		}),
	);

const _parseXml = (
	content: string,
	nodes: readonly string[],
	assetType: string,
	totalBytes: number,
	startTime: number,
): Effect.Effect<ProgressOrResult[], TransferError.Parse> =>
	_drivers.sax().pipe(
		Effect.flatMap((sax) =>
			Effect.async<ProgressOrResult[], TransferError.Parse>((resume) => {
				const parser = sax.parser(true, { trim: true });
				const tags = new Set<string>(nodes);
				const stateRef = { current: null as { content: string; type: string } | null, idx: 0, state: _initState() };

				parser.onopentag = (tag) => {
					Option.liftPredicate(tag, (t) => tags.has(t.name.toLowerCase())).pipe(
						Option.match({
							onNone: () => undefined,
							onSome: (t) => {
								const attr = t.attributes['type'];
								stateRef.current = { content: '', type: (typeof attr === 'string' ? attr : attr?.value) ?? assetType };
							},
						}),
					);
				};
				parser.ontext = (text: string) => {
					Option.fromNullable(stateRef.current).pipe(
						Option.match({
							onNone: () => undefined,
							onSome: (c) => {
								stateRef.current = { ...c, content: c.content + text };
								stateRef.state = { ...stateRef.state, bytesProcessed: stateRef.state.bytesProcessed + Buffer.byteLength(text) };
							},
						}),
					);
				};
				parser.oncdata = (text: string) => {
					Option.fromNullable(stateRef.current).pipe(
						Option.match({
							onNone: () => undefined,
							onSome: (c) => {
								stateRef.current = { ...c, content: c.content + text };
								stateRef.state = { ...stateRef.state, bytesProcessed: stateRef.state.bytesProcessed + Buffer.byteLength(text) };
							},
						}),
					);
				};
				parser.onclosetag = (name: string) => {
					Option.fromNullable(stateRef.current).pipe(
						Option.filter(() => tags.has(name.toLowerCase())),
						Option.match({
							onNone: () => undefined,
							onSome: (current) => {
								stateRef.idx += 1;
								const row = current.type
									? Either.right<ParseItem>({ ...current, ordinal: stateRef.idx })
									: Either.left<ParseErrorItem>({ code: 'MISSING_TYPE', detail: Option.none(), ordinal: stateRef.idx });
								stateRef.state = _accumRow(stateRef.state, row, 0, totalBytes, startTime);
								stateRef.current = null;
							},
						}),
					);
				};
				parser.onerror = (err: Error) => {
					resume(Effect.fail(new TransferError.Parse({ code: 'INVALID_RECORD', detail: String(err) })));
				};
				parser.onend = () => {
					const finalResult = _buildResult(stateRef.state.rows);
					resume(Effect.succeed([...stateRef.state.progressEvents, finalResult]));
				};

				parser.write(content).close();
			}),
		),
	);

const _parseXlsx = (
	buf: Buffer,
	assetType: string,
	totalBytes: number,
	startTime: number,
): Effect.Effect<ProgressOrResult[], TransferError.Parse> =>
	_drivers.excel().pipe(
		Effect.flatMap((ExcelJSMod) =>
			Effect.async<ProgressOrResult[], TransferError.Parse>((resume) => {
				const reader = new ExcelJSMod.stream.xlsx.WorkbookReader(Readable.from(buf), {
					hyperlinks: 'ignore',
					sharedStrings: 'cache',
					styles: 'ignore',
					worksheets: 'emit',
				});

				const stateRef = { rowIdx: 0, state: _initState() };

				reader.read();

				(reader as unknown as NodeJS.EventEmitter).on(
					'worksheet',
					(worksheet: NodeJS.EventEmitter) => {
						worksheet.on('row', (row: ExcelJS.Row) => {
							stateRef.rowIdx += 1;
							// Skip header row using Option pattern
							Option.liftPredicate(stateRef.rowIdx, (idx) => idx > 1).pipe(
								Option.match({
									onNone: () => undefined,
									onSome: (ordinal) => {
										const values = row.values as unknown[];
										const parsedType = String(values?.[1] ?? assetType);
										const content = String(values?.[2] ?? '');
										const byteSize = Buffer.byteLength(content);

										const parseRow = parsedType
											? Either.right<ParseItem>({ content, ordinal, type: parsedType })
											: Either.left<ParseErrorItem>({ code: 'MISSING_TYPE', detail: Option.none(), ordinal });

										stateRef.state = _accumRow(stateRef.state, parseRow, byteSize, totalBytes, startTime);
									},
								}),
							);
						});
					},
				);

				(reader as unknown as NodeJS.EventEmitter).on('end', () => {
					const finalResult = _buildResult(stateRef.state.rows);
					resume(Effect.succeed([...stateRef.state.progressEvents, finalResult]));
				});

				(reader as unknown as NodeJS.EventEmitter).on('error', (err: Error) => {
					resume(Effect.fail(new TransferError.Parse({ code: 'INVALID_RECORD', detail: String(err) })));
				});
			}),
		),
	);

const _parseZip = (
	buf: Buffer,
	assetType: string,
	totalBytes: number,
	startTime: number,
): Effect.Effect<ProgressOrResult[], TransferError.Parse> =>
	Effect.gen(function* () {
		const JSZip = yield* _drivers.zip();
		const zip = yield* Effect.tryPromise({
			catch: (err) => new TransferError.Parse({ code: 'DECOMPRESS', detail: String(err) }),
			try: () => JSZip.loadAsync(buf),
		});

		const files = Object.values(zip.files).filter((file): file is JSZipType.JSZipObject => !file.dir);

		const finalState = yield* Effect.reduce(
			files.map((file, i) => Tuple.make(file, i + 1)),
			_initState(),
			(state, [file, ordinal]) =>
				Effect.tryPromise({
					catch: () => new TransferError.Parse({ code: 'DECOMPRESS', detail: file.name, ordinal }),
					try: () => file.async('text'),
				}).pipe(
					Effect.map((content) => {
						const byteSize = Buffer.byteLength(content);
						const ext = file.name.split('.').pop() ?? assetType;
						const row = Either.right<ParseItem>({ content, ordinal, type: ext });
						return _accumRow(state, row, byteSize, totalBytes, startTime);
					}),
				),
		);

		const finalResult = _buildResult(finalState.rows);
		return [...finalState.progressEvents, finalResult];
	});

// --- [DISPATCHER] ------------------------------------------------------------

const _parseWithProgress = (
	body: ArrayBuffer,
	format: ParseFormatType,
	totalBytes: number,
): Effect.Effect<ProgressOrResult[], TransferError.Parse> => {
	const startTime = Date.now();
	const buf = Buffer.from(body);

	const dispatch: Record<ParseFormatType, Effect.Effect<ProgressOrResult[], TransferError.Parse>> = {
		csv: _parseDelimited(buf.toString('utf8'), ',', 'unknown', totalBytes, startTime),
		json: _parseStreamed(buf.toString('utf8'), '\n', 'unknown', undefined, totalBytes, startTime),
		ndjson: _parseStreamed(buf.toString('utf8'), '\n', 'unknown', undefined, totalBytes, startTime),
		xlsx: _parseXlsx(buf, 'unknown', totalBytes, startTime),
		xml: _parseXml(buf.toString('utf8'), ['item', 'entry', 'row', 'record'], 'unknown', totalBytes, startTime),
		yaml: _parseStreamed(buf.toString('utf8'), '\n---\n', 'unknown', 'yaml', totalBytes, startTime),
		zip: _parseZip(buf, 'unknown', totalBytes, startTime),
	};

	return dispatch[format];
};

// --- [HANDLER] ---------------------------------------------------------------

const parseHandler = ({ format, presignedUrl }: { format: ParseFormatType; presignedUrl: string }) =>
	Stream.unwrap(
		Effect.gen(function* () {
			const response = yield* Effect.tryPromise({
				catch: (e) => new TransferError.Parse({ code: 'INVALID_RECORD', detail: String(e) }),
				try: () => fetch(presignedUrl),
			});

			return yield* Option.liftPredicate(response, (r) => r.ok).pipe(
				Option.match({
					onNone: () =>
						Effect.succeed(
							Stream.fail(
								new TransferError.Parse({
									code: 'INVALID_RECORD',
									detail: `HTTP ${response.status}: ${response.statusText}`,
								}),
							),
						),
					onSome: (r) =>
						Effect.gen(function* () {
							const contentLength = r.headers.get('content-length');
							const totalBytes = contentLength ? Number(contentLength) : 0;
							const body = yield* Effect.tryPromise({
								catch: (e) => new TransferError.Parse({ code: 'INVALID_RECORD', detail: String(e) }),
								try: () => r.arrayBuffer(),
							});

							const results = yield* _parseWithProgress(body, format, totalBytes);
							return Stream.fromIterable<ProgressOrResult>(results);
						}),
				}),
			);
		}),
	);

// --- [RPC_SERVER] ------------------------------------------------------------

const Live = TransferRpc.toLayer(
	Effect.succeed({
		ParseTransfer: parseHandler,
	}),
);

const RpcWorkerServer = RpcServer.layer(TransferRpc).pipe(
	Layer.provide(Live),
	Layer.provide(RpcServer.layerProtocolWorkerRunner),
	Layer.provide(NodeWorkerRunner.layer),
);

// --- [ENTRYPOINT] ------------------------------------------------------------

NodeRuntime.runMain(NodeWorkerRunner.launch(RpcWorkerServer));
