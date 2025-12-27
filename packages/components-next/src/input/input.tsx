/**
 * Input compound component with CVA variants.
 * Grounding: Compound pattern with React Aria accessibility.
 */
import {
    createContext,
    createElement,
    type FC,
    forwardRef,
    type ReactNode,
    type RefObject,
    useContext,
    useRef,
} from 'react';
import type { AriaTextFieldOptions } from 'react-aria';
import { mergeProps, useFocusRing, useTextField } from 'react-aria';
import { cn } from '../core/variants.ts';
import { type InputRootVariants, inputFieldVariants, inputRootVariants } from './input.variants.ts';

// --- [TYPES] -----------------------------------------------------------------

type InputContextValue = {
    readonly inputRef: RefObject<HTMLInputElement | null>;
    readonly isDisabled: boolean;
    readonly size: InputRootVariants['size'];
};
type InputRootProps = AriaTextFieldOptions<'input'> &
    InputRootVariants & {
        readonly children?: ReactNode;
        readonly className?: string;
    };
type InputFieldProps = {
    readonly className?: string;
    readonly placeholder?: string;
};
type InputAddonProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly side?: 'left' | 'right';
};
type InputIconProps = {
    readonly children?: ReactNode;
    readonly className?: string;
    readonly side?: 'left' | 'right';
};

// --- [CONTEXT] ---------------------------------------------------------------

const InputContext = createContext<InputContextValue | null>(null);
const useInputContext = (): InputContextValue => {
    const ctx = useContext(InputContext);
    if (!ctx) throw new Error('Input.* must be used within Input.Root');
    return ctx;
};

// --- [COMPONENTS] ------------------------------------------------------------

const InputRoot = forwardRef<HTMLInputElement, InputRootProps>(
    ({ children, className, size = 'md', state = 'default', ...ariaProps }, forwardedRef) => {
        const internalRef = useRef<HTMLInputElement>(null);
        const ref = forwardedRef ?? internalRef;
        return createElement(
            InputContext.Provider,
            {
                value: {
                    inputRef: ref as RefObject<HTMLInputElement | null>,
                    isDisabled: ariaProps.isDisabled ?? false,
                    size,
                },
            },
            createElement(
                'div',
                {
                    className: cn(inputRootVariants({ size, state }), className),
                    'data-disabled': ariaProps.isDisabled || undefined,
                    'data-state': state,
                },
                children,
            ),
        );
    },
);
InputRoot.displayName = 'Input';

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(({ className, placeholder }, forwardedRef) => {
    const { inputRef, isDisabled, size } = useInputContext();
    const internalRef = useRef<HTMLInputElement>(null);
    const resolvedRef = (forwardedRef ?? inputRef ?? internalRef) as RefObject<HTMLInputElement>;
    const textFieldOptions = {
        isDisabled,
        ...(placeholder === undefined ? {} : { placeholder }),
    };
    const { inputProps } = useTextField(textFieldOptions, resolvedRef);
    const { focusProps, isFocusVisible } = useFocusRing();
    return createElement('input', {
        ...mergeProps(inputProps, focusProps),
        className: cn(inputFieldVariants({ size }), className),
        'data-focus-visible': isFocusVisible || undefined,
        ref: resolvedRef,
    });
});
InputField.displayName = 'Input.Field';

const InputAddon: FC<InputAddonProps> = ({ children, className, side = 'left' }) =>
    createElement(
        'div',
        {
            className: cn(
                'flex items-center text-[var(--color-text-200)]',
                side === 'left' ? 'pr-2' : 'pl-2',
                className,
            ),
            'data-slot': 'addon',
        },
        children,
    );
InputAddon.displayName = 'Input.Addon';

const InputIcon: FC<InputIconProps> = ({ children, className, side = 'left' }) =>
    createElement(
        'span',
        {
            className: cn(
                'flex shrink-0 items-center text-[var(--color-text-200)]',
                side === 'left' ? '-ml-0.5' : '-mr-0.5',
                className,
            ),
            'data-slot': 'icon',
        },
        children,
    );
InputIcon.displayName = 'Input.Icon';

// --- [COMPOUND_EXPORT] -------------------------------------------------------

const Input = Object.assign(InputRoot, {
    Addon: InputAddon,
    Field: InputField,
    Icon: InputIcon,
});

// --- [EXPORT] ----------------------------------------------------------------

// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
export { Input, InputAddon, InputField, InputIcon, InputRoot };
// biome-ignore lint/style/useComponentExportOnlyModules: Compound component pattern requires co-located type exports
export type { InputAddonProps, InputFieldProps, InputIconProps, InputRootProps };
