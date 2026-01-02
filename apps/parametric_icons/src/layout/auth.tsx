/**
 * Auth components: overlay, OAuth buttons, user avatar.
 * Uses existing Modal/Button/Avatar/Icon from ui.ts with HttpApiClient auth dispatch.
 */

import type { HttpClient } from '@effect/platform';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { useAuthStore } from '@parametric-portal/runtime/stores/auth';
import type { OAuthProvider } from '@parametric-portal/types/database';
import { Option, pipe } from 'effect';
import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { auth } from '../infrastructure.ts';
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

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    oauth: {
        allowedDomains: ['accounts.google.com', 'github.com', 'login.microsoftonline.com'],
    },
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

// --- [ENTRY_POINT] -----------------------------------------------------------

const OAuthButton = ({ provider }: { readonly provider: OAuthProvider }): ReactNode => {
    const setLoading = useAuthStore((s) => s.setLoading);
    const config = B.providers[provider];
    const oauthMutation = useEffectMutate<{ url: string }, OAuthProvider, unknown, HttpClient.HttpClient>(
        (p) => auth.initiateOAuth(p),
        {
            onError: () => setLoading(false),
            onSuccess: (data) =>
                pipe(
                    Option.liftThrowable(() => new URL(data.url))(),
                    Option.filter((url) => B.oauth.allowedDomains.some((domain) => url.hostname.endsWith(domain))),
                    Option.match({
                        onNone: () => setLoading(false),
                        // biome-ignore lint/suspicious/noAssignInExpressions: Expression-centric redirect
                        onSome: () => (globalThis.location.href = data.url),
                    }),
                ),
        },
    );
    const handlePress = useCallback(() => {
        setLoading(true);
        oauthMutation.mutate(provider);
    }, [setLoading, provider, oauthMutation]);
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
    const isAuthOverlayOpen = useAuthStore((s) => s.isAuthOverlayOpen);
    const isLoading = useAuthStore((s) => s.isLoading);
    const closeAuthOverlay = useAuthStore((s) => s.closeAuthOverlay);
    return (
        <Modal isOpen={isAuthOverlayOpen} onClose={closeAuthOverlay} title={B.overlay.title} size={B.overlay.size}>
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
    const accessToken = useAuthStore((s) => s.accessToken);
    const user = useAuthStore((s) => s.user);
    const openAccountOverlay = useAuthStore((s) => s.openAccountOverlay);
    const openAuthOverlay = useAuthStore((s) => s.openAuthOverlay);
    const isAuthenticated = accessToken !== null && user !== null;
    const handlePress = useCallback(() => {
        isAuthenticated ? openAccountOverlay() : openAuthOverlay();
    }, [openAccountOverlay, openAuthOverlay, isAuthenticated]);
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

export { AuthOverlay, UserAvatar };
