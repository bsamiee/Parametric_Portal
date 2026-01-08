/**
 * Confirmation dialog for destructive menu actions.
 * Menu-specific infrastructure - integrated into MenuItem via confirm + destructive props.
 * Uses alertdialog role - no escape/outside-click dismiss per ARIA spec.
 */
import {
	FloatingFocusManager, FloatingOverlay, FloatingPortal, useFloating, useId, useInteractions,
	useRole, useTransitionStatus,
} from '@floating-ui/react';
import { readCssMs } from '@parametric-portal/runtime/runtime';
import type { FC } from 'react';
import { useCallback, useState } from 'react';
import { cn } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ConfirmConfig = {
	readonly cancelLabel: string;
	readonly confirmLabel: string;
	readonly description: string;
	readonly title: string;
};
type ConfirmState = {
	readonly cancel: () => void;
	readonly confirm: () => void;
	readonly isOpen: boolean;
	readonly open: (onConfirm: () => void) => void;
};
type ConfirmDialogProps = {
	readonly config: ConfirmConfig;
	readonly onCancel: () => void;
	readonly onConfirm: () => void;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVar: Object.freeze({
		transitionDuration: '--confirm-dialog-transition-duration',
	}),
	slot: Object.freeze({
		actions: cn('flex justify-end gap-(--confirm-dialog-button-gap) mt-(--confirm-dialog-actions-margin-top)'),
		buttonCancel: cn(
			'px-(--confirm-dialog-button-padding-x) py-(--confirm-dialog-button-padding-y) rounded-(--confirm-dialog-button-radius)',
			'bg-(--confirm-dialog-button-cancel-bg) text-(--confirm-dialog-button-cancel-fg)',
			'transition-colors duration-(--confirm-dialog-transition-duration)',
			'cursor-pointer outline-none',
			'hovered:opacity-80',
			'focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		buttonConfirm: cn(
			'px-(--confirm-dialog-button-padding-x) py-(--confirm-dialog-button-padding-y) rounded-(--confirm-dialog-button-radius)',
			'bg-(--confirm-dialog-button-confirm-bg) text-(--confirm-dialog-button-confirm-fg)',
			'transition-colors duration-(--confirm-dialog-transition-duration)',
			'cursor-pointer outline-none',
			'hovered:opacity-80',
			'focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		content: cn(
			'relative p-(--confirm-dialog-padding) max-w-(--confirm-dialog-max-width) w-full',
			'bg-(--confirm-dialog-bg) text-(--confirm-dialog-fg)',
			'rounded-(--confirm-dialog-radius) shadow-(--confirm-dialog-shadow)',
			'border-(--confirm-dialog-border-width) border-(--confirm-dialog-border-color)',
			'[transition-property:opacity,transform]',
			'duration-(--confirm-dialog-transition-duration)',
			'ease-(--confirm-dialog-transition-easing)',
		),
		description: cn('text-(--confirm-dialog-font-size) text-(--confirm-dialog-description-fg) mt-(--confirm-dialog-description-margin-top)'),
		overlay: cn(
			'fixed inset-0 z-(--confirm-dialog-z-index) flex items-center justify-center',
			'bg-(--confirm-dialog-overlay-bg)',
			'[transition-property:opacity]',
			'duration-(--confirm-dialog-transition-duration)',
			'ease-(--confirm-dialog-transition-easing)',
		),
		title: cn('text-(--confirm-dialog-header-font-size) font-(--confirm-dialog-header-font-weight)'),
	}),
});

// --- [HOOK] ------------------------------------------------------------------

const useConfirm = (): ConfirmState => {
	const [isOpen, setIsOpen] = useState(false);
	const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
	const open = useCallback((onConfirm: () => void) => {
		setPendingAction(() => onConfirm);
		setIsOpen(true);
	}, []);
	const confirm = useCallback(() => {
		pendingAction?.();
		setPendingAction(null);
		setIsOpen(false);
	}, [pendingAction]);
	const cancel = useCallback(() => {
		setPendingAction(null);
		setIsOpen(false);
	}, []);
	return { cancel, confirm, isOpen, open };
};

// --- [COMPONENT] -------------------------------------------------------------

const ConfirmDialog: FC<ConfirmDialogProps> = ({ config, onCancel, onConfirm }) => {
	const headingId = useId();
	const descId = useId();
	const transitionDuration = readCssMs(B.cssVar.transitionDuration);
	const { context, refs } = useFloating({ open: true });
	const { getFloatingProps } = useInteractions([useRole(context, { role: 'alertdialog' })]);
	const { isMounted, status } = useTransitionStatus(context, { duration: transitionDuration });
	return isMounted ? (
		<FloatingPortal>
			<FloatingOverlay className={B.slot.overlay} data-status={status} lockScroll>
				<FloatingFocusManager context={context} modal>
					{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: alertdialog supports aria-labelledby per ARIA spec */}
					<div
						{...getFloatingProps()}
						aria-describedby={descId}
						aria-labelledby={headingId}
						className={B.slot.content}
						data-slot='confirm-dialog'
						data-status={status}
						ref={refs.setFloating}
					>
						<h2 className={B.slot.title} id={headingId}> {config.title} </h2>
						<p className={B.slot.description} id={descId}> {config.description} </p>
						<div className={B.slot.actions}>
							<button className={B.slot.buttonCancel} onClick={onCancel} type='button'> {config.cancelLabel} </button>
							{/* biome-ignore lint/a11y/noAutofocus: confirm button should auto-focus for destructive action UX */}
							<button autoFocus className={B.slot.buttonConfirm} onClick={onConfirm} type='button'> {config.confirmLabel} </button>
						</div>
					</div>
				</FloatingFocusManager>
			</FloatingOverlay>
		</FloatingPortal>
	) : null;
};

// --- [EXPORT] ----------------------------------------------------------------

export { ConfirmDialog, useConfirm };
export type { ConfirmConfig, ConfirmState };
