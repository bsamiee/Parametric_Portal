/**
 * Dialog: Accessible modal dialog with focus trap, backdrop blur, and enter/exit animations.
 * Uses React Aria Components Dialog with ModalOverlay for focus management.
 * useDialog hook provides deferred action pattern for confirmation workflows.
 */
import { AsyncState } from '@parametric-portal/types/async';
import type { CSSProperties, FC, ReactNode, Ref, RefObject } from 'react';
import { createContext, useContext, useMemo, useRef, useState } from 'react';
import {
	Dialog as RACDialog, type DialogProps as RACDialogProps, DialogTrigger as RACDialogTrigger,
	Heading, Modal as RACModal, ModalOverlay as RACModalOverlay,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { cn, composeTailwindRenderProps, defined } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type DialogRole = 'alertdialog' | 'dialog';
type DialogBehavior = { backdropBlur: boolean; isDismissable: boolean; isKeyboardDismissDisabled: boolean; role: DialogRole };
type DialogContextValue = { readonly role: DialogRole | undefined };
type DialogSlotProps = { readonly children?: ReactNode; readonly className?: string };
type DialogHeaderProps = DialogSlotProps & { readonly description?: ReactNode; readonly title?: ReactNode };
type DialogProps = DialogBaseProps & DialogSpecificProps;
type DialogButton = {
	readonly action: 'close' | 'confirm';
	readonly autoFocus?: boolean;
	readonly className?: string;
	readonly label: ReactNode;
};
type DialogRenderContext = {
	readonly close: () => void;
	readonly confirm: () => void;
	readonly isOpen: boolean;
	readonly isPending: boolean;
};
type DialogConfig = {
	readonly asyncState?: AsyncState<unknown, unknown>;
	readonly backdropBlur?: boolean;
	readonly buttons?: readonly DialogButton[];
	readonly className?: string;
	readonly content?: ReactNode | ((ctx: DialogRenderContext) => ReactNode);
	readonly description?: ReactNode;
	readonly form?: { readonly id: string; readonly submitOnConfirm?: boolean };
	readonly isDismissable?: boolean;
	readonly isKeyboardDismissDisabled?: boolean;
	readonly onOpenChange?: (open: boolean) => void;
	readonly open?: boolean;
	readonly overlayClassName?: string;
	readonly role?: DialogRole;
	readonly title?: ReactNode;
};
type DialogResult<P extends object = object> = {
	readonly close: () => void;
	readonly confirm: () => void;
	readonly isOpen: boolean;
	readonly isPending: boolean;
	readonly open: (onConfirm?: () => void) => void;
	readonly props: P & { readonly ref: Ref<HTMLElement> };
	readonly ref: RefObject<HTMLElement | null>;
	readonly render: (() => ReactNode) | null;
};
type DialogSpecificProps = {
	readonly backdropBlur?: boolean;
	readonly children?: ReactNode;
	readonly className?: RACDialogProps['className'];
	readonly closeOnInteractOutside?: boolean;
	readonly defaultOpen?: boolean;
	readonly isDismissable?: boolean;
	readonly isKeyboardDismissDisabled?: boolean;
	readonly isOpen?: boolean;
	readonly overlayClassName?: string;
	readonly overlayStyle?: CSSProperties;
	readonly ref?: Ref<HTMLElement>;
	readonly role?: DialogRole;
	readonly style?: CSSProperties;
	readonly trigger?: ReactNode;
};
type DialogBehaviorInput = {
	readonly backdropBlur?: boolean | undefined;
	readonly buttons?: readonly DialogButton[] | undefined;
	readonly isDismissable?: boolean | undefined;
	readonly isKeyboardDismissDisabled?: boolean | undefined;
	readonly role?: DialogRole | undefined;
};
type DialogBaseProps = {
	readonly onClose?: () => void;
	readonly onOpenChange?: (open: boolean) => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		body: cn('flex-1 overflow-auto p-(--dialog-padding)', 'text-(--dialog-font-size) text-(--dialog-fg)'),
		button: cn(
			'px-(--dialog-button-padding-x) py-(--dialog-button-padding-y)',
			'rounded-(--dialog-button-radius)',
			'transition-colors cursor-pointer outline-none',
			'focus-visible:ring-2 focus-visible:ring-(--focus-ring-color)',
		),
		buttonCancel: 'bg-(--dialog-button-cancel-bg) text-(--dialog-button-cancel-fg)',
		buttonConfirm: 'bg-(--dialog-button-confirm-bg) text-(--dialog-button-confirm-fg)',
		content: cn(
			'relative flex flex-col outline-none',
			'max-w-(--dialog-max-width) w-full max-h-(--dialog-max-height)',
			'bg-(--dialog-bg) text-(--dialog-fg) rounded-(--dialog-radius) shadow-(--dialog-shadow)',
			'border-(--dialog-border-width) border-(--dialog-border-color)',
		),
		description: cn('mt-(--dialog-description-margin-top) text-(--dialog-font-size) text-(--dialog-description-fg)'),
		footer: cn('flex items-center justify-end shrink-0 gap-(--dialog-button-gap) mt-(--dialog-actions-margin-top) p-(--dialog-padding) pt-0'),
		header: cn('flex flex-col shrink-0 p-(--dialog-padding) pb-0'),
		modal: cn(
			'outline-none',
			'entering:animate-in entering:fade-in entering:zoom-in-95 entering:slide-in-from-bottom-2',
			'entering:duration-(--dialog-transition-duration) entering:ease-(--dialog-transition-easing)',
			'exiting:animate-out exiting:fade-out exiting:zoom-out-95 exiting:slide-out-to-bottom-2',
			'exiting:duration-(--dialog-transition-duration) exiting:ease-(--dialog-transition-easing)',
		),
		overlay: cn(
			'fixed inset-0 z-(--dialog-z-index) flex items-center justify-center bg-(--dialog-overlay-bg)',
			'entering:animate-in entering:fade-in entering:duration-(--dialog-transition-duration) entering:ease-(--dialog-transition-easing)',
			'exiting:animate-out exiting:fade-out exiting:duration-(--dialog-transition-duration) exiting:ease-(--dialog-transition-easing)',
		),
		overlayBlur: 'backdrop-blur-sm',
		title: cn('text-(--dialog-header-font-size) font-(--dialog-header-font-weight) text-(--dialog-fg)'),
	}),
});
const DialogContext = createContext<DialogContextValue | null>(null);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const resolveDialogBehavior = (cfg: DialogBehaviorInput | undefined): DialogBehavior => {
	const hasConfirmButton = cfg?.buttons?.some((b) => b.action === 'confirm') ?? false;
	return {
		backdropBlur: cfg?.backdropBlur ?? true,
		isDismissable: cfg?.isDismissable ?? !hasConfirmButton,
		isKeyboardDismissDisabled: cfg?.isKeyboardDismissDisabled ?? hasConfirmButton,
		role: cfg?.role ?? (hasConfirmButton ? 'alertdialog' : 'dialog'),
	};
};

