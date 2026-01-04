/**
 * Test harness app: Button grid demonstrating theme + async + variants integration.
 * Validates: CSS variable slots, color scales, size variants, useEffectMutate hook, asyncState prop.
 */
import { Button } from '@parametric-portal/components-next/button';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { Runtime } from '@parametric-portal/runtime/runtime';
import { Duration, Effect, Layer } from 'effect';
import { ArrowRight, CheckCircle, Download, Loader2, Mail, Search, Send, Settings, XCircle } from 'lucide-react';
import type { FC } from 'react';

// --- [CONSTANTS] -------------------------------------------------------------

const testRuntime = Runtime.make(Layer.empty);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const simulateAsync = (ms: number, fail: boolean) =>
    Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(ms));
        return fail ? yield* Effect.fail(new Error('Simulated failure')) : { success: true };
    });

// --- [ENTRY_POINT] -----------------------------------------------------------

const Section: FC<{ readonly children: React.ReactNode; readonly title: string }> = ({ children, title }) => (
    <section className='flex flex-col gap-4'>
        <h2 className='text-sm font-semibold uppercase tracking-wider text-(--color-text-500)'>{title}</h2>
        <div className='flex flex-wrap items-center gap-3'>{children}</div>
    </section>
);
const SuccessFlowButton: FC = () => {
    const { state, mutate } = useEffectMutate(() => simulateAsync(1500, false));
    return (
        <Button
            asyncState={state}
            childrenAsync={{ failure: 'Failed!', loading: 'Working...', success: 'Done!' }}
            color='primary'
            onPress={() => mutate(undefined)}
            prefixAsync={{ failure: XCircle, loading: Loader2, success: CheckCircle }}
            size='md'
            variant='solid'
        >
            Success Flow
        </Button>
    );
};
const FailureFlowButton: FC = () => {
    const { state, mutate } = useEffectMutate(() => simulateAsync(1500, true));
    return (
        <Button
            asyncState={state}
            childrenAsync={{ failure: 'Error!', loading: 'Trying...', success: 'OK' }}
            color='danger'
            onPress={() => mutate(undefined)}
            prefixAsync={{ failure: XCircle, loading: Loader2, success: CheckCircle }}
            size='md'
            variant='solid'
        >
            Failure Flow
        </Button>
    );
};
const SlowOperationButton: FC = () => {
    const { state, mutate } = useEffectMutate(() => simulateAsync(3000, false));
    return (
        <Button
            asyncState={state}
            childrenAsync={{ loading: 'Processing...' }}
            color='secondary'
            onPress={() => mutate(undefined)}
            prefixAsync={{ loading: Loader2 }}
            size='md'
            variant='solid'
        >
            Slow Operation
        </Button>
    );
};
const FastOperationButton: FC = () => {
    const { state, mutate } = useEffectMutate(() => simulateAsync(500, false));
    return (
        <Button
            asyncState={state}
            color='accent'
            onPress={() => mutate(undefined)}
            prefixAsync={{ loading: Loader2 }}
            size='md'
            variant='solid'
        >
            Fast (icon only)
        </Button>
    );
};
const AppContent: FC = () => (
    <main className='min-h-screen bg-(--color-surface-500) p-8'>
        <div className='mx-auto flex max-w-4xl flex-col gap-8'>
            <header className='flex flex-col gap-2'>
                <h1 className='text-2xl font-bold text-(--color-text-500)'>Theme + Components Test Harness</h1>
                <p className='text-sm text-(--color-text-700)'>
                    Validates: CSS variable slots, color scales, size/variant props, useEffectMutate hook, asyncState
                    prop
                </p>
            </header>

            <Section title='Size Variants (primary, solid)'>
                <Button color='primary' size='sm' variant='solid'>
                    Small
                </Button>
                <Button color='primary' size='md' variant='solid'>
                    Medium
                </Button>
                <Button color='primary' size='lg' variant='solid'>
                    Large
                </Button>
            </Section>

            <Section title='Style Variants (md)'>
                <Button color='primary' size='md' variant='solid'>
                    Solid
                </Button>
                <Button color='primary' size='md' variant='outline'>
                    Outline
                </Button>
                <Button color='primary' size='md' variant='ghost'>
                    Ghost
                </Button>
            </Section>

            <Section title='Color Variants (md, solid)'>
                <Button color='primary' size='md' variant='solid'>
                    Primary
                </Button>
                <Button color='secondary' size='md' variant='solid'>
                    Secondary
                </Button>
                <Button color='success' size='md' variant='solid'>
                    Success
                </Button>
                <Button color='warning' size='md' variant='solid'>
                    Warning
                </Button>
                <Button color='danger' size='md' variant='solid'>
                    Danger
                </Button>
                <Button color='accent' size='md' variant='solid'>
                    Accent
                </Button>
            </Section>

            <Section title='Static Icons (prefix/suffix)'>
                <Button color='primary' prefix={Search} size='md' variant='solid'>
                    Search
                </Button>
                <Button color='secondary' prefix={Mail} size='md' variant='solid'>
                    Email
                </Button>
                <Button color='success' prefix={Download} size='md' variant='solid'>
                    Download
                </Button>
                <Button color='accent' size='md' suffix={ArrowRight} variant='solid'>
                    Next
                </Button>
                <Button color='warning' prefix={Settings} size='md' suffix={ArrowRight} variant='outline'>
                    Settings
                </Button>
                <Button color='danger' prefix={Send} size='md' variant='ghost'>
                    Send
                </Button>
            </Section>

            <Section title='Async via useEffectMutate + asyncState'>
                <SuccessFlowButton />
                <FailureFlowButton />
                <SlowOperationButton />
                <FastOperationButton />
            </Section>

            <Section title='Disabled State'>
                <Button color='primary' isDisabled size='md' variant='solid'>
                    Disabled Solid
                </Button>
                <Button color='secondary' isDisabled size='md' variant='outline'>
                    Disabled Outline
                </Button>
                <Button color='accent' isDisabled size='md' variant='ghost'>
                    Disabled Ghost
                </Button>
            </Section>

            <Section title='Inert State (non-interactive section)'>
                <div className='flex gap-3' inert>
                    <Button color='primary' size='md' variant='solid'>
                        Inert Solid
                    </Button>
                    <Button color='secondary' size='md' variant='outline'>
                        Inert Outline
                    </Button>
                </div>
                <p className='text-xs text-(--color-text-700)'>Buttons inside inert container are non-interactive</p>
            </Section>
        </div>
    </main>
);
const App: FC = () => (
    <Runtime.Provider runtime={testRuntime}>
        <AppContent />
    </Runtime.Provider>
);

// --- [EXPORT] ----------------------------------------------------------------

export { App };
