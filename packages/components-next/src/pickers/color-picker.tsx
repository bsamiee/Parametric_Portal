/**
 * ColorPicker: Monolithic color selection with configurable features.
 * Pure presentation - CSS variable driven styling via frozen B constant.
 * REQUIRED: size prop - no defaults.
 *
 * Features (all optional, compose as needed):
 * - mode: 'area' (2D gradient) or 'wheel' (circular hue)
 * - sliders: array of ColorChannel for 1D adjustments
 * - field: hex/channel text input with label/description
 * - swatches: preset color selection
 * - tooltip: standard hover tooltip on root container
 */
import { useMergeRefs } from '@floating-ui/react';
import type { AsyncState } from '@parametric-portal/types/async';
import { Option, pipe } from 'effect';
import type { ComponentProps, FC, ReactNode, Ref } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
	Button as RACButton, type ButtonProps as RACButtonProps, type Color, ColorArea as RACColorArea, ColorField as RACColorField, ColorPicker as RACColorPicker, type ColorPickerProps as RACColorPickerProps,
	ColorSlider as RACColorSlider, type ColorSpace, ColorSwatch as RACColorSwatch, ColorSwatchPicker as RACColorSwatchPicker, ColorSwatchPickerItem as RACColorSwatchPickerItem,
	ColorThumb as RACColorThumb, ColorWheel as RACColorWheel, ColorWheelTrack as RACColorWheelTrack, FieldError, Input, Label, parseColor, SliderOutput as RACSliderOutput, SliderTrack as RACSliderTrack, Text,
} from 'react-aria-components';
import { AsyncAnnouncer } from '../core/announce';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { type GestureProps, useGesture } from '../core/gesture';
import { cn, defined, Slot } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ColorFormat = 'hex' | 'hsl' | 'rgb';
type ColorChannel = NonNullable<ComponentProps<typeof RACColorSlider>['channel']>;
type Orientation = NonNullable<ComponentProps<typeof RACColorSlider>['orientation']>;
type ColorPickerProps = Omit<RACColorPickerProps, 'children' | 'defaultValue' | 'value'> & {
	readonly areaLabel?: string; readonly className?: string; readonly colorSpace?: ColorSpace;
	readonly copyAsyncState?: AsyncState<unknown, unknown>; readonly copyGesture?: GestureProps; readonly copyToClipboard?: (color: Color) => void;
	readonly copyTooltip?: TooltipConfig; readonly defaultValue?: Color | string; readonly eyeDropper?: boolean;
	readonly eyeDropperAsyncState?: AsyncState<unknown, unknown>; readonly eyeDropperGesture?: GestureProps;
	readonly eyeDropperIcon?: ReactNode; readonly eyeDropperLabel?: string; readonly eyeDropperTooltip?: TooltipConfig;
	readonly field?: {
		readonly channel?: ColorChannel; readonly description?: ReactNode; readonly errorMessage?: ReactNode; readonly isInvalid?: boolean;
		readonly isReadOnly?: boolean; readonly isRequired?: boolean; readonly label?: ReactNode;
	};
	readonly innerRadius?: number; readonly isDisabled?: boolean; readonly mode?: 'area' | 'wheel'; readonly onChange?: (color: Color) => void;
	readonly onChangeEnd?: (color: Color) => void; readonly onEyeDropper?: (color: Color) => void; readonly onEyeDropperError?: (error: Error) => void;
	readonly outerRadius?: number; readonly ref?: Ref<HTMLDivElement>; readonly size: string; readonly sliderOrientation?: Orientation;
	readonly sliderShowOutput?: boolean; readonly sliders?: readonly ColorChannel[]; readonly swatch?: boolean; readonly swatchLayout?: 'grid' | 'stack';
	readonly swatches?: readonly string[]; readonly sliderLabels?: Partial<Record<ColorChannel, string>>; readonly thumbTooltip?: boolean;
	readonly thumbTooltipFormat?: ColorFormat; readonly tooltip?: TooltipConfig; readonly value?: Color | string; readonly variant?: string;
	readonly wheelLabel?: string; readonly xChannel?: ColorChannel; readonly yChannel?: ColorChannel;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	defaults: Object.freeze({
		innerRadius: 40,
		outerRadius: 80,
		xChannel: 'saturation' as ColorChannel,
		yChannel: 'brightness' as ColorChannel,
	}),
	slot: Object.freeze({
		alphaPattern: cn(
			'absolute inset-0 -z-10',
			'rounded-inherit',
			'bg-[image:var(--color-picker-alpha-pattern,repeating-conic-gradient(#808080_0_25%,#fff_0_50%))]',
			'bg-(length:--color-picker-alpha-pattern-size,8px_8px)',
		),
		area: cn(
			'relative',
			'w-(--color-picker-area-width) h-(--color-picker-area-height)',
			'rounded-(--color-picker-area-radius)',
			'cursor-crosshair',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:pointer-events-none',
		),
		eyeDropperButton: cn(
			'flex items-center justify-center cursor-pointer',
			'size-(--color-picker-eyedropper-size)',
			'rounded-(--color-picker-eyedropper-radius)',
			'bg-(--color-picker-eyedropper-bg)',
			'text-(--color-picker-eyedropper-color)',
			'border-(--color-picker-eyedropper-border-width) border-(--color-picker-eyedropper-border-color)',
			'transition-colors duration-(--color-picker-transition-duration)',
			'hovered:bg-(--color-picker-eyedropper-hover-bg)',
			'pressed:bg-(--color-picker-eyedropper-pressed-bg)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:cursor-not-allowed',
		),
		eyeDropperIcon: cn('size-(--color-picker-eyedropper-icon-size)'),
		field: cn('group flex flex-col gap-(--color-picker-field-gap)','w-(--color-picker-field-width)',),
		fieldDescription: cn('text-(--color-picker-description-font-size) text-(--color-picker-description-color)',),
		fieldError: cn('text-(--color-picker-error-font-size) text-(--color-picker-error-color)',),
		fieldInput: cn(
			'h-(--color-picker-field-height) px-(--color-picker-field-px)',
			'text-(--color-picker-field-font-size)',
			'bg-(--color-picker-field-bg) text-(--color-picker-field-fg)',
			'border-(--color-picker-field-border-width) border-(--color-picker-field-border-color)',
			'rounded-(--color-picker-field-radius)',
			'transition-colors duration-(--color-picker-transition-duration)',
			'hovered:border-(--color-picker-field-hover-border)',
			'focus:outline-none focus:ring-(--focus-ring-width) focus:ring-(--focus-ring-color)',
			'invalid:border-(--color-picker-field-invalid-border)',
			'disabled:opacity-(--color-picker-disabled-opacity)',
		),
		fieldLabel: cn('text-(--color-picker-label-font-size) text-(--color-picker-label-color)','font-(--color-picker-label-font-weight)',),
		root: cn('flex flex-col gap-(--color-picker-gap)'),
		slider: cn(
			'relative',
			'data-[orientation=horizontal]:h-(--color-picker-slider-height) data-[orientation=horizontal]:w-(--color-picker-slider-width)',
			'data-[orientation=vertical]:w-(--color-picker-slider-height) data-[orientation=vertical]:h-(--color-picker-slider-width)',
			'rounded-(--color-picker-slider-radius)',
			'cursor-pointer',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:pointer-events-none',
		),
		sliderOutput: cn(
			'text-(--color-picker-slider-output-font-size) text-(--color-picker-slider-output-color)',
			'font-(--color-picker-slider-output-font-weight)',
			'tabular-nums',
		),
		sliderTrack: cn('absolute inset-0','rounded-(--color-picker-slider-radius)',),
		swatch: cn(
			'size-(--color-picker-swatch-size)',
			'rounded-(--color-picker-swatch-radius)',
			'border-(--color-picker-swatch-border-width) border-(--color-picker-swatch-border-color)',
		),
		swatchPicker: cn('flex flex-wrap gap-(--color-picker-swatch-gap)'),
		swatchPickerItem: cn(
			'size-(--color-picker-swatch-size)',
			'rounded-(--color-picker-swatch-radius)',
			'border-(--color-picker-swatch-border-width) border-(--color-picker-swatch-border-color)',
			'cursor-pointer',
			'transition-transform duration-(--color-picker-transition-duration)',
			'hovered:scale-(--color-picker-swatch-hover-scale)',
			'selected:ring-(--focus-ring-width) selected:ring-(--focus-ring-color)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		swatchWrapper: cn('relative', 'size-(--color-picker-swatch-size)'),
		thumb: cn(
			'size-(--color-picker-thumb-size)',
			'rounded-(--color-picker-thumb-radius)',
			'bg-(--color-picker-thumb-bg)',
			'border-(--color-picker-thumb-border-width) border-(--color-picker-thumb-border-color)',
			'shadow-(--color-picker-thumb-shadow)',
			'transition-[transform,box-shadow] duration-(--color-picker-transition-duration) ease-(--color-picker-transition-easing)',
			'hovered:scale-(--color-picker-thumb-hover-scale)',
			'dragging:scale-(--color-picker-thumb-dragging-scale) dragging:shadow-(--color-picker-thumb-dragging-shadow)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		wheel: cn(
			'relative',
			'size-(--color-picker-wheel-size)',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:pointer-events-none',
		),
		wheelTrack: cn('absolute inset-0','rounded-full',),
	}),
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const normalizeColor = (value: Color | string | undefined): Color | undefined => pipe(Option.fromNullable(value), Option.flatMap((v) => typeof v === 'string' ? Option.liftThrowable(parseColor)(v) : Option.some(v)), Option.getOrUndefined);
const formatColor = (color: Color, format: ColorFormat): string => color.toString(format);

// --- [INTERNAL_COMPONENTS] ---------------------------------------------------

const DragStateSync: FC<{
	readonly children: ReactNode;
	readonly colorValue: string;
	readonly isDragging: boolean;
	readonly onSync: (state: { colorValue: string; isDragging: boolean }) => void;
}> = ({ children, colorValue, isDragging, onSync }) => {
	useEffect(() => { onSync({ colorValue, isDragging }); }, [colorValue, isDragging, onSync]);
	return <>{children}</>;
};
const ColorThumb: FC<{
	readonly children?: ReactNode;
	readonly className?: string;
	readonly format?: ColorFormat;
	readonly ref?: Ref<HTMLDivElement>;
	readonly tooltip?: boolean | TooltipConfig;
}> = ({ children, className, format = 'hex', ref, tooltip }) => {
	const thumbRef = useRef<HTMLDivElement>(null);
	const [dragState, setDragState] = useState({ colorValue: '', isDragging: false });
	const tooltipConfig = pipe(
		Option.fromNullable(tooltip || undefined),
		Option.map((t): TooltipConfig => ({ content: dragState.colorValue, open: dragState.isDragging, placement: 'top', ...(t === true ? {} : t) })),
		Option.getOrUndefined,
	);
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltipConfig);
	const mergedRef = useMergeRefs([ref, thumbRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACColorThumb className={cn(B.slot.thumb, className)} data-slot='color-picker-thumb' ref={mergedRef}>
				{({ color, isDragging }) => (<DragStateSync colorValue={formatColor(color, format)} isDragging={isDragging} onSync={setDragState}> {children} </DragStateSync>)}
			</RACColorThumb>
			{renderTooltip?.()}
		</>
	);
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const ColorPicker: FC<ColorPickerProps> = ({
	areaLabel, className, colorSpace, copyAsyncState, copyGesture, copyToClipboard, copyTooltip, defaultValue, eyeDropper,
	eyeDropperAsyncState, eyeDropperGesture, eyeDropperIcon, eyeDropperLabel, eyeDropperTooltip, field, innerRadius, isDisabled, mode,
	onChange, onChangeEnd, onEyeDropper, onEyeDropperError, outerRadius, ref, size, sliderLabels, sliderOrientation = 'horizontal', sliderShowOutput, sliders, swatch,
	swatchLayout = 'grid', swatches, thumbTooltip = false, thumbTooltipFormat = 'hex', tooltip, value, variant, wheelLabel, xChannel, yChannel, ...racProps }) => {
	const normalizedDefault = normalizeColor(defaultValue);
	const normalizedValue = normalizeColor(value);
	const resolvedXChannel = xChannel ?? B.defaults.xChannel;
	const resolvedYChannel = yChannel ?? B.defaults.yChannel;
	const resolvedInnerRadius = innerRadius ?? B.defaults.innerRadius;
	const resolvedOuterRadius = outerRadius ?? B.defaults.outerRadius;
	const eyeDropperSupported = eyeDropper && globalThis.window !== undefined && 'EyeDropper' in globalThis;
	const openEyeDropper = () => {
		eyeDropperSupported && new ((globalThis as unknown as { EyeDropper: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper)().open()
			.then(({ sRGBHex }) => onEyeDropper?.(parseColor(sRGBHex)))
			.catch((e: unknown) => e instanceof Error && e.name !== 'AbortError' && onEyeDropperError?.(e));
	};
	// Refs for interactive buttons
	const eyeDropperRef = useRef<HTMLButtonElement>(null);
	const swatchRef = useRef<HTMLButtonElement>(null);
	// AsyncState slots
	const eyeDropperSlot = Slot.bind(eyeDropperAsyncState);
	const copySlot = Slot.bind(copyAsyncState);
	// Tooltips
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltip);
	const { props: eyeDropperTooltipProps, render: renderEyeDropperTooltip } = useTooltip(eyeDropperTooltip);
	const { props: copyTooltipProps, render: renderCopyTooltip } = useTooltip(copyTooltip);
	// Gestures
	const { props: eyeDropperGestureProps } = useGesture({
		isDisabled: !eyeDropperSupported || isDisabled || eyeDropperSlot.pending,
		prefix: 'color-picker-eyedropper',
		ref: eyeDropperRef,
		...eyeDropperGesture,
		...(eyeDropperGesture?.longPress && { longPress: { haptic: true, ...eyeDropperGesture.longPress } }),
	});
	const { props: copyGestureProps } = useGesture({
		isDisabled: !copyToClipboard || isDisabled || copySlot.pending,
		prefix: 'color-picker-swatch',
		ref: swatchRef,
		...copyGesture,
		...(copyGesture?.longPress && { longPress: { haptic: true, ...copyGesture.longPress } }),
	});
	// Merged refs
	const mergedRef = useMergeRefs([ref, tooltipProps.ref as Ref<HTMLDivElement>]);
	const eyeDropperMergedRef = useMergeRefs([eyeDropperRef, eyeDropperTooltipProps.ref as Ref<HTMLButtonElement>]);
	const swatchMergedRef = useMergeRefs([swatchRef, copyTooltipProps.ref as Ref<HTMLButtonElement>]);
	return (
		<>
		<RACColorPicker {...racProps} {...defined({ defaultValue: normalizedDefault, onChange, value: normalizedValue })}>
			{({ color: currentColor }) => (
				<div
					{...tooltipProps}
					className={cn(B.slot.root, className)}
					data-mode={mode}
					data-size={size}
					data-slot='color-picker'
					data-variant={variant}
					ref={mergedRef}
				>
					{mode === 'area' && (
						<RACColorArea
							aria-label={areaLabel ?? `Color ${resolvedXChannel} and ${resolvedYChannel}`}
							className={B.slot.area}
							data-slot='color-picker-area'
							xChannel={resolvedXChannel}
							yChannel={resolvedYChannel}
							{...defined({ colorSpace, isDisabled, onChangeEnd })}
						>
							<ColorThumb format={thumbTooltipFormat} tooltip={thumbTooltip} />
						</RACColorArea>
					)}
					{mode === 'wheel' && (
						<RACColorWheel
							aria-label={wheelLabel ?? 'Hue wheel'}
							className={B.slot.wheel}
							data-slot='color-picker-wheel'
							innerRadius={resolvedInnerRadius}
							outerRadius={resolvedOuterRadius}
							{...defined({ isDisabled, onChangeEnd })}
						>
							<RACColorWheelTrack className={B.slot.wheelTrack} data-slot='color-picker-wheel-track' />
							<ColorThumb format={thumbTooltipFormat} tooltip={thumbTooltip} />
						</RACColorWheel>
					)}
					{sliders?.map((channel) => (
						<RACColorSlider
							aria-label={sliderLabels?.[channel] ?? `${channel} channel`}
							channel={channel}
							className={B.slot.slider}
							data-channel={channel}
							data-slot='color-picker-slider'
							key={channel}
							orientation={sliderOrientation}
							{...defined({ colorSpace, isDisabled, onChangeEnd })}
						>
							<RACSliderTrack className={B.slot.sliderTrack} data-slot='color-picker-slider-track'>
								{channel === 'alpha' && <div className={B.slot.alphaPattern} data-slot='color-picker-alpha-pattern' />}
								<ColorThumb format={thumbTooltipFormat} tooltip={thumbTooltip} />
							</RACSliderTrack>
							{sliderShowOutput && (<RACSliderOutput className={B.slot.sliderOutput} data-slot='color-picker-slider-output' />)}
						</RACColorSlider>
					))}
					{field && (
						<RACColorField
							className={B.slot.field}
							data-slot='color-picker-field'
							{...defined({ channel: field.channel, colorSpace, isDisabled, isInvalid: field.isInvalid, isReadOnly: field.isReadOnly, isRequired: field.isRequired })}
						>
							{field.label && (<Label className={B.slot.fieldLabel} data-slot='color-picker-field-label'> {field.label} </Label>)}
							<Input className={B.slot.fieldInput} data-slot='color-picker-field-input' />
							{field.description && (<Text className={B.slot.fieldDescription} data-slot='color-picker-field-description' slot='description'> {field.description} </Text>)}
							<FieldError className={B.slot.fieldError} data-slot='color-picker-field-error'> {field.errorMessage} </FieldError>
						</RACColorField>
					)}
					{eyeDropperSupported && (
						<RACButton
							{...({ ...eyeDropperTooltipProps, ...eyeDropperGestureProps } as unknown as RACButtonProps)}
							aria-label={eyeDropperLabel ?? 'Pick color from screen'}
							className={B.slot.eyeDropperButton}
							data-async-state={eyeDropperSlot.attr}
							data-slot='color-picker-eyedropper'
							isDisabled={isDisabled || eyeDropperSlot.pending}
							onPress={openEyeDropper}
							ref={eyeDropperMergedRef}
						>
							{eyeDropperIcon && <span className={B.slot.eyeDropperIcon}>{eyeDropperIcon}</span>}
						</RACButton>
					)}
					{swatch && (copyToClipboard ? (
						<RACButton
							{...({ ...copyTooltipProps, ...copyGestureProps } as unknown as RACButtonProps)}
							aria-label='Copy color to clipboard'
							className={B.slot.swatchWrapper}
							data-async-state={copySlot.attr}
							data-slot='color-picker-swatch-wrapper'
							isDisabled={isDisabled || copySlot.pending}
							onPress={() => copyToClipboard(currentColor)}
							ref={swatchMergedRef}
						>
							<div className={B.slot.alphaPattern} data-slot='color-picker-alpha-pattern' />
							<RACColorSwatch className={B.slot.swatch} data-slot='color-picker-swatch' />
						</RACButton>
					) : (
						<div className={B.slot.swatchWrapper} data-slot='color-picker-swatch-wrapper'>
							<div className={B.slot.alphaPattern} data-slot='color-picker-alpha-pattern' />
							<RACColorSwatch className={B.slot.swatch} data-slot='color-picker-swatch' />
						</div>
					))}
					{swatches && swatches.length > 0 && (
						<RACColorSwatchPicker
							className={B.slot.swatchPicker}
							data-slot='color-picker-swatch-picker'
							layout={swatchLayout}
						>
							{swatches.map((swatchColor) => (
								<RACColorSwatchPickerItem
									className={B.slot.swatchPickerItem}
									color={swatchColor}
									data-slot='color-picker-swatch-item'
									key={swatchColor}
								>
									<RACColorSwatch />
								</RACColorSwatchPickerItem>
							))}
						</RACColorSwatchPicker>
					)}
				</div>
			)}
		</RACColorPicker>
		{renderTooltip?.()}
		{renderEyeDropperTooltip?.()}
		{renderCopyTooltip?.()}
		<AsyncAnnouncer asyncState={eyeDropperAsyncState} />
		<AsyncAnnouncer asyncState={copyAsyncState} />
		</>
	);
};

// --- [EXPORT] ----------------------------------------------------------------

export { ColorPicker };
export type { ColorPickerProps };