// --- [HOOK] ------------------------------------------------------------------

const useDialog = <P extends object = object>(cfg: DialogConfig | undefined, baseRef?: Ref<HTMLElement>, baseProps?: P): DialogResult<P> => {
	const has = cfg != null;
	const triggerRef = useRef<HTMLElement | null>(null);
	const [internalOpen, setInternalOpen] = useState(false);
	const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
	const isOpen = cfg?.open ?? internalOpen;
	const isPending = AsyncState.isPending(cfg?.asyncState);
	const behavior = resolveDialogBehavior(cfg);
	const { close, confirm, handleOpenChange, open } = useMemo(() => ({
		close: () => { setPendingAction(null); setInternalOpen(false); cfg?.onOpenChange?.(false); },
		confirm: () => {
			cfg?.form?.submitOnConfirm && cfg?.form?.id && (document.getElementById(cfg.form.id) as HTMLFormElement | null)?.requestSubmit();
			pendingAction?.(); setPendingAction(null); setInternalOpen(false); cfg?.onOpenChange?.(false);
		},
		handleOpenChange: (o: boolean) => { setInternalOpen(o); cfg?.onOpenChange?.(o); !o && setPendingAction(null); },
		open: (onConfirm?: () => void) => { onConfirm && setPendingAction(() => onConfirm); setInternalOpen(true); cfg?.onOpenChange?.(true); },
	}), [cfg, pendingAction]);
	const mergedProps = useMemo(() => ({
		...(baseProps ?? ({} as P)),
		ref: baseRef ?? triggerRef,
	} as P & { ref: Ref<HTMLElement> }), [baseProps, baseRef]);
	const contextValue: DialogContextValue = useMemo(() => ({ role: behavior.role }), [behavior.role]);
	const renderContext: DialogRenderContext = { close, confirm, isOpen, isPending };
	const hasContent = cfg?.title || cfg?.description || cfg?.content || cfg?.buttons;
	const render = has && isOpen && hasContent ? () => (
		<RACModalOverlay
			className={cn(B.slot.overlay, behavior.backdropBlur && B.slot.overlayBlur, cfg.overlayClassName)}
			data-slot='dialog-overlay'
			data-theme='dialog'
			isDismissable={behavior.isDismissable}
			isKeyboardDismissDisabled={behavior.isKeyboardDismissDisabled}
			isOpen={isOpen}
			onOpenChange={handleOpenChange}
		>
			<RACModal className={B.slot.modal} data-slot='dialog-modal'>
				<RACDialog
					className={composeTailwindRenderProps(cfg.className, B.slot.content) as string}
					data-slot='dialog'
					role={behavior.role}
				>
					<DialogContext.Provider value={contextValue}>
						{(cfg.title || cfg.description) && (<DialogHeader description={cfg.description} title={cfg.title} />)}
						{cfg.content && (typeof cfg.content === 'function' ? cfg.content(renderContext) : cfg.content)}
						{cfg.buttons && cfg.buttons.length > 0 && (
							<div className={B.slot.footer} data-slot='dialog-footer'>
								{cfg.buttons.map((btn) => (
									<button
										// biome-ignore lint/a11y/noAutofocus: dialog buttons may require autofocus for UX
										autoFocus={btn.autoFocus}
										className={cn(B.slot.button, btn.action === 'confirm' ? B.slot.buttonConfirm : B.slot.buttonCancel, btn.className)}
										disabled={isPending}
										key={`${btn.action}-${String(btn.label)}`}
										onClick={btn.action === 'confirm' ? confirm : close}
										type='button'
									>
										{btn.label}
									</button>
								))}
							</div>
						)}
						<AsyncAnnouncer asyncState={cfg.asyncState} />
					</DialogContext.Provider>
				</RACDialog>
			</RACModal>
		</RACModalOverlay>
	) : null;
	return { close, confirm, isOpen: has && isOpen, isPending, open, props: mergedProps, ref: triggerRef, render };
};

