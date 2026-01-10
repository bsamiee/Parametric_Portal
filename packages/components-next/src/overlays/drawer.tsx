/**
 * Drawer: Gesture-driven slide-in panel with all 4 directions.
 * Wraps Vaul with theme-driven CSS variable styling.
 * Vaul props pass through directly - we add: theme (color/size/variant), trigger, nested, onClose.
 * REQUIRED: color, size props on Drawer - no defaults.
 * Features: context inheritance, FloatingNode for nested floats, Vaul.NestedRoot via nested prop.
 */
import { FloatingNode, useFloatingNodeId } from '@floating-ui/react';
import { readCssVar } from '@parametric-portal/runtime/runtime';
import { createContext, useContext, useMemo, type FC, type ReactNode, type Ref } from 'react';
import { Drawer, type DialogProps } from 'vaul';
import { cn, composeTailwindRenderProps } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type DrawerSlotProps = { readonly children?: ReactNode; readonly className?: string };
type DrawerTriggerProps = DrawerSlotProps & { readonly asChild?: boolean };
type DrawerHeaderProps = DrawerSlotProps & { readonly ref?: Ref<HTMLDivElement> };
type DrawerContentProps = DrawerSlotProps & { readonly ref?: Ref<HTMLDivElement> };
type DrawerContextValue = { readonly color: string; readonly size: string; readonly variant: string | undefined };
type DrawerProps = Omit<DialogProps, 'children'> & {
	readonly children: ReactNode;
	readonly className?: string;
	readonly color: string;
	readonly contentRef?: Ref<HTMLDivElement>;
	readonly nested?: boolean;
	readonly onClose?: () => void;
	readonly size: string;
	readonly trigger?: ReactNode;
	readonly variant?: string;
};

// --- [CONTEXT] ---------------------------------------------------------------

const DrawerContext = createContext<DrawerContextValue | null>(null);

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	cssVars: Object.freeze({
		fadeFromIndex: '--drawer-fade-from-index',
		snapPoints: ['--drawer-snap-point-1', '--drawer-snap-point-2', '--drawer-snap-point-3', '--drawer-snap-point-4', '--drawer-snap-point-5'] as const,
	}),
	slot: Object.freeze({
		body: cn(
			'flex-1 overflow-auto',
			'p-(--drawer-padding)',
			'text-(--drawer-font-size)',
		),
		content: cn(
			'fixed z-(--drawer-z-index) flex flex-col outline-none',
			'bg-(--drawer-bg) text-(--drawer-fg)',
			'border-(--drawer-border-width) border-(--drawer-border-color)',
		),
		contentBottom: cn(
			'inset-x-0 bottom-0 max-h-(--drawer-max-height)',
			'rounded-t-(--drawer-radius)',
			'shadow-(--drawer-shadow-bottom)',
		),
		contentLeft: cn(
			'inset-y-0 left-0 h-full max-w-(--drawer-max-width)',
			'rounded-r-(--drawer-radius)',
			'shadow-(--drawer-shadow-left)',
		),
		contentRight: cn(
			'inset-y-0 right-0 h-full max-w-(--drawer-max-width)',
			'rounded-l-(--drawer-radius)',
			'shadow-(--drawer-shadow-right)',
		),
		contentTop: cn(
			'inset-x-0 top-0 max-h-(--drawer-max-height)',
			'rounded-b-(--drawer-radius)',
			'shadow-(--drawer-shadow-top)',
		),
		description: cn(
			'mt-(--drawer-description-margin-top)',
			'text-(--drawer-font-size) text-(--drawer-description-fg)',
		),
		footer: cn(
			'flex items-center justify-end shrink-0',
			'gap-(--drawer-button-gap) p-(--drawer-padding) pt-0',
		),
		handle: cn(
			'mx-auto my-(--drawer-handle-margin)',
			'w-(--drawer-handle-width) h-(--drawer-handle-height)',
			'rounded-full bg-(--drawer-handle-bg)',
		),
		header: cn(
			'flex flex-col shrink-0',
			'p-(--drawer-padding) pb-0',
		),
		overlay: cn(
			'fixed inset-0 z-(--drawer-z-index)',
			'bg-(--drawer-overlay-bg)',
		),
		title: cn( 'text-(--drawer-header-font-size) font-(--drawer-header-font-weight)', ),
	}),
});
const contentDirectionClass: Readonly<Record<NonNullable<DialogProps['direction']>, string>> = Object.freeze({
	bottom: B.slot.contentBottom,
	left: B.slot.contentLeft,
	right: B.slot.contentRight,
	top: B.slot.contentTop,
});

