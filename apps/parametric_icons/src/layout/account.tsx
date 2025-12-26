/**
 * Account components: overlay, API key management, logout.
 * Uses useMutation/useQuery hooks with toEffectM for ApiResponse bridging.
 */

import { useMutation, useQuery } from '@parametric-portal/runtime/hooks/async';
import { useAuthStore } from '@parametric-portal/runtime/stores/auth';
import type { ApiError } from '@parametric-portal/types/api';
import {
    type AiProvider,
    type ApiKeyId,
    type ApiKeyListItem,
    DATABASE_TUNING,
} from '@parametric-portal/types/database';
import { Effect, Option, pipe } from 'effect';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { apiFactory, asyncApi, auth } from '../infrastructure.ts';
import { Button, Icon, Input, Modal, Select, Spinner, Stack } from '../ui.ts';

// --- [TYPES] -----------------------------------------------------------------

type CreateKeyInput = { readonly key: string; readonly name: string; readonly provider: AiProvider };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    overlay: {
        size: 'md' as const,
        title: 'Account Settings',
    },
    providers: DATABASE_TUNING.aiProviders,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const formatDate = (dt: Date): string => dt.toLocaleDateString(undefined, { dateStyle: 'medium' });

// --- [COMPONENTS] ------------------------------------------------------------

const ApiKeyForm = (): ReactNode => {
    const accessToken = useAuthStore((s) => s.accessToken);
    const addApiKey = useAuthStore((s) => s.addApiKey);
    const [name, setName] = useState('');
    const [key, setKey] = useState('');
    const [provider, setProvider] = useState<AiProvider>(B.providers[0] as AiProvider);
    const [error, setError] = useState<string | null>(null);
    const createMutation = useMutation<ApiKeyListItem, CreateKeyInput, ApiError, never>(
        (input) =>
            pipe(auth.createApiKey(accessToken ?? '', input), Effect.flatMap(apiFactory.toEffectM<ApiKeyListItem>())),
        {
            onError: () => setError('Failed to save API key'),
            onSuccess: (apiKey) => {
                addApiKey(apiKey);
                setName('');
                setKey('');
                setError(null);
            },
        },
    );
    const handleSubmit = useCallback(() => {
        accessToken &&
            name.trim() &&
            key.trim() &&
            createMutation.mutate({ key: key.trim(), name: name.trim(), provider });
    }, [accessToken, name, key, provider, createMutation]);
    const isSubmitting = asyncApi.isLoading(createMutation.state);
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
    const accessToken = useAuthStore((s) => s.accessToken);
    const apiKeys = useAuthStore((s) => s.apiKeys);
    const removeApiKey = useAuthStore((s) => s.removeApiKey);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const deleteMutation = useMutation<{ success: boolean }, ApiKeyId, ApiError, never>(
        (id) =>
            pipe(
                auth.deleteApiKey(accessToken ?? '', id),
                Effect.flatMap(apiFactory.toEffectM<{ success: boolean }>()),
            ),
        {
            onSettled: () => setDeletingId(null),
            onSuccess: (_, id: ApiKeyId) => removeApiKey(id),
        },
    );
    const handleDelete = useCallback(
        (id: ApiKeyId) =>
            pipe(
                Option.fromNullable(accessToken),
                Option.match({
                    onNone: () => undefined,
                    onSome: () => {
                        setDeletingId(id);
                        deleteMutation.mutate(id);
                    },
                }),
            ),
        [accessToken, deleteMutation],
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
    const accessToken = useAuthStore((s) => s.accessToken);
    const clearAuth = useAuthStore((s) => s.clearAuth);
    const closeAccountOverlay = useAuthStore((s) => s.closeAccountOverlay);
    const logoutMutation = useMutation<{ success: boolean }, void, ApiError, never>(
        () => pipe(auth.logout(accessToken ?? ''), Effect.flatMap(apiFactory.toEffectM<{ success: boolean }>())),
        {
            onSuccess: () => {
                clearAuth();
                closeAccountOverlay();
            },
        },
    );
    const handleLogout = useCallback(() => {
        accessToken && logoutMutation.mutate(undefined);
    }, [accessToken, logoutMutation]);
    const isLoggingOut = asyncApi.isLoading(logoutMutation.state);
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
    const isAccountOverlayOpen = useAuthStore((s) => s.isAccountOverlayOpen);
    const accessToken = useAuthStore((s) => s.accessToken);
    const user = useAuthStore((s) => s.user);
    const closeAccountOverlay = useAuthStore((s) => s.closeAccountOverlay);
    const setApiKeys = useAuthStore((s) => s.setApiKeys);
    const keysQuery = useQuery<{ data: ReadonlyArray<ApiKeyListItem> }, ApiError, never>(
        pipe(
            auth.listApiKeys(accessToken ?? ''),
            Effect.flatMap(apiFactory.toEffectM<{ data: ReadonlyArray<ApiKeyListItem> }>()),
        ),
        [accessToken],
        {
            enabled: isAccountOverlayOpen && !!accessToken,
            onSuccess: (result) => setApiKeys(result.data),
        },
    );
    const isLoadingKeys = asyncApi.isLoading(keysQuery);
    return (
        <Modal
            isOpen={isAccountOverlayOpen}
            onClose={closeAccountOverlay}
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

export { AccountOverlay };
