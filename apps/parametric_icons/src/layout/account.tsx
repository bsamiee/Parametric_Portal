/**
 * Account components: overlay, API key management, logout.
 * Uses useEffectMutate/useEffectRun hooks with HttpApiClient Effects.
 */

import type { HttpClient } from '@effect/platform';
import { useEffectMutate, useEffectRun } from '@parametric-portal/runtime/hooks/effect';
import { type AuthApiKey, useAuthStore } from '@parametric-portal/runtime/stores/auth';
import { AsyncState } from '@parametric-portal/types/async';
import { DateTime, Effect, Option, pipe } from 'effect';
import type { ReactNode } from 'react';
import { useCallback, useState } from 'react';
import { auth } from '../infrastructure.ts';
import { Button, Icon, Input, Modal, Spinner, Stack } from '../ui.ts';

// --- [CONSTANTS] -------------------------------------------------------------

const AccountTuning = {
    overlay: {
        size: 'md' as const,
        title: 'Account Settings',
    },
} as const;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const toAuthApiKey = (raw: {
    id?: string;
    name: string;
    prefix?: string | null;
    expiresAt?: DateTime.Utc | null;
}): AuthApiKey => ({
    expiresAt: raw.expiresAt ? DateTime.toDate(raw.expiresAt) : null,
    id: raw.id ?? '',
    lastUsedAt: null,
    name: raw.name,
    prefix: raw.prefix ?? '',
});

// --- [COMPONENTS] ------------------------------------------------------------

const ApiKeyForm = (): ReactNode => {
    const accessToken = useAuthStore((s) => s.accessToken);
    const addApiKey = useAuthStore((s) => s.addApiKey);
    const [name, setName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [error, setError] = useState<string | null>(null);
    const createMutation = useEffectMutate<
        AuthApiKey,
        { readonly apiKey: string; readonly name: string },
        unknown,
        HttpClient.HttpClient
    >(
        (input) =>
            auth.createApiKey(accessToken ?? '', input).pipe(Effect.map(toAuthApiKey)) as Effect.Effect<
                AuthApiKey,
                unknown,
                HttpClient.HttpClient
            >,
        {
            onError: () => setError('Failed to save API key'),
            onSuccess: (newKey) => {
                addApiKey(newKey);
                setName('');
                setApiKey('');
                setError(null);
            },
        },
    );
    const handleSubmit = useCallback(() => {
        accessToken &&
            name.trim() &&
            apiKey.trim() &&
            createMutation.mutate({ apiKey: apiKey.trim(), name: name.trim() });
    }, [accessToken, name, apiKey, createMutation]);
    const isSubmitting = AsyncState.$is('Loading')(createMutation.state);
    return (
        <Stack gap className='p-4 bg-neutral-800/50 rounded-lg'>
            <span className='text-sm font-medium opacity-70'>Add API Key</span>
            <Input
                placeholder='Key name (e.g., Personal)'
                value={name}
                onChange={(e) => setName(e.target.value)}
                className='text-sm'
            />
            <Input
                placeholder='API Key (sk-...)'
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                type='password'
                className='text-sm font-mono'
            />
            {error && <span className='text-xs text-red-400'>{error}</span>}
            <Button
                onPress={handleSubmit}
                isDisabled={isSubmitting || !name.trim() || !apiKey.trim()}
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
    const deleteMutation = useEffectMutate<{ success: boolean }, string, unknown, HttpClient.HttpClient>(
        (id) => auth.deleteApiKey(accessToken ?? '', id),
        {
            onSettled: () => setDeletingId(null),
            onSuccess: (_, id: string) => removeApiKey(id),
        },
    );
    const handleDelete = useCallback(
        (id: string) =>
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
                        <span className='text-xs opacity-50'>{k.prefix}</span>
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
    const logoutMutation = useEffectMutate<{ success: boolean }, void, unknown, HttpClient.HttpClient>(
        () => auth.logout(accessToken ?? ''),
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
    const isLoggingOut = AsyncState.$is('Loading')(logoutMutation.state);
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
    const keysQuery = useEffectRun<{ data: ReadonlyArray<AuthApiKey> }, unknown, HttpClient.HttpClient>(
        auth
            .listApiKeys(accessToken ?? '')
            .pipe(Effect.map((res) => ({ data: res.data.map(toAuthApiKey) }))) as Effect.Effect<
            { data: ReadonlyArray<AuthApiKey> },
            unknown,
            HttpClient.HttpClient
        >,
        [accessToken],
        {
            enabled: isAccountOverlayOpen && !!accessToken,
            onSuccess: (result) => setApiKeys(result.data),
        },
    );
    const isLoadingKeys = AsyncState.$is('Loading')(keysQuery);
    return (
        <Modal
            isOpen={isAccountOverlayOpen}
            onClose={closeAccountOverlay}
            title={AccountTuning.overlay.title}
            size={AccountTuning.overlay.size}
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
