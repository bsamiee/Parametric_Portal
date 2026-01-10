/**
 * ColorPicker: Comprehensive color selection compound component.
 * Supports 2D gradient areas, channel sliders, color wheels, text inputs, and swatch pickers.
 * Pure presentation - CSS variable driven styling via frozen B constant.
 * All sub-components share color state via ColorPickerContext from RAC.
 * REQUIRED: color, size props on root - no defaults, no hardcoded mappings.
 *
 * RAC props pass through directly - we only add: theme (color/size/variant).
 * Compound pattern: ColorPicker.Area, .Slider, .Wheel, .Field, .Swatch, .SwatchPicker, .Thumb
 *
 * String normalization: Accepts string values for defaultValue/value (hex, rgb, hsl, hsb).
 * Consumers no longer need to import parseColor from RAC.
 */
import { useMergeRefs } from '@floating-ui/react';
import { createContext, type FC, type ReactNode, type Ref, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
	ColorArea as RACColorArea, type ColorAreaProps as RACColorAreaProps, ColorField as RACColorField, type ColorFieldProps as RACColorFieldProps,
	ColorPicker as RACColorPicker, type ColorPickerProps as RACColorPickerProps, ColorSlider as RACColorSlider, type ColorSliderProps as RACColorSliderProps,
	ColorSwatch as RACColorSwatch, ColorSwatchPicker as RACColorSwatchPicker, ColorSwatchPickerItem as RACColorSwatchPickerItem, type ColorSwatchPickerItemProps as RACColorSwatchPickerItemProps,
	type ColorSwatchPickerProps as RACColorSwatchPickerProps, type ColorSwatchProps as RACColorSwatchProps, ColorThumb as RACColorThumb, type ColorThumbProps as RACColorThumbProps,
	ColorWheel as RACColorWheel, type ColorWheelProps as RACColorWheelProps, ColorWheelTrack as RACColorWheelTrack, type ColorWheelTrackProps as RACColorWheelTrackProps,
	type Color, FieldError, Input, Label, parseColor, SliderTrack as RACSliderTrack, Text,
} from 'react-aria-components';
import { type TooltipConfig, useTooltip } from '../core/floating';
import { cn, composeTailwindRenderProps, defined } from '../core/utils';

// --- [TYPES] -----------------------------------------------------------------

