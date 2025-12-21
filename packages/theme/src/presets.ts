/**
 * Define pre-configured theme presets.
 * Grounding: Static OKLCH palettes enable rapid theme application.
 */
import type { OklchParams } from './factories.ts';
import type { ThemeInput } from './schemas.ts';

// --- [TYPES] -----------------------------------------------------------------

type PresetName = 'catppuccin' | 'dracula' | 'nord';
type PaletteConfig = {
    readonly accent: OklchParams;
    readonly surface: OklchParams;
};
type ModifierShifts = {
    readonly alphaShift?: number;
    readonly chromaShift?: number;
    readonly lightnessShift?: number;
};
type ModifierKey = 'active' | 'disabled' | 'dragged' | 'focus' | 'hover' | 'pressed' | 'selected';
type PresetOverrides = {
    readonly accent?: Partial<OklchParams>;
    readonly modifiers?: Partial<Record<ModifierKey, boolean | ModifierShifts>>;
    readonly surface?: Partial<OklchParams>;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    modifiers: {
        all: { active: true, disabled: true, focus: true, hover: true, pressed: true, selected: true } as const,
        destructive: { active: true, disabled: true, focus: true, hover: true } as const,
        hover: { hover: true } as const,
        status: { hover: true } as const,
        text: { disabled: true, hover: true } as const,
    },
    palettes: {
        catppuccin: {
            accent: { chroma: 0.14, hue: 280, lightness: 0.68 },
            cyan: { chroma: 0.1, hue: 195, lightness: 0.75 },
            destructive: { chroma: 0.2, hue: 10, lightness: 0.62 },
            green: { chroma: 0.15, hue: 140, lightness: 0.68 },
            muted: { chroma: 0.035, hue: 284, lightness: 0.48 },
            orange: { chroma: 0.13, hue: 50, lightness: 0.72 },
            surface: { chroma: 0.025, hue: 284, lightness: 0.21 },
            text: { chroma: 0.015, hue: 284, lightness: 0.9 },
            yellow: { chroma: 0.13, hue: 85, lightness: 0.82 },
        },
        dracula: {
            accent: { chroma: 0.12, hue: 285, lightness: 0.58 }, // #A072C6 purple
            cyan: { chroma: 0.14, hue: 175, lightness: 0.82 }, // #94F2E8 cyan
            destructive: { chroma: 0.2, hue: 25, lightness: 0.6 }, // #FF5555 red
            green: { chroma: 0.22, hue: 145, lightness: 0.78 }, // #50FA7B green
            muted: { chroma: 0.06, hue: 240, lightness: 0.5 }, // #6272A4 comment (raised for visibility)
            orange: { chroma: 0.18, hue: 25, lightness: 0.65 }, // #F97359 orange
            pink: { chroma: 0.16, hue: 350, lightness: 0.72 }, // #E98FBE pink
            surface: { chroma: 0.04, hue: 275, lightness: 0.2 }, // #2A2640 current_line (charcoal)
            text: { chroma: 0.01, hue: 60, lightness: 0.97 }, // #F8F8F2 foreground
            yellow: { chroma: 0.16, hue: 100, lightness: 0.88 }, // #F1FA8C yellow
        },
        nord: {
            accent: { chroma: 0.12, hue: 210, lightness: 0.7 },
            cyan: { chroma: 0.1, hue: 185, lightness: 0.72 },
            destructive: { chroma: 0.18, hue: 15, lightness: 0.6 },
            green: { chroma: 0.14, hue: 150, lightness: 0.65 },
            muted: { chroma: 0.03, hue: 255, lightness: 0.5 },
            orange: { chroma: 0.12, hue: 45, lightness: 0.7 },
            surface: { chroma: 0.02, hue: 255, lightness: 0.27 },
            text: { chroma: 0.01, hue: 255, lightness: 0.9 },
            yellow: { chroma: 0.12, hue: 90, lightness: 0.8 },
        },
    },
    scales: {
        accent: 11,
        destructive: 7,
        muted: 5,
        success: 7,
        surface: 11,
        text: 5,
        warning: 7,
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const mergeModifiers = (
    base: Record<string, boolean | object> | undefined,
    overrides: Partial<Record<ModifierKey, boolean | ModifierShifts>> | undefined,
): Record<string, boolean | object> | undefined =>
    overrides && base
        ? Object.fromEntries(
              Object.entries(base).map(([key, value]) => {
                  const override = overrides[key as ModifierKey];
                  return override === undefined
                      ? [key, value]
                      : typeof override === 'boolean' || typeof value === 'boolean'
                        ? [key, override]
                        : [key, { ...(value as object), ...override }];
              }),
          )
        : base;

const mkTheme = (
    name: string,
    oklch: OklchParams,
    opts: { readonly modifiers?: Record<string, boolean | object>; readonly scale?: number; readonly spacing?: number },
    modifierOverrides?: Partial<Record<ModifierKey, boolean | ModifierShifts>>,
): ThemeInput =>
    ({
        chroma: oklch.chroma,
        hue: oklch.hue,
        lightness: oklch.lightness,
        modifiers: mergeModifiers(opts.modifiers, modifierOverrides),
        name,
        scale: opts.scale ?? 11,
        spacing: opts.spacing,
    }) as ThemeInput;

const getPresetThemes = (preset: PresetName, overrides?: PresetOverrides): ReadonlyArray<ThemeInput> => {
    const palette = B.palettes[preset];
    const surface = { ...palette.surface, ...overrides?.surface };
    const accent = { ...palette.accent, ...overrides?.accent };
    const pink = 'pink' in palette ? palette.pink : palette.accent;
    const mods = overrides?.modifiers;

    return Object.freeze([
        mkTheme('surface', surface, { modifiers: B.modifiers.all, scale: B.scales.surface, spacing: 24 }, mods),
        mkTheme('text', palette.text, { modifiers: B.modifiers.text, scale: B.scales.text }, mods),
        mkTheme('muted', palette.muted, { modifiers: B.modifiers.hover, scale: B.scales.muted }, mods),
        mkTheme('accent', accent, { modifiers: B.modifiers.all, scale: B.scales.accent }, mods),
        mkTheme('cyan', palette.cyan, { modifiers: B.modifiers.hover, scale: 7 }, mods),
        mkTheme('pink', pink, { modifiers: B.modifiers.hover, scale: 7 }, mods),
        mkTheme('success', palette.green, { modifiers: B.modifiers.status, scale: B.scales.success }, mods),
        mkTheme('warning', palette.orange, { modifiers: B.modifiers.status, scale: B.scales.warning }, mods),
        mkTheme('highlight', palette.yellow, { modifiers: B.modifiers.hover, scale: 5 }, mods),
        mkTheme(
            'destructive',
            palette.destructive,
            { modifiers: B.modifiers.destructive, scale: B.scales.destructive },
            mods,
        ),
    ]);
};

const getPalette = (preset: PresetName): PaletteConfig => ({
    accent: B.palettes[preset].accent,
    surface: B.palettes[preset].surface,
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as PRESET_TUNING, getPalette, getPresetThemes };
export type { ModifierKey, ModifierShifts, PaletteConfig, PresetName, PresetOverrides };
