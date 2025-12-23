/**
 * Auth components: overlay, OAuth buttons, user avatar.
 * Uses existing Modal/Button/Avatar/Icon from ui.ts with auth dispatch from api.ts.
 */
import { type ApiResponseFold, fold } from '@parametric-portal/types/api';
import type { OAuthProvider, OAuthStartResponse } from '@parametric-portal/types/database';
import { Effect } from 'effect';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { auth } from '../api.ts';
import { useRuntime, useStoreActions, useStoreSlice } from '../core.ts';
import { authSlice } from '../stores.ts';
import { Avatar, Button, Icon, Modal, Spinner, Stack } from '../ui.ts';

// --- [TYPES] -----------------------------------------------------------------

type OAuthConfig = {
    readonly bg: string;
    readonly icon: string;
    readonly label: string;
    readonly text: string;
};
type UserAvatarProps = {
    readonly className?: string;
};
type OAuthHandlers = ApiResponseFold<OAuthStartResponse, Effect.Effect<void, never, never>>;

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    overlay: {
        size: 'sm' as const,
        title: 'Sign in to continue',
    },
    providers: {
        github: { bg: 'bg-neutral-800', icon: 'Github', label: 'Continue with GitHub', text: 'text-white' },
        google: { bg: 'bg-white', icon: 'Globe', label: 'Continue with Google', text: 'text-neutral-800' },
        microsoft: { bg: 'bg-blue-600', icon: 'Laptop', label: 'Continue with Microsoft', text: 'text-white' },
    } satisfies Record<OAuthProvider, OAuthConfig>,
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const getInitials = (email: string): string => {
    const local = email.split('@')[0] ?? '';
    return local
        .split(/[._-]/)
        .slice(0, 2)
        .map((s) => s.charAt(0).toUpperCase())
        .join('');
};
const mkOAuthHandlers = (setLoading: (flag: boolean) => void): OAuthHandlers => ({
    ApiError: () => Effect.sync(() => setLoading(false)),
    ApiSuccess: (data) =>
        Effect.sync(() => {
            globalThis.location.href = data.url;
        }),
});

// --- [ENTRY_POINT] -----------------------------------------------------------

const OAuthButton = ({ provider }: { readonly provider: OAuthProvider }): ReactNode => {
    const runtime = useRuntime();
    const authActions = useStoreActions(authSlice);
    const config = B.providers[provider];
    const handlePress = useCallback(() => {
        authActions.setLoading(true);
        runtime.runFork(
            Effect.flatMap(auth.initiateOAuth(provider), (r) => fold(r, mkOAuthHandlers(authActions.setLoading))),
        );
    }, [runtime, authActions, provider]);
    return (
        <Button
            onPress={handlePress}
            leftIcon={<Icon name={config.icon as 'Github' | 'Globe' | 'Laptop'} className='w-5 h-5' />}
            className={`w-full justify-center ${config.bg} ${config.text} hover:opacity-90`}
        >
            {config.label}
        </Button>
    );
};

const AuthOverlay = (): ReactNode => {
    const { isAuthOverlayOpen, isLoading } = useStoreSlice(authSlice);
    const authActions = useStoreActions(authSlice);
    return (
        <Modal
            isOpen={isAuthOverlayOpen}
            onClose={authActions.closeAuthOverlay}
            title={B.overlay.title}
            size={B.overlay.size}
        >
            {isLoading ? (
                <Stack gap align='center' className='py-8'>
                    <Spinner />
                    <span className='opacity-70'>Redirecting to provider...</span>
                </Stack>
            ) : (
                <Stack gap className='py-2'>
                    {(Object.keys(B.providers) as ReadonlyArray<OAuthProvider>).map((provider) => (
                        <OAuthButton key={provider} provider={provider} />
                    ))}
                </Stack>
            )}
        </Modal>
    );
};

const UserAvatar = ({ className }: UserAvatarProps): ReactNode => {
    const { accessToken, user } = useStoreSlice(authSlice);
    const authActions = useStoreActions(authSlice);
    const isAuthenticated = accessToken !== null && user !== null;
    const handlePress = useCallback(() => {
        isAuthenticated ? authActions.openAccountOverlay() : authActions.openAuthOverlay();
    }, [authActions, isAuthenticated]);

    return (
        <Button
            variant='ghost'
            onPress={handlePress}
            className={`w-8 h-8 p-0 rounded-full ${className ?? ''}`}
            tooltip={isAuthenticated ? 'Account' : 'Sign in'}
        >
            {isAuthenticated && user ? (
                <Avatar fallback={getInitials(user.email)} className='w-full h-full' />
            ) : (
                <Icon name='LogIn' className='w-5 h-5 opacity-70' />
            )}
        </Button>
    );
};

// --- [EXPORT] ----------------------------------------------------------------

export { AuthOverlay, B as AUTH_CONFIG, UserAvatar };