type ColorPickerWheelTrackProps = RACColorWheelTrackProps & { readonly ref?: Ref<HTMLDivElement>; };
type ColorPickerContextValue = {
	readonly color: string | undefined; readonly size: string | undefined;
	readonly variant: string | undefined;
};
type ColorPickerProps = Omit<RACColorPickerProps, 'value' | 'defaultValue'> & {
	readonly children: ReactNode; readonly color: string; readonly defaultValue?: string | Color;
	readonly size: string; readonly value?: string | Color; readonly variant?: string;
};
type ColorPickerAreaProps = Omit<RACColorAreaProps, 'children'> & {
	readonly children?: ReactNode; readonly color?: string; readonly ref?: Ref<HTMLDivElement>;
	readonly size?: string; readonly variant?: string;
};
type ColorPickerSliderProps = Omit<RACColorSliderProps, 'children'> & {
	readonly children?: ReactNode; readonly color?: string; readonly label?: ReactNode;
	readonly ref?: Ref<HTMLDivElement>; readonly size?: string; readonly variant?: string;
};
type ColorPickerWheelProps = Omit<RACColorWheelProps, 'children'> & {
	readonly children?: ReactNode; readonly color?: string; readonly ref?: Ref<HTMLDivElement>;
	readonly size?: string; readonly variant?: string;
};
type ColorPickerFieldProps = Omit<RACColorFieldProps, 'children'> & {
	readonly children?: ReactNode; readonly color?: string; readonly description?: ReactNode; readonly errorMessage?: ReactNode;
	readonly label?: ReactNode; readonly ref?: Ref<HTMLDivElement>; readonly size?: string; readonly variant?: string;
};
type ColorPickerSwatchProps = Omit<RACColorSwatchProps, 'color' | 'colorName'> & {
	readonly color?: string | Color; readonly name?: string; readonly ref?: Ref<HTMLDivElement>;
	readonly size?: string; readonly variant?: string;
};
type ColorPickerSwatchPickerProps = Omit<RACColorSwatchPickerProps, 'children'> & {
	readonly children?: ReactNode; readonly color?: string; readonly ref?: Ref<HTMLDivElement>;
	readonly size?: string; readonly variant?: string;
};
type ColorPickerSwatchPickerItemProps = Omit<RACColorSwatchPickerItemProps, 'colorName'> & {
	readonly color: string | Color; readonly name?: string;
	readonly ref?: Ref<HTMLDivElement>;
};
type ColorPickerThumbProps = Omit<RACColorThumbProps, 'children'> & {
	readonly children?: ReactNode; readonly ref?: Ref<HTMLDivElement>;
	readonly tooltip?: boolean | TooltipConfig;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
	slot: Object.freeze({
		area: cn(
			'relative',
			'w-(--color-picker-area-width) h-(--color-picker-area-height)',
			'rounded-(--color-picker-area-radius)',
			'cursor-crosshair',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:pointer-events-none',
		),
		field: cn(
			'flex flex-col gap-(--color-picker-field-gap)',
			'w-(--color-picker-field-width)',
		),
		fieldInput: cn(
			'h-(--color-picker-field-height) px-(--color-picker-field-px)',
			'text-(--color-picker-field-font-size)',
			'bg-(--color-picker-field-bg) text-(--color-picker-field-fg)',
			'border-(--color-picker-field-border-width) border-(--color-picker-field-border-color)',
			'rounded-(--color-picker-field-radius)',
			'focus:outline-none focus:ring-(--focus-ring-width) focus:ring-(--focus-ring-color)',
			'disabled:opacity-(--color-picker-disabled-opacity)',
		),
		fieldLabel: cn(
			'text-(--color-picker-label-font-size) text-(--color-picker-label-color)',
			'font-(--color-picker-label-font-weight)',
		),
		root: cn( 'flex flex-col gap-(--color-picker-gap)', ),
		slider: cn(
			'relative',
			'data-[orientation=horizontal]:h-(--color-picker-slider-height) data-[orientation=horizontal]:w-(--color-picker-slider-width)',
			'data-[orientation=vertical]:w-(--color-picker-slider-height) data-[orientation=vertical]:h-(--color-picker-slider-width)',
			'rounded-(--color-picker-slider-radius)',
			'cursor-pointer',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:pointer-events-none',
		),
		sliderTrack: cn(
			'absolute inset-0',
			'rounded-(--color-picker-slider-radius)',
		),
		swatch: cn(
			'size-(--color-picker-swatch-size)',
			'rounded-(--color-picker-swatch-radius)',
			'border-(--color-picker-swatch-border-width) border-(--color-picker-swatch-border-color)',
			'shadow-(--color-picker-swatch-shadow)',
		),
		swatchPicker: cn( 'flex flex-wrap gap-(--color-picker-swatch-gap)', ),
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
		thumb: cn(
			'size-(--color-picker-thumb-size)',
			'rounded-(--color-picker-thumb-radius)',
			'bg-(--color-picker-thumb-bg)',
			'border-(--color-picker-thumb-border-width) border-(--color-picker-thumb-border-color)',
			'shadow-(--color-picker-thumb-shadow)',
			'transition-transform duration-(--color-picker-transition-duration) ease-(--color-picker-transition-easing)',
			'dragging:scale-(--color-picker-thumb-dragging-scale)',
			'focus-visible:outline-none focus-visible:ring-(--focus-ring-width) focus-visible:ring-(--focus-ring-color)',
		),
		wheel: cn(
			'relative',
			'size-(--color-picker-wheel-size)',
			'disabled:opacity-(--color-picker-disabled-opacity) disabled:pointer-events-none',
		),
		wheelTrack: cn(
			'absolute inset-0',
			'rounded-full',
		),
	}),
});
const ColorPickerContext = createContext<ColorPickerContextValue | null>(null);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const normalizeColor = (value: string | Color | undefined): Color | undefined => typeof value === 'string' ? parseColor(value) : value;

// --- [ENTRY_POINT] -----------------------------------------------------------

