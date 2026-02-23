/**
 * Rhino command knowledge base manifest: schema definitions and sample data.
 * Dual-purpose shape feeding both KB embedding (PERS-05) and future Tool.make
 * definitions (Phase 5 AGNT-02/AGNT-04).
 */
import { type Effect, Schema as S } from 'effect';
import type { ParseError } from 'effect/ParseResult';

// --- [SCHEMA] ----------------------------------------------------------------

const CommandParamSchema = S.Struct({
    default:     S.optional(S.Unknown),
    description: S.optional(S.String),
    name:        S.NonEmptyTrimmedString,
    required:    S.Boolean,
    type:        S.NonEmptyTrimmedString,
});

const CommandExampleSchema = S.Struct({
    description: S.optional(S.String),
    input:       S.NonEmptyString,
});

const CommandManifestEntrySchema = S.Struct({
    category:      S.optional(S.NonEmptyTrimmedString),
    description:   S.NonEmptyString,
    examples:      S.Array(CommandExampleSchema),
    id:            S.NonEmptyTrimmedString,
    isDestructive: S.optional(S.Boolean),
    name:          S.NonEmptyTrimmedString,
    params:        S.Array(CommandParamSchema),
});

type CommandManifestEntry = typeof CommandManifestEntrySchema.Type;

const CommandManifestSchema = S.Array(CommandManifestEntrySchema);

// --- [CONSTANTS] -------------------------------------------------------------

