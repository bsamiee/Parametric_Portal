/**
 * Test harness: Minimal component validation with theme integration.
 * Tests: Button (async states), TextField (multiline).
 */
import { Button } from '@parametric-portal/components-next/actions/button';
import { TextField } from '@parametric-portal/components-next/inputs/text-field';
import { useEffectMutate } from '@parametric-portal/runtime/hooks/effect';
import { Runtime } from '@parametric-portal/runtime/runtime';
import { Duration, Effect, Layer } from 'effect';
import { Check, Edit, Loader2, XCircle } from 'lucide-react';
import type { FC, ReactNode } from 'react';

// --- [CONSTANTS] -------------------------------------------------------------

const testRuntime = Runtime.make(Layer.empty);
const simulateAsync = (ms: number, fail: boolean) =>
    Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(ms));
        return fail ? yield* Effect.fail(new Error('Failed')) : { ok: true };
    });

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const Section: FC<{ readonly children: ReactNode; readonly title: string }> = ({ children, title }) => (
    <section className='flex flex-col gap-4'>
        <h2 className='text-sm font-semibold uppercase tracking-wider text-(--color-text-500)'>{title}</h2>
        <div className='flex flex-wrap items-start gap-3'>{children}</div>
    </section>
);

// --- [DEMOS] -----------------------------------------------------------------

const AsyncButtonDemo: FC = () => {
    const success = useEffectMutate(() => simulateAsync(1500, false));
    const failure = useEffectMutate(() => simulateAsync(1500, true));
    return (
        <>
            <Button
                asyncState={success.state}
                children={{ default: 'Success Flow', loading: 'Working...', success: 'Done!' }}
                color='primary'
                onPress={() => success.mutate(undefined)}
                prefix={{ loading: Loader2, success: Check }}
                size='md'
                variant='solid'
            />
            <Button
                asyncState={failure.state}
                children={{ default: 'Failure Flow', failure: 'Error!', loading: 'Trying...' }}
                color='danger'
                onPress={() => failure.mutate(undefined)}
                prefix={{ failure: XCircle, loading: Loader2 }}
                size='md'
                variant='solid'
            />
        </>
    );
};

const TextFieldDemo: FC = () => {
    const asyncMutate = useEffectMutate(() => simulateAsync(1500, false));
    return (
        <>
            <TextField color='primary' label='Username' placeholder='Enter username...' size='md' />
            <TextField
                color='primary'
                description='Multiline textarea with 4 rows'
                label='Description'
                multiline
                placeholder='Enter description...'
                rows={4}
                size='md'
            />
            <TextField
                asyncState={asyncMutate.state}
                color='primary'
                label='Async Field'
                placeholder='Type and submit...'
                prefix={{ default: Edit, loading: Loader2, success: Check }}
                size='md'
            />
            <Button
                children={{ default: 'Submit' }}
                color='primary'
                onPress={() => asyncMutate.mutate(undefined)}
                size='sm'
                variant='outline'
            />
        </>
    );
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const AppContent: FC = () => (
    <main className='min-h-screen bg-(--color-surface-500) p-8'>
        <div className='mx-auto flex max-w-4xl flex-col gap-8'>
            <header className='flex flex-col gap-2'>
                <h1 className='text-2xl font-bold text-(--color-text-500)'>Component Test Harness</h1>
                <p className='text-sm text-(--color-text-700)'>Minimal validation: async states, multiline fields.</p>
            </header>
            <Section title='Button Variants'>
                <Button children={{ default: 'Primary' }} color='primary' size='md' variant='solid' />
                <Button children={{ default: 'Outline' }} color='primary' size='md' variant='outline' />
                <Button children={{ default: 'Ghost' }} color='primary' size='md' variant='ghost' />
            </Section>
            <Section title='Async Button States'>
                <AsyncButtonDemo />
            </Section>
            <Section title='TextField Components'>
                <TextFieldDemo />
            </Section>
        </div>
    </main>
);

const App: FC = () => (
    <Runtime.Provider disposeOnUnmount runtime={testRuntime}>
        <AppContent />
    </Runtime.Provider>
);

// --- [EXPORT] ----------------------------------------------------------------

export { App };