// --- [SUB-COMPONENTS] --------------------------------------------------------

const DialogHeader: FC<DialogHeaderProps> = ({ children, className, description, title }) => (
	<div className={cn(B.slot.header, className)} data-slot='dialog-header'>
		{title && (<Heading className={B.slot.title} data-slot='dialog-title' slot='title'>{title}</Heading>)}
		{description && (<p className={B.slot.description} data-slot='dialog-description'>{description}</p>)}
		{children}
	</div>
);
const DialogBody: FC<DialogSlotProps> = ({ children, className }) => (
	<div className={cn(B.slot.body, className)} data-slot='dialog-body'>{children}</div>
);
const DialogFooter: FC<DialogSlotProps> = ({ children, className }) => (
	<div className={cn(B.slot.footer, className)} data-slot='dialog-footer'>{children}</div>
);

// --- [ENTRY_POINT] -----------------------------------------------------------

const DialogRoot: FC<DialogProps> = ({
	backdropBlur, closeOnInteractOutside, defaultOpen, isDismissable, isKeyboardDismissDisabled, isOpen, overlayClassName, overlayStyle, onClose,
	onOpenChange, children, className, trigger, role: roleProp, ...dialogProps }) => {
	const behavior = resolveDialogBehavior({ backdropBlur, isDismissable, isKeyboardDismissDisabled, role: roleProp });
	const resolvedCloseOnInteractOutside = closeOnInteractOutside ?? behavior.isDismissable;
	const contextValue: DialogContextValue = useMemo(() => ({ role: behavior.role }), [behavior.role]);
	const handleOpenChange = (open: boolean): void => { onOpenChange?.(open); !open && onClose?.(); };
	const dialogContent = (
		<RACModalOverlay
			className={cn(B.slot.overlay, behavior.backdropBlur && B.slot.overlayBlur, overlayClassName)}
			data-slot='dialog-overlay'
			data-theme='dialog'
			isDismissable={resolvedCloseOnInteractOutside}
			isKeyboardDismissDisabled={behavior.isKeyboardDismissDisabled}
			onOpenChange={handleOpenChange}
			{...defined({ defaultOpen, isOpen, style: overlayStyle })}
		>
			<RACModal className={B.slot.modal} data-slot='dialog-modal'>
				<RACDialog
					{...(dialogProps as unknown as RACDialogProps)}
					className={composeTailwindRenderProps(className, B.slot.content) as string}
					data-slot='dialog'
					role={behavior.role}
				>
					<DialogContext.Provider value={contextValue}>
						{children}
					</DialogContext.Provider>
				</RACDialog>
			</RACModal>
		</RACModalOverlay>
	);
	return trigger === undefined ? (dialogContent) : (
		<RACDialogTrigger {...defined({ defaultOpen, isOpen, onOpenChange })}>
			{trigger}
			{dialogContent}
		</RACDialogTrigger>
	);
};

// --- [COMPOUND] --------------------------------------------------------------

const Dialog = Object.assign(DialogRoot, {
	Body: DialogBody,
	Footer: DialogFooter,
	Header: DialogHeader,
	useContext: (): DialogContextValue | null => useContext(DialogContext),
	useDialog,
});

// --- [EXPORT] ----------------------------------------------------------------

export { Dialog, useDialog };
export type { DialogConfig, DialogProps };