// --- [SUB_COMPONENTS] --------------------------------------------------------

const DrawerTrigger: FC<DrawerTriggerProps> = ({ asChild = true, children, className }) => (
	<Drawer.Trigger asChild={asChild} className={className}>{children}</Drawer.Trigger>
);
const DrawerHandle: FC<{ readonly className?: string }> = ({ className }) => (
	<Drawer.Handle className={cn(B.slot.handle, className)} data-slot="drawer-handle" />
);
const DrawerHeader: FC<DrawerHeaderProps> = ({ children, className, ref }) => (
	<div className={cn(B.slot.header, className)} data-slot="drawer-header" ref={ref}>{children}</div>
);
const DrawerTitle: FC<DrawerSlotProps> = ({ children, className }) => (
	<Drawer.Title className={cn(B.slot.title, className)} data-slot="drawer-title">{children}</Drawer.Title>
);
const DrawerDescription: FC<DrawerSlotProps> = ({ children, className }) => (
	<Drawer.Description className={cn(B.slot.description, className)} data-slot="drawer-description">{children}</Drawer.Description>
);
const DrawerBody: FC<DrawerSlotProps> = ({ children, className }) => (
	<div className={cn(B.slot.body, className)} data-slot="drawer-body">{children}</div>
);
const DrawerFooter: FC<DrawerSlotProps> = ({ children, className }) => (
	<div className={cn(B.slot.footer, className)} data-slot="drawer-footer">{children}</div>
);
const DrawerClose: FC<DrawerSlotProps> = ({ children, className }) => (
	<Drawer.Close className={className}>{children}</Drawer.Close>
);

// --- [ROOT_COMPONENT] --------------------------------------------------------

const DrawerRoot: FC<DrawerProps> = ({
	children, className, color, contentRef, direction = 'left', nested, onClose, onOpenChange, size, trigger, variant, ...vaulProps }) => {
	const nodeId = useFloatingNodeId();
	const contextValue = useMemo(() => ({ color, size, variant }), [color, size, variant]);
	const snapConfig = useMemo(() => {
		const points = B.cssVars.snapPoints.map(readCssVar).filter(Boolean).map((v) => (v.endsWith('px') ? v : Number.parseFloat(v)));
		const fade = Number.parseInt(readCssVar(B.cssVars.fadeFromIndex), 10);
		return points.length > 0 ? { snapPoints: points, ...(!Number.isNaN(fade) && { fadeFromIndex: fade }) } : {};
	}, []);
	const handleOpenChange = (open: boolean): void => { onOpenChange?.(open); !open && onClose?.(); };
	const Component = nested ? Drawer.NestedRoot : Drawer.Root;
	const contentClassName = composeTailwindRenderProps(className, cn(B.slot.content, contentDirectionClass[direction])) as string;
	return (
		<DrawerContext.Provider value={contextValue}>
			<Component direction={direction} onOpenChange={handleOpenChange} {...snapConfig} {...(vaulProps as DialogProps)}>
				{trigger && <Drawer.Trigger asChild>{trigger}</Drawer.Trigger>}
				<Drawer.Portal>
					<Drawer.Overlay className={B.slot.overlay} data-slot="drawer-overlay" />
					<FloatingNode id={nodeId}>
						<Drawer.Content
							className={contentClassName}
							data-color={color}
							data-direction={direction}
							data-size={size}
							data-slot="drawer"
							data-variant={variant}
							ref={contentRef}
						>
							{children}
						</Drawer.Content>
					</FloatingNode>
				</Drawer.Portal>
			</Component>
		</DrawerContext.Provider>
	);
};

// --- [COMPOUND] --------------------------------------------------------------

const DrawerCompound = Object.assign(DrawerRoot, {
	Body: DrawerBody,
	Close: DrawerClose,
	Description: DrawerDescription,
	Footer: DrawerFooter,
	Handle: DrawerHandle,
	Header: DrawerHeader,
	Title: DrawerTitle,
	Trigger: DrawerTrigger,
	useContext: () => useContext(DrawerContext),
});

// --- [EXPORT] ----------------------------------------------------------------

export { DrawerCompound as Drawer };
export type { DrawerContentProps, DrawerContextValue, DrawerHeaderProps, DrawerProps, DrawerSlotProps, DrawerTriggerProps };
