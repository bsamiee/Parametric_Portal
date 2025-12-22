/**
 * Icon generation API client.
 * HTTP client with Effect pipeline for icon generation.
 */

import {
    type ColorMode,
    type GenerateRequest,
    type GenerateResponse,
    ICON_DESIGN,
    type Palette,
    type ParametricIntent,
    type ReferenceAttachment,
    type SvgVariant,
} from '@parametric-portal/api/contracts/icons';
import { type ApiError, type ApiResponse, api, type HttpStatusError } from '@parametric-portal/types/api';
import { asyncState } from '@parametric-portal/types/async';
import { Effect, pipe } from 'effect';

// --- [TYPES] -----------------------------------------------------------------

type GenerateInput = GenerateRequest & { readonly signal?: AbortSignal };

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    baseUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api',
    errors: {
        invalidInput: { code: 'INVALID_INPUT', message: 'Invalid generation input' },
    },
    headers: {
        contentType: 'application/json',
    },
} as const);

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const apiFactory = api<GenerateResponse>();
const asyncApi = asyncState<ApiResponse<GenerateResponse>, ApiError>();

const buildHeaders = (): HeadersInit => {
    const token = localStorage.getItem('accessToken');
    return {
        'Content-Type': B.headers.contentType,
        ...(token && { Authorization: `Bearer ${token}` }),
    };
};

const getPalette = (mode: ColorMode): Palette => ICON_DESIGN.palettes[mode];

const buildLayerManifest = (palette: Palette): string => {
    const { structural, semantic } = palette;
    const { layers } = ICON_DESIGN;

    const l1 = `<g id="${layers.guide.id}" stroke="${structural.guide}" stroke-width="${layers.guide.strokeWidth}" fill="none" stroke-dasharray="${layers.guide.dasharray}"/>`;
    const l2 = `<g id="${layers.context.id}" stroke="${structural.context}" stroke-width="${layers.context.strokeWidth}" fill="none"/>`;
    const l3 = `<g id="${layers.detail.id}" stroke="${structural.secondary}" stroke-width="${layers.detail.strokeWidth}" fill="none"/>`;
    const l4 = `<g id="${layers.primary.id}" stroke="${structural.primary}" stroke-width="${layers.primary.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
    const l5 = `<g id="${layers.grips.id}" stroke="${semantic.gripStroke}" stroke-width="${layers.grips.strokeWidth}" fill="${semantic.grip}"/>`;

    return [l1, l2, l3, l4, l5].join('\n  ');
};

// --- [ENTRY_POINT] -----------------------------------------------------------

const fetchGenerate = (
    req: GenerateRequest,
    signal?: AbortSignal,
): Effect.Effect<ApiResponse<GenerateResponse>, never, never> =>
    pipe(
        Effect.tryPromise({
            catch: (e) =>
                e instanceof Error && e.name === 'AbortError'
                    ? apiFactory.error(499 as HttpStatusError, 'REQUEST_CANCELLED', 'Request was cancelled')
                    : apiFactory.error(
                          500 as HttpStatusError,
                          'NETWORK_ERROR',
                          e instanceof Error ? e.message : String(e),
                      ),
            try: () =>
                fetch(`${B.baseUrl}/icons`, {
                    body: JSON.stringify(req),
                    headers: buildHeaders(),
                    method: 'POST',
                    ...(signal && { signal }),
                }),
        }),
        Effect.flatMap((response) =>
            pipe(
                Effect.tryPromise({
                    catch: () => apiFactory.error(500 as HttpStatusError, 'PARSE_ERROR', 'Failed to parse response'),
                    try: () => response.json() as Promise<unknown>,
                }),
                Effect.map((data) =>
                    response.ok
                        ? apiFactory.success(data as GenerateResponse)
                        : apiFactory.error(
                              response.status as HttpStatusError,
                              (data as { code?: string }).code ?? 'API_ERROR',
                              (data as { message?: string }).message ?? 'Request failed',
                          ),
                ),
            ),
        ),
        Effect.catchAll((err) => Effect.succeed(err)),
    );

const generateIcon = (input: GenerateInput): Effect.Effect<ApiResponse<GenerateResponse>, never, never> =>
    pipe(
        Effect.succeed(input),
        Effect.flatMap((validInput) => {
            const apiRequest: GenerateRequest = {
                ...(validInput.attachments && { attachments: validInput.attachments }),
                ...(validInput.colorMode && { colorMode: validInput.colorMode }),
                ...(validInput.intent && { intent: validInput.intent }),
                prompt: validInput.prompt,
                ...(validInput.referenceSvg && { referenceSvg: validInput.referenceSvg }),
                ...(validInput.variantCount && { variantCount: validInput.variantCount }),
            };

            return fetchGenerate(apiRequest, validInput.signal);
        }),
        Effect.map((response) =>
            response._tag === 'ApiSuccess'
                ? apiFactory.success({ id: response.data.id, variants: response.data.variants })
                : (response as ApiError),
        ),
    );

// --- [EXPORT] ----------------------------------------------------------------

export { apiFactory, asyncApi, B as API_CONFIG, buildLayerManifest, generateIcon, getPalette };
export type {
    ColorMode,
    GenerateInput,
    GenerateRequest,
    GenerateResponse,
    Palette,
    ParametricIntent,
    ReferenceAttachment,
    SvgVariant,
};
