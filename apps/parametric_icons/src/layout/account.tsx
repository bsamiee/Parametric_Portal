/**
 * Account components: overlay, API key management, logout.
 * Uses existing Modal/Button/Input from ui.ts with auth dispatch from api.ts.
 */
import { type ApiResponseFold, fold } from '@parametric-portal/types/api';
import { type AiProvider, type ApiKeyId, type ApiKeyListItem, SCHEMA_TUNING } from '@parametric-portal/types/database';
import { DateTime, Effect, Option } from 'effect';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { auth } from '../api.ts';
import { useRuntime, useStoreActions, useStoreSlice } from '../core.ts';
import { authSlice } from '../stores.ts';
import { Button, Icon, Input, Modal, Select, Spinner, Stack } from '../ui.ts';

// --- [TYPES] -----------------------------------------------------------------

type CreateKeyHandlers = ApiResponseFold<ApiKeyListItem, Effect.Effect<void, never, never>>;
type DeleteKeyHandlers = ApiResponseFold<{ success: boolean }, Effect.Effect<void, never, never>>;
type ListKeysHandlers = ApiResponseFold<{ data: ReadonlyArray<ApiKeyListItem> }, Effect.Effect<void, never, never>>;
type LogoutHandlers = ApiResponseFold<{ success: boolean }, Effect.Effect<void, never, never>>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    overlay: {
        size: 'md' as const,
        title: 'Account Settings',
    },
    providers: SCHEMA_TUNING.aiProviders,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const formatDate = (dt: DateTime.Utc): string => DateTime.formatLocal(dt, { dateStyle: 'medium' });

const createApiKeyHandlers = (onSuccess: (apiKey: ApiKeyListItem) => void, onError: () => void): CreateKeyHandlers => ({
    ApiError: () => Effect.sync(onError),
    ApiSuccess: (data) => Effect.sync(() => onSuccess(data)),
});

const mkDeleteHandlers = (onSuccess: () => void, onError: () => void): DeleteKeyHandlers => ({
    ApiError: () => Effect.sync(onError),
    ApiSuccess: () => Effect.sync(onSuccess),
});

const mkListHandlers = (
    setKeys: (keys: ReadonlyArray<ApiKeyListItem>) => void,
    setLoading: (flag: boolean) => void,
): ListKeysHandlers => ({
    ApiError: () => Effect.sync(() => setLoading(false)),
    ApiSuccess: (data) =>
        Effect.sync(() => {
            setKeys(data.data);
            setLoading(false);
        }),
});

const mkLogoutHandlers = (onSuccess: () => void): LogoutHandlers => ({
    ApiError: () => Effect.succeed(undefined),
    ApiSuccess: () => Effect.sync(onSuccess),
});

// --- [COMPONENTS] ------------------------------------------------------------