const SAMPLE_MANIFEST: ReadonlyArray<CommandManifestEntry> = [
    {
        category: 'Geometry Creation',
        description: 'Draws a line between two points in 3D space. The line is the most fundamental curve primitive in Rhino.',
        examples: [
            { description: 'Draw a line from origin to (10,0,0)', input: 'Line 0,0,0 10,0,0' },
            { description: 'Start interactive line drawing with point picks', input: 'Line' },
        ],
        id: 'line',
        isDestructive: false,
        name: 'Line',
        params: [
            { description: 'Start point of the line', name: 'Start', required: true, type: 'Point3d' },
            { description: 'End point of the line', name: 'End', required: true, type: 'Point3d' },
        ],
    },
    {
        category: 'Geometry Creation',
        description: 'Draws a circle from a center point and radius. Supports multiple construction modes including 3-point, tangent, and fit.',
        examples: [
            { description: 'Draw a circle at origin with radius 5', input: 'Circle 0,0,0 5' },
            { description: 'Draw a circle through three picked points', input: 'Circle 3Point' },
        ],
        id: 'circle',
        isDestructive: false,
        name: 'Circle',
        params: [
            { description: 'Center point of the circle', name: 'Center', required: true, type: 'Point3d' },
            { description: 'Radius of the circle', name: 'Radius', required: true, type: 'number' },
        ],
    },
    {
        category: 'Geometry Creation',
        description: 'Creates a 3D box (rectangular parallelepiped) from a base rectangle and height. The base is defined by two corner points on the construction plane.',
        examples: [
            { description: 'Create a 10x10x5 box at origin', input: 'Box 0,0,0 10,10,0 5' },
        ],
        id: 'box',
        isDestructive: false,
        name: 'Box',
        params: [
            { description: 'First corner of the base rectangle', name: 'Corner1', required: true, type: 'Point3d' },
            { description: 'Opposite corner of the base rectangle', name: 'Corner2', required: true, type: 'Point3d' },
            { description: 'Height of the box', name: 'Height', required: true, type: 'number' },
        ],
    },
    {
        category: 'Geometry Creation',
        description: 'Creates a sphere from a center point and radius. Produces a NURBS surface representing a closed sphere.',
        examples: [
            { description: 'Create a sphere at origin with radius 5', input: 'Sphere 0,0,0 5' },
        ],
        id: 'sphere',
        isDestructive: false,
        name: 'Sphere',
        params: [
            { description: 'Center point of the sphere', name: 'Center', required: true, type: 'Point3d' },
            { description: 'Radius of the sphere', name: 'Radius', required: true, type: 'number' },
        ],
    },
    {
        category: 'Geometry Creation',
        description: 'Extrudes a planar curve along a direction to create a surface or polysurface. The extrusion direction defaults to the curve normal.',
        examples: [
            { description: 'Extrude curve upward by 10 units', input: 'ExtrudeCrv selid:1 0,0,10' },
        ],
        id: 'extrude-crv',
        isDestructive: false,
        name: 'ExtrudeCrv',
        params: [
            { description: 'Curve object to extrude', name: 'Curve', required: true, type: 'CurveId' },
            { description: 'Extrusion direction and distance', name: 'Direction', required: true, type: 'Point3d' },
            { default: false, description: 'Extrude in both directions', name: 'BothSides', required: false, type: 'boolean' },
            { default: true, description: 'Cap the ends to create a solid', name: 'Cap', required: false, type: 'boolean' },
        ],
    },
    {
        category: 'Modification',
        description: 'Moves objects from one location to another by specifying a base point and a destination point, or by a displacement vector.',
        examples: [
            { description: 'Move object from origin to (10,5,0)', input: 'Move selid:1 0,0,0 10,5,0' },
        ],
        id: 'move',
        isDestructive: false,
        name: 'Move',
        params: [
            { description: 'Objects to move', name: 'Objects', required: true, type: 'ObjectId[]' },
            { description: 'Base point for the move', name: 'Point', required: true, type: 'Point3d' },
            { description: 'Destination point', name: 'ToPoint', required: true, type: 'Point3d' },
        ],
    },
    {
        category: 'Modification',
        description: 'Duplicates objects from one location to another. The original objects remain in place while copies are created at the destination.',
        examples: [
            { description: 'Copy object 20 units along X axis', input: 'Copy selid:1 0,0,0 20,0,0' },
        ],
        id: 'copy',
        isDestructive: false,
        name: 'Copy',
        params: [
            { description: 'Objects to copy', name: 'Objects', required: true, type: 'ObjectId[]' },
            { description: 'Base point for the copy', name: 'Point', required: true, type: 'Point3d' },
            { description: 'Destination point for the copy', name: 'ToPoint', required: true, type: 'Point3d' },
        ],
    },
    {
        category: 'Modification',
        description: 'Rotates objects around a center point by a specified angle. The rotation axis defaults to the construction plane normal.',
        examples: [
            { description: 'Rotate object 45 degrees around origin', input: 'Rotate selid:1 0,0,0 45' },
        ],
        id: 'rotate',
        isDestructive: false,
        name: 'Rotate',
        params: [
            { description: 'Objects to rotate', name: 'Objects', required: true, type: 'ObjectId[]' },
            { description: 'Center of rotation', name: 'Center', required: true, type: 'Point3d' },
            { description: 'Rotation angle in degrees', name: 'Angle', required: true, type: 'number' },
        ],
    },
    {
        category: 'Modification',
        description: 'Scales objects uniformly or non-uniformly relative to a base point. Uniform scaling preserves proportions.',
        examples: [
            { description: 'Scale object to double size from origin', input: 'Scale selid:1 0,0,0 2' },
            { description: 'Scale object to half size from origin', input: 'Scale selid:1 0,0,0 0.5' },
        ],
        id: 'scale',
        isDestructive: false,
        name: 'Scale',
        params: [
            { description: 'Objects to scale', name: 'Objects', required: true, type: 'ObjectId[]' },
            { description: 'Base point for scaling', name: 'Origin', required: true, type: 'Point3d' },
            { description: 'Scale factor (1.0 = no change)', name: 'Factor', required: true, type: 'number' },
        ],
    },
    {
        category: 'Modification',
        description: 'Creates a mirror image of objects across a specified plane defined by two points. Optionally deletes the original objects.',
        examples: [
            { description: 'Mirror object across the Y axis', input: 'Mirror selid:1 0,0,0 0,10,0' },
        ],
        id: 'mirror',
        isDestructive: false,
        name: 'Mirror',
        params: [
            { description: 'Objects to mirror', name: 'Objects', required: true, type: 'ObjectId[]' },
            { description: 'First point of the mirror axis', name: 'Start', required: true, type: 'Point3d' },
            { description: 'Second point of the mirror axis', name: 'End', required: true, type: 'Point3d' },
        ],
    },
    {
        category: 'Query',
        description: 'Displays detailed information about selected objects including object type, layer, color, material, surface area, volume, and bounding box dimensions.',
        examples: [
            { description: 'Display properties of a selected object', input: 'What selid:1' },
        ],
        id: 'what',
        isDestructive: false,
        name: 'What',
        params: [
            { description: 'Objects to query', name: 'Objects', required: true, type: 'ObjectId[]' },
        ],
    },
    {
        category: 'Query',
        description: 'Measures and reports the length of curves, edges, or the distance between two points.',
        examples: [
            { description: 'Report the length of a selected curve', input: 'Length selid:1' },
        ],
        id: 'length',
        isDestructive: false,
        name: 'Length',
        params: [
            { description: 'Curve to measure', name: 'Curve', required: true, type: 'CurveId' },
        ],
    },
    {
        category: 'Query',
        description: 'Calculates and reports the area of closed planar curves, surfaces, polysurfaces, or meshes.',
        examples: [
            { description: 'Report the surface area of a selected object', input: 'Area selid:1' },
        ],
        id: 'area',
        isDestructive: false,
        name: 'Area',
        params: [
            { description: 'Objects to measure area of', name: 'Objects', required: true, type: 'ObjectId[]' },
        ],
    },
    {
        category: 'Query',
        description: 'Calculates and reports the volume of closed solids, polysurfaces, or meshes. Objects must be closed (watertight) for accurate results.',
        examples: [
            { description: 'Report the volume of a selected closed solid', input: 'Volume selid:1' },
        ],
        id: 'volume',
        isDestructive: false,
        name: 'Volume',
        params: [
            { description: 'Closed objects to measure volume of', name: 'Objects', required: true, type: 'ObjectId[]' },
        ],
    },
    {
        category: 'Viewport',
        description: 'Changes the viewport magnification. Supports zoom extents, zoom selected, zoom window, and zoom to a specific scale factor.',
        examples: [
            { description: 'Zoom to fit all objects in the viewport', input: 'Zoom Extents' },
            { description: 'Zoom to fit the selected objects', input: 'Zoom Selected' },
        ],
        id: 'zoom',
        isDestructive: false,
        name: 'Zoom',
        params: [
            { default: 'Extents', description: 'Zoom mode: Extents, Selected, Window, In, Out, Target', name: 'Mode', required: false, type: 'string' },
            { description: 'Zoom factor (used with In/Out modes)', name: 'Factor', required: false, type: 'number' },
        ],
    },
    {
        category: 'Modification',
        description: 'Removes selected objects from the document permanently. This operation can be undone with the Undo command.',
        examples: [
            { description: 'Delete a selected object', input: 'Delete selid:1' },
        ],
        id: 'delete',
        isDestructive: true,
        name: 'Delete',
        params: [
            { description: 'Objects to delete', name: 'Objects', required: true, type: 'ObjectId[]' },
        ],
    },
] as const satisfies ReadonlyArray<CommandManifestEntry>;

// --- [FUNCTIONS] -------------------------------------------------------------

const loadManifest = (json: string): Effect.Effect<ReadonlyArray<CommandManifestEntry>, ParseError> =>
    S.decodeUnknown(S.parseJson(CommandManifestSchema))(json);

// --- [EXPORT] ----------------------------------------------------------------

export { CommandManifestEntrySchema, CommandManifestSchema, loadManifest, SAMPLE_MANIFEST };
export type { CommandManifestEntry };
