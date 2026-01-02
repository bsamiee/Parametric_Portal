/** Tailwind v4.1 + React Aria Components scale/state constants. */
import { Schema as S } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type MessageRole = S.Schema.Type<typeof MessageRole>
type SidebarTab = S.Schema.Type<typeof SidebarTab>
type TWValue<K extends keyof typeof TW> =
	(typeof TW)[K] extends readonly (infer U)[] ? U : never;
type RACValue<K extends keyof typeof RAC.nonBoolean> =
	(typeof RAC.nonBoolean)[K][number];
type RacBooleanState = (typeof RAC.boolean)[number];
type RACKey = keyof typeof RAC.nonBoolean;
type ColorCategory = (typeof colorCategory)[number];

// --- [SCHEMA] ----------------------------------------------------------------

const MessageRole = S.Literal('assistant', 'user');
const SidebarTab = S.Literal('history', 'inspector', 'library', 'session');

// --- [CONSTANTS] -------------------------------------------------------------

const TW = Object.freeze({
	alignContent: ['normal', 'center', 'start', 'end', 'between', 'around', 'evenly', 'baseline', 'stretch'] as const,
	alignItems: ['start', 'end', 'end-safe', 'center', 'center-safe', 'baseline', 'baseline-last', 'stretch'] as const,
	alignSelf: ['auto', 'start', 'end', 'end-safe', 'center', 'center-safe', 'stretch', 'baseline', 'baseline-last'] as const,
	animation: ['none', 'spin', 'ping', 'pulse', 'bounce'] as const,
	appearance: ['none', 'auto'] as const,
	aspectRatio: ['auto', 'square', 'video'] as const,
	backdropBlur: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const,
	backface: ['visible', 'hidden'] as const,
	blur: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'] as const,
	borderCollapse: ['collapse', 'separate'] as const,
	borderSide: ['all', 'top', 'right', 'bottom', 'left', 'x', 'y', 's', 'e'] as const,
	borderStyle: ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'] as const,
	borderWidth: [0, 1, 2, 4, 8] as const,
	boxSizing: ['border', 'content'] as const,
	breakpoint: ['sm', 'md', 'lg', 'xl', '2xl'] as const,
	brightness: [0, 50, 75, 90, 95, 100, 105, 110, 125, 150, 200] as const,
	captionSide: ['top', 'bottom'] as const,
	clear: ['start', 'end', 'left', 'right', 'both', 'none'] as const,
	colorScheme: ['normal', 'light', 'dark', 'light-dark', 'only-dark', 'only-light'] as const,
	colorStep: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const,
	container: ['3xs', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl'] as const,
	contrast: [0, 50, 75, 100, 125, 150, 200] as const,
	cursor: ['auto', 'default', 'pointer', 'wait', 'text', 'move', 'help', 'not-allowed', 'none', 'context-menu', 'progress', 'cell', 'crosshair', 'vertical-text', 'alias', 'copy', 'no-drop', 'grab', 'grabbing', 'all-scroll', 'col-resize', 'row-resize', 'n-resize', 'e-resize', 's-resize', 'w-resize', 'ne-resize', 'nw-resize', 'se-resize', 'sw-resize', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', 'zoom-in', 'zoom-out'] as const,
	display: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'table', 'inline-table', 'table-caption', 'table-cell', 'table-column', 'table-column-group', 'table-footer-group', 'table-header-group', 'table-row-group', 'table-row', 'flow-root', 'contents', 'list-item', 'hidden'] as const,
	divideStyle: ['solid', 'dashed', 'dotted', 'double', 'hidden', 'none'] as const,
	dropShadow: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const,
	duration: [0, 75, 100, 150, 200, 300, 500, 700, 1000] as const,
	ease: ['linear', 'in', 'out', 'in-out', 'initial'] as const,
	flex: ['1', 'auto', 'initial', 'none'] as const,
	flexDirection: ['row', 'row-reverse', 'col', 'col-reverse'] as const,
	flexWrap: ['wrap', 'wrap-reverse', 'nowrap'] as const,
	float: ['start', 'end', 'right', 'left', 'none'] as const,
	fontSize: ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl'] as const,
	fontStyle: ['italic', 'not-italic'] as const,
	fontWeight: ['thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black'] as const,
	gradientDirection: ['to-t', 'to-tr', 'to-r', 'to-br', 'to-b', 'to-bl', 'to-l', 'to-tl'] as const,
	gradientType: ['linear', 'radial', 'conic'] as const,
	grayscale: [0, 25, 50, 100] as const,
	gridAuto: ['auto', 'min', 'max', 'fr'] as const,
	gridAutoFlow: ['row', 'col', 'dense', 'row-dense', 'col-dense'] as const,
	gridCols: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 'none', 'subgrid'] as const,
	hueRotate: [0, 15, 30, 60, 90, 180, 270] as const,
	insetShadow: ['none', '2xs', 'xs', 'sm'] as const,
	invert: [0, 20, 100] as const,
	isolation: ['isolate', 'auto'] as const,
	justifyContent: ['normal', 'start', 'end', 'end-safe', 'center', 'center-safe', 'between', 'around', 'evenly', 'stretch', 'baseline'] as const,
	justifyItems: ['start', 'end', 'end-safe', 'center', 'center-safe', 'stretch', 'normal'] as const,
	justifySelf: ['auto', 'start', 'end', 'end-safe', 'center', 'center-safe', 'stretch'] as const,
	layoutType: ['flex', 'grid'] as const,
	leading: ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose', 3, 4, 5, 6, 7, 8, 9, 10] as const,
	listStylePosition: ['inside', 'outside'] as const,
	listStyleType: ['none', 'disc', 'decimal'] as const,
	maskComposite: ['add', 'subtract', 'intersect', 'exclude'] as const,
	maskPosition: ['center', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left'] as const,
	maskShape: ['circle', 'ellipse'] as const,
	maskSize: ['auto', 'cover', 'contain'] as const,
	mixBlendMode: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'plus-darker', 'plus-lighter'] as const,
	objectFit: ['contain', 'cover', 'fill', 'none', 'scale-down'] as const,
	objectPosition: ['bottom', 'center', 'left', 'left-bottom', 'left-top', 'right', 'right-bottom', 'right-top', 'top'] as const,
	opacity: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100] as const,
	order: ['first', 'last', 'none'] as const,
	outlineStyle: ['none', 'solid', 'dashed', 'dotted', 'double', 'hidden'] as const,
	outlineWidth: [0, 1, 2, 4, 8] as const,
	overflow: ['auto', 'hidden', 'clip', 'visible', 'scroll'] as const,
	overscroll: ['auto', 'contain', 'none'] as const,
	perspective: ['none', 'dramatic', 'near', 'normal', 'midrange', 'distant'] as const,
	placeContent: ['center', 'center-safe', 'start', 'end', 'end-safe', 'between', 'around', 'evenly', 'baseline', 'stretch'] as const,
	placeItems: ['start', 'end', 'end-safe', 'center', 'center-safe', 'baseline', 'stretch'] as const,
	placeSelf: ['auto', 'start', 'end', 'end-safe', 'center', 'center-safe', 'stretch'] as const,
	pointerEvents: ['none', 'auto'] as const,
	pointerType: ['fine', 'coarse', 'any-fine', 'any-coarse'] as const,
	position: ['static', 'fixed', 'absolute', 'relative', 'sticky'] as const,
	radius: ['none', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full'] as const,
	resize: ['none', 'both', 'x', 'y'] as const,
	ringWidth: [0, 1, 2, 4, 8] as const,
	saturate: [0, 50, 100, 150, 200] as const,
	scrollBehavior: ['auto', 'smooth'] as const,
	scrollSnapAlign: ['start', 'end', 'center', 'none'] as const,
	scrollSnapStop: ['normal', 'always'] as const,
	scrollSnapType: ['none', 'x', 'y', 'both', 'mandatory', 'proximity'] as const,
	sepia: [0, 50, 100] as const,
	shadow: ['none', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const,
	spacing: [0, 'px', 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96] as const,
	tableLayout: ['auto', 'fixed'] as const,
	textAlign: ['left', 'center', 'right', 'justify', 'start', 'end'] as const,
	textDecoration: ['underline', 'overline', 'line-through', 'no-underline'] as const,
	textDecorationStyle: ['solid', 'double', 'dotted', 'dashed', 'wavy'] as const,
	textOverflow: ['truncate', 'ellipsis', 'clip'] as const,
	textShadow: ['none', '2xs', 'xs', 'sm', 'md', 'lg'] as const,
	textTransform: ['uppercase', 'lowercase', 'capitalize', 'normal-case'] as const,
	touchAction: ['auto', 'none', 'pan-x', 'pan-left', 'pan-right', 'pan-y', 'pan-up', 'pan-down', 'pinch-zoom', 'manipulation'] as const,
	tracking: ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest'] as const,
	transformOrigin: ['center', 'top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left'] as const,
	transformStyle: ['flat', '3d'] as const,
	transitionProperty: ['none', 'all', 'colors', 'opacity', 'shadow', 'transform'] as const,
	userSelect: ['none', 'text', 'all', 'auto'] as const,
	verticalAlign: ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super'] as const,
	visibility: ['visible', 'invisible', 'collapse'] as const,
	whitespace: ['normal', 'nowrap', 'pre', 'pre-line', 'pre-wrap', 'break-spaces'] as const,
	willChange: ['auto', 'scroll', 'contents', 'transform'] as const,
	wordBreak: ['normal', 'all', 'keep'] as const,
	zIndex: ['auto', 0, 10, 20, 30, 40, 50] as const,
} as const);

const RAC = Object.freeze({
	boolean: [
		'hovered', 'pressed', 'focused', 'focus-visible', 'focus-within', 'selected', 'indeterminate',
		'disabled', 'readonly', 'required', 'invalid', 'placeholder',
		'open', 'entering', 'exiting', 'expanded',
		'pending', 'dragging', 'drop-target', 'allows-dragging',
		'current', 'empty', 'unavailable',
		'outside-month', 'outside-visible-range', 'selection-start', 'selection-end',
		'allows-removing', 'allows-sorting', 'resizing', 'has-submenu', 'has-child-items',
	] as const,
	nonBoolean: Object.freeze({
		layout: ['grid', 'stack'] as const,
		orientation: ['horizontal', 'vertical'] as const,
		placement: ['top', 'top left', 'top right', 'top start', 'top end', 'bottom', 'bottom left', 'bottom right', 'bottom start', 'bottom end', 'left', 'left top', 'left bottom', 'right', 'right top', 'right bottom', 'start', 'start top', 'start bottom', 'end', 'end top', 'end bottom'] as const,
		resizableDirection: ['left', 'right', 'both'] as const,
		segmentType: ['literal', 'year', 'month', 'day', 'hour', 'minute', 'second', 'dayPeriod', 'era', 'timeZoneName'] as const,
		selectionMode: ['none', 'single', 'multiple'] as const,
		sortDirection: ['ascending', 'descending'] as const,
	}),
} as const);

const colorCategory = [
	'surface', 'text', 'border', 'muted',
	'destructive', 'success', 'warning', 'info',
	'accent1', 'accent2', 'accent3', 'accent4', 'accent5',
	'accent6', 'accent7', 'accent8', 'accent9', 'accent10',
] as const;

const STATIC_TOKENS = Object.freeze({
	container: Object.freeze({ lg: '32rem', md: '28rem', sm: '24rem', xl: '36rem', xs: '20rem', xxl: '42rem' }),
	easing: Object.freeze({ bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)', default: 'cubic-bezier(0.4, 0, 0.2, 1)', in: 'cubic-bezier(0.4, 0, 1, 1)', inOut: 'cubic-bezier(0.4, 0, 0.2, 1)', linear: 'linear', out: 'cubic-bezier(0, 0, 0.2, 1)' }),
	focusRing: Object.freeze({ color: 'var(--color-accent1-200)', offset: '2px', width: '2px' }),
	fontWeight: Object.freeze({ black: 900, bold: 700, extrabold: 800, extralight: 200, light: 300, medium: 500, normal: 400, semibold: 600, thin: 100 }),
	leading: Object.freeze({ loose: 2, none: 1, normal: 1.5, relaxed: 1.625, snug: 1.375, tight: 1.25 }),
	opacity: Object.freeze({ backdropOverlay: 0.5, disabled: 0.5, dragging: 0.8, focusSubtle: 0.2, hover: 0.1, hoverElement: 0.7, pending: 0.6, placeholder: 0.6, readonly: 0.65 }),
	state: Object.freeze({ disabledOpacity: 0.5, pressedScale: 0.98 }),
	tracking: Object.freeze({ normal: '0em', tight: '-0.025em', tighter: '-0.05em', wide: '0.025em', wider: '0.05em', widest: '0.1em' }),
	zIndex: Object.freeze({ base: 0, dropdown: 1000, modal: 1200, popover: 1300, sticky: 1100, toast: 1400, tooltip: 1500 }),
} as const);

// --- [EXPORT] ----------------------------------------------------------------

export { colorCategory, MessageRole, RAC, SidebarTab, STATIC_TOKENS, TW };
export type { ColorCategory, RACKey, RACValue, RacBooleanState, TWValue };