const ColorPickerRoot: FC<ColorPickerProps> = ({ children, color, defaultValue, size, value, variant, ...racProps }) => {
	const normalizedDefault = normalizeColor(defaultValue);
	const normalizedValue = normalizeColor(value);
	const contextValue: ColorPickerContextValue = useMemo(
		() => ({ color, size, variant }),
		[color, size, variant],
	);
	return (
		<RACColorPicker {...racProps} {...defined({ defaultValue: normalizedDefault, value: normalizedValue })}>
			<ColorPickerContext.Provider value={contextValue}>
				<div
					className={B.slot.root}
					data-color={color}
					data-size={size}
					data-slot="color-picker"
					data-variant={variant}
				>
					{children}
				</div>
			</ColorPickerContext.Provider>
		</RACColorPicker>
	);
};

// --- [SUB_COMPONENTS] --------------------------------------------------------

const DragStateSync: FC<{
	readonly children: ReactNode;
	readonly colorValue: string;
	readonly isDragging: boolean;
	readonly onSync: (state: { colorValue: string; isDragging: boolean }) => void;
}> = ({ children, colorValue, isDragging, onSync }) => {
	useEffect(() => { onSync({ colorValue, isDragging }); }, [colorValue, isDragging, onSync]);
	return <>{children}</>;
};
const ColorPickerThumb: FC<ColorPickerThumbProps> = ({ children, className, ref, tooltip, ...racProps }) => {
	const thumbRef = useRef<HTMLDivElement>(null);
	const [dragState, setDragState] = useState({ colorValue: '', isDragging: false });
	const tooltipConfig: TooltipConfig | undefined = tooltip
		? {
				content: dragState.colorValue,
				open: dragState.isDragging,
				placement: 'top',
				...(typeof tooltip === 'object' ? tooltip : {}),
			}
		: undefined;
	const { props: tooltipProps, render: renderTooltip } = useTooltip(tooltipConfig);
	const mergedRef = useMergeRefs([ref, thumbRef, tooltipProps.ref as Ref<HTMLDivElement>]);
	return (
		<>
			<RACColorThumb
				{...(racProps as RACColorThumbProps)}
				className={composeTailwindRenderProps(className, B.slot.thumb)}
				data-slot="color-picker-thumb"
				ref={mergedRef}
			>
				{(renderProps) => {
					const { color, isDragging } = renderProps;
					const colorValue = color.toString('hex');
					return (
						<DragStateSync colorValue={colorValue} isDragging={isDragging} onSync={setDragState}> {children} </DragStateSync>
					);
				}}
			</RACColorThumb>
			{renderTooltip?.()}
		</>
	);
};
const ColorPickerArea: FC<ColorPickerAreaProps> = ({
	children, className, color: colorProp, ref, size: sizeProp, variant: variantProp, xChannel, yChannel, ...racProps }) => {
	const ctx = useContext(ColorPickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACColorArea
			{...(racProps as RACColorAreaProps)}
			className={composeTailwindRenderProps(className, B.slot.area)}
			data-color={color}
			data-size={size}
			data-slot="color-picker-area"
			data-variant={variant}
			ref={ref}
			{...(xChannel !== undefined && { xChannel })}
			{...(yChannel !== undefined && { yChannel })}
		>
			{children ?? <ColorPickerThumb />}
		</RACColorArea>
	);
};
const ColorPickerSlider: FC<ColorPickerSliderProps> = ({
	channel = 'hue', children, className, color: colorProp, label, orientation = 'horizontal',
	ref, size: sizeProp, variant: variantProp, ...racProps }) => {
	const ctx = useContext(ColorPickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACColorSlider
			{...(racProps as RACColorSliderProps)}
			channel={channel}
			className={composeTailwindRenderProps(className, B.slot.slider)}
			data-color={color}
			data-orientation={orientation}
			data-size={size}
			data-slot="color-picker-slider"
			data-variant={variant}
			orientation={orientation}
			ref={ref}
		>
			{label}
			<RACSliderTrack
				className={B.slot.sliderTrack}
				data-slot="color-picker-slider-track"
			>
				{children ?? <ColorPickerThumb />}
			</RACSliderTrack>
		</RACColorSlider>
	);
};
const ColorPickerWheelTrack: FC<ColorPickerWheelTrackProps> = ({ className, ref, ...racProps }) => (
	<RACColorWheelTrack
		{...(racProps as RACColorWheelTrackProps)}
		className={composeTailwindRenderProps(className, B.slot.wheelTrack)}
		data-slot="color-picker-wheel-track"
		ref={ref}
	/>
);
const ColorPickerWheel: FC<ColorPickerWheelProps> = ({ children, className, color: colorProp, ref, size: sizeProp, variant: variantProp, ...racProps }) => {
	const ctx = useContext(ColorPickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACColorWheel
			{...(racProps as RACColorWheelProps)}
			className={composeTailwindRenderProps(className, B.slot.wheel)}
			data-color={color}
			data-size={size}
			data-slot="color-picker-wheel"
			data-variant={variant}
			ref={ref}
		>
			{children ?? (
				<>
					<ColorPickerWheelTrack />
					<ColorPickerThumb />
				</>
			)}
		</RACColorWheel>
	);
};
const ColorPickerField: FC<ColorPickerFieldProps> = ({
	className, color: colorProp, description, errorMessage, label, ref, size: sizeProp, variant: variantProp, ...racProps }) => {
	const ctx = useContext(ColorPickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACColorField
			{...(racProps as RACColorFieldProps)}
			className={composeTailwindRenderProps(className, B.slot.field)}
			data-color={color}
			data-size={size}
			data-slot="color-picker-field"
			data-variant={variant}
			ref={ref}
		>
			{label && (
				<Label className={B.slot.fieldLabel} data-slot="color-picker-field-label"> {label} </Label>
			)}
			<Input className={B.slot.fieldInput} data-slot="color-picker-field-input" />
			{description && (
				<Text className={B.slot.fieldLabel} data-slot="color-picker-field-description" slot="description"> {description} </Text>
			)}
			<FieldError data-slot="color-picker-field-error">{errorMessage}</FieldError>
		</RACColorField>
	);
};
const ColorPickerSwatch: FC<ColorPickerSwatchProps> = ({
	className, color: colorValue, name, ref, size: sizeProp, variant: variantProp, ...racProps }) => {
	const ctx = useContext(ColorPickerContext);
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	const themeColor = ctx?.color;
	return colorValue === undefined ? null : (
		<RACColorSwatch
			{...(racProps as RACColorSwatchProps)}
			{...defined({ colorName: name })}
			className={composeTailwindRenderProps(className, B.slot.swatch)}
			color={colorValue}
			data-color={themeColor}
			data-size={size}
			data-slot="color-picker-swatch"
			data-variant={variant}
			ref={ref}
		/>
	);
};
const ColorPickerSwatchPickerItem: FC<ColorPickerSwatchPickerItemProps> = ({ className, color: colorValue, name, ref, ...racProps }) => (
	<RACColorSwatchPickerItem
		{...(racProps as RACColorSwatchPickerItemProps)}
		{...defined({ colorName: name })}
		className={composeTailwindRenderProps(className, B.slot.swatchPickerItem)}
		color={colorValue}
		data-slot="color-picker-swatch-picker-item"
		ref={ref}
	/>
);
const ColorPickerSwatchPicker: FC<ColorPickerSwatchPickerProps> = ({
	children, className, color: colorProp, ref, size: sizeProp, variant: variantProp, ...racProps }) => {
	const ctx = useContext(ColorPickerContext);
	const color = colorProp ?? ctx?.color;
	const size = sizeProp ?? ctx?.size;
	const variant = variantProp ?? ctx?.variant;
	return (
		<RACColorSwatchPicker
			{...(racProps as RACColorSwatchPickerProps)}
			className={composeTailwindRenderProps(className, B.slot.swatchPicker)}
			data-color={color}
			data-size={size}
			data-slot="color-picker-swatch-picker"
			data-variant={variant}
			ref={ref}
		>
			{children}
		</RACColorSwatchPicker>
	);
};

// --- [COMPOUND_COMPONENT] ----------------------------------------------------

const ColorPicker = Object.assign(ColorPickerRoot, {
	Area: ColorPickerArea,
	Field: ColorPickerField,
	Slider: ColorPickerSlider,
	Swatch: ColorPickerSwatch,
	SwatchPicker: ColorPickerSwatchPicker,
	SwatchPickerItem: ColorPickerSwatchPickerItem,
	Thumb: ColorPickerThumb,
	useContext: (): ColorPickerContextValue | null => useContext(ColorPickerContext),
	Wheel: ColorPickerWheel,
	WheelTrack: ColorPickerWheelTrack,
});

// --- [EXPORT] ----------------------------------------------------------------

export { ColorPicker };
export type { ColorPickerProps, ColorPickerThumbProps };
