/**
 * File upload hook with progress tracking.
 */
import type { AppError } from '@parametric-portal/types/app-error';
import { AsyncState } from '@parametric-portal/types/async';
import { Effect } from 'effect';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Runtime } from '../runtime';
import { type ProcessedFile, process } from '../services/file';

// --- [HOOK] ------------------------------------------------------------------

/** @internal Declaration emit disabled - Effect types can't be named in .d.ts */
const useFileUpload = <T extends string = string>(
    config: {
        readonly acceptDirectory?: boolean;
        readonly allowedTypes?: ReadonlyArray<T>;
        readonly defaultCamera?: 'environment' | 'user';
        readonly maxSizeBytes?: number;
        readonly multiple?: boolean;
    } = {},
) => {
    const runtime = Runtime.use();
    const [state, setState] = useState<AsyncState.Of<ReadonlyArray<ProcessedFile<T>>, AppError.File>>(
        AsyncState.idle(),
    );
    const [progress, setProgress] = useState(0);
    const completedRef = useRef(0);
    const mutate = useCallback(
        (files: ReadonlyArray<File>) => {
            setState(AsyncState.loading());
            setProgress(0);
            completedRef.current = 0;
            const total = files.length;
            const trackProgress = Effect.sync(() => {
                completedRef.current += 1;
                setProgress((completedRef.current / total) * 100);
            });
            runtime.runFork(
                Effect.forEach(
                    files,
                    (file) =>
                        process<T>(file, config.allowedTypes, config.maxSizeBytes).pipe(Effect.tap(trackProgress)),
                    { concurrency: 'unbounded' },
                ).pipe(
                    Effect.tap((data) => Effect.sync(() => setState(AsyncState.success(data)))),
                    Effect.tapError((e) => Effect.sync(() => setState(AsyncState.failure(e)))),
                ),
            );
        },
        [runtime, config.allowedTypes, config.maxSizeBytes],
    );
    const reset = useCallback(() => {
        setState(AsyncState.idle());
        setProgress(0);
        completedRef.current = 0;
    }, []);
    const { error, results } = useMemo(
        () =>
            AsyncState.$match(state, {
                Failure: (f) => ({ error: f.error, results: [] as ReadonlyArray<ProcessedFile<T>> }),
                Idle: () => ({ error: null, results: [] as ReadonlyArray<ProcessedFile<T>> }),
                Loading: () => ({ error: null, results: [] as ReadonlyArray<ProcessedFile<T>> }),
                Success: (s) => ({ error: null, results: s.data }),
            }),
        [state],
    );
    const props = useMemo(
        () => ({
            accept: config.allowedTypes ?? ([] as ReadonlyArray<T>),
            ...(config.acceptDirectory != null && { acceptDirectory: config.acceptDirectory }),
            asyncState: state,
            ...(config.defaultCamera != null && { defaultCamera: config.defaultCamera }),
            ...(config.multiple != null && { multiple: config.multiple }),
            onFilesChange: (files: ReadonlyArray<File>) => files.length > 0 && mutate(files),
            progress,
        }),
        [config.allowedTypes, config.acceptDirectory, config.defaultCamera, config.multiple, state, mutate, progress],
    );
    return useMemo(
        () => ({ error, isPending: AsyncState.$is('Loading')(state), progress, props, reset, results }),
        [error, state, progress, props, reset, results],
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { useFileUpload };