const ApiKeyForm = (): ReactNode => {
    const runtime = useRuntime();
    const { accessToken } = useStoreSlice(authSlice);
    const authActions = useStoreActions(authSlice);
    const [name, setName] = useState('');
    const [key, setKey] = useState('');
    const [provider, setProvider] = useState<AiProvider>(B.providers[0] as AiProvider);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = useCallback(() => {
        const canSubmit = accessToken && name.trim() && key.trim();
        canSubmit &&
            Effect.gen(function* () {
                setIsSubmitting(true);
                setError(null);
                const result = yield* auth.createApiKey(accessToken, { key: key.trim(), name: name.trim(), provider });
                yield* fold(
                    result,
                    createApiKeyHandlers(
                        (apiKey) => {
                            authActions.addApiKey(apiKey);
                            setName('');
                            setKey('');
                            setIsSubmitting(false);
                        },
                        () => {
                            setError('Failed to save API key');
                            setIsSubmitting(false);
                        },
                    ),
                );
            }).pipe((eff) => runtime.runFork(eff));
    }, [runtime, accessToken, name, key, provider, authActions]);

    return (
        <Stack gap className='p-4 bg-neutral-800/50 rounded-lg'>
            <span className='text-sm font-medium opacity-70'>Add API Key</span>
            <div className='grid grid-cols-[1fr_auto] gap-2'>
                <Input
                    placeholder='Key name (e.g., Personal)'
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className='text-sm'
                />
                <Select
                    items={B.providers.map((p) => ({ key: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))}
                    selectedKey={provider}
                    onSelectionChange={(k) => setProvider(k as AiProvider)}
                    className='w-32'
                />
            </div>
            <Input
                placeholder='API Key (sk-...)'
                value={key}
                onChange={(e) => setKey(e.target.value)}
                type='password'
                className='text-sm font-mono'
            />
            {error && <span className='text-xs text-red-400'>{error}</span>}
            <Button
                onPress={handleSubmit}
                isDisabled={isSubmitting || !name.trim() || !key.trim()}
                className='self-end'
            >
                {isSubmitting ? <Spinner /> : 'Save Key'}
            </Button>
        </Stack>
    );
};

const ApiKeyList = (): ReactNode => {
    const runtime = useRuntime();
    const { accessToken, apiKeys } = useStoreSlice(authSlice);
    const authActions = useStoreActions(authSlice);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleDelete = useCallback(
        (id: ApiKeyId) => {
            if (!accessToken) {
                return;
            }
            setDeletingId(id);
            runtime.runFork(
                Effect.flatMap(auth.deleteApiKey(accessToken, id), (r) =>
                    fold(
                        r,
                        mkDeleteHandlers(
                            () => {
                                authActions.removeApiKey(id);
                                setDeletingId(null);
                            },
                            () => setDeletingId(null),
                        ),
                    ),
                ),
            );
        },
        [runtime, accessToken, authActions],
    );

    return apiKeys.length === 0 ? (
        <Stack align='center' className='py-6 opacity-50'>
            <Icon name='Key' className='w-8 h-8' />
            <span className='text-sm'>No API keys configured</span>
        </Stack>
    ) : (
        <Stack gap className='divide-y divide-neutral-700'>
            {apiKeys.map((k) => (
                <div key={k.id} className='flex items-center justify-between py-3 first:pt-0 last:pb-0'>
                    <Stack className='gap-0.5'>
                        <span className='font-medium'>{k.name}</span>
                        <span className='text-xs opacity-50'>
                            {k.provider} | Added {formatDate(k.createdAt)}
                            {Option.isSome(k.lastUsedAt) && ` | Last used ${formatDate(k.lastUsedAt.value)}`}
                        </span>
                    </Stack>
                    <Button
                        variant='ghost'
                        onPress={() => handleDelete(k.id)}
                        isDisabled={deletingId === k.id}
                        className='text-red-400 hover:text-red-300'
                    >
                        {deletingId === k.id ? <Spinner /> : <Icon name='Trash2' className='w-4 h-4' />}
                    </Button>
                </div>
            ))}
        </Stack>
    );
};

const LogoutButton = (): ReactNode => {
    const runtime = useRuntime();
    const { accessToken } = useStoreSlice(authSlice);
    const authActions = useStoreActions(authSlice);
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    const handleLogout = useCallback(() => {
        if (!accessToken) {
            return;
        }
        setIsLoggingOut(true);
        runtime.runFork(
            Effect.flatMap(auth.logout(accessToken), (r) =>
                fold(
                    r,
                    mkLogoutHandlers(() => {
                        authActions.clearAuth();
                        authActions.closeAccountOverlay();
                    }),
                ),
            ),
        );
    }, [runtime, accessToken, authActions]);

    return (
        <Button
            onPress={handleLogout}
            isDisabled={isLoggingOut}
            variant='ghost'
            className='w-full justify-center text-red-400 hover:text-red-300 hover:bg-red-400/10'
        >
            {isLoggingOut ? <Spinner /> : <Icon name='LogOut' className='w-4 h-4 mr-2' />}
            Sign Out
        </Button>
    );
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const AccountOverlay = (): ReactNode => {
    const runtime = useRuntime();
    const { isAccountOverlayOpen, accessToken, user } = useStoreSlice(authSlice);
    const authActions = useStoreActions(authSlice);
    const [isLoadingKeys, setIsLoadingKeys] = useState(false);

    useEffect(() => {
        if (!isAccountOverlayOpen || !accessToken) {
            return;
        }
        setIsLoadingKeys(true);
        runtime.runFork(
            Effect.flatMap(auth.listApiKeys(accessToken), (r) =>
                fold(r, mkListHandlers(authActions.setApiKeys, setIsLoadingKeys)),
            ),
        );
    }, [isAccountOverlayOpen, runtime, accessToken, authActions]);

    return (
        <Modal
            isOpen={isAccountOverlayOpen}
            onClose={authActions.closeAccountOverlay}
            title={B.overlay.title}
            size={B.overlay.size}
        >
            <Stack gap className='py-2'>
                {user && (
                    <div className='flex items-center gap-3 p-3 bg-neutral-800/30 rounded-lg'>
                        <Icon name='User' className='w-5 h-5 opacity-50' />
                        <span className='text-sm'>{user.email}</span>
                    </div>
                )}

                <div className='border-t border-neutral-700 pt-4 mt-2'>
                    <span className='text-sm font-medium opacity-70 mb-3 block'>API Keys</span>
                    {isLoadingKeys ? (
                        <Stack align='center' className='py-6'>
                            <Spinner />
                        </Stack>
                    ) : (
                        <ApiKeyList />
                    )}
                </div>

                <ApiKeyForm />

                <div className='border-t border-neutral-700 pt-4 mt-2'>
                    <LogoutButton />
                </div>
            </Stack>
        </Modal>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { AccountOverlay, B as ACCOUNT_CONFIG };
