import { Data, Duration, Effect, HashMap, Match, Option, Ref } from 'effect';
import { HarnessConfig } from '../config';
import { KargadanSocketClient } from '../socket';
import type { Envelope } from './schemas';

// --- [CONSTANTS] -------------------------------------------------------------

const _DispatchPolicy = {
    disconnected: { code: 'DISPATCH_DISCONNECTED',  failureClass: 'retryable' },
    protocol:     { code: 'DISPATCH_PROTOCOL',      failureClass: 'fatal'     },
    rejected:     { code: 'DISPATCH_REJECTED',      failureClass: 'fatal'     },
    transport:    { code: 'DISPATCH_TRANSPORT',     failureClass: 'retryable' },
} as const satisfies Record<string, { code: string; failureClass: Envelope.FailureClass }>;
const _fmtVec  = (value: ReadonlyArray<number>) => value.join(',');
const _selById = (ids: ReadonlyArray<string>)   => ids.map((id) => `_SelId ${id}`).join(' ');
const _V3 = 'number[3]';
const _param = (name: string, type: string, description: string, required = false) => ({ description, name, required, type });

// why: each template command defines its catalog metadata AND its script expander in a single record
type _TemplateSpec = {
    readonly category:      string;
    readonly description:   string;
    readonly expand?:       (args: Record<string, unknown>) => string;
    readonly isDestructive: boolean;
    readonly name:          string;
    readonly params:        ReadonlyArray<ReturnType<typeof _param>>;
};
const _toCatalogEntry = (id: string, spec: _TemplateSpec): Envelope.CatalogEntry =>
    ({ aliases: [], category: spec.category, description: spec.description, dispatch: { mode: 'script' as const },
        examples: [{ description: spec.description, input: '{}' }], id, isDestructive: spec.isDestructive, name: spec.name, params: spec.params,
        requirements: { minimumObjectRefCount: 0, requiresObjectRefs: false, requiresTelemetryContext: true } });

// why: unified vocabulary — catalog metadata and script expanders colocated per command ID
const _TEMPLATE_VOCABULARY = {
    'analysis.curvature':  { category: 'analysis', description: 'Displays curvature analysis color mapping on surfaces.', isDestructive: false, name: 'Curvature Analysis',
        params: [_param('objectIds', 'UUID[]', 'Surface IDs to analyze', true)] },
    'analysis.draftAngle': { category: 'analysis', description: 'Displays draft angle analysis relative to a pull direction.', isDestructive: false, name: 'Draft Angle Analysis',
        params: [_param('objectIds', 'UUID[]', 'Surface IDs to analyze', true), _param('direction', _V3, 'Pull direction [x,y,z]', false)] },
    'analysis.zebra':      { category: 'analysis', description: 'Displays zebra stripe analysis for surface continuity evaluation.', isDestructive: false, name: 'Zebra Analysis',
        params: [_param('objectIds', 'UUID[]', 'Surface IDs to analyze', true)] },
    'array.curve':         { category: 'array', description: 'Creates an array of objects distributed along a curve.', isDestructive: false, name: 'Array Along Curve',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to array', true), _param('curveId', 'UUID', 'Guide curve ID', true), _param('count', 'number', 'Number of copies', true)] },
    'array.linear':        { category: 'array', description: 'Creates a linear array of objects.', isDestructive: false, name: 'Array Linear',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to array', true), _param('direction', _V3, 'Array direction [x,y,z]', true), _param('count', 'number', 'Number of copies', true), _param('distance', 'number', 'Spacing distance', true)] },
    'array.polar':         { category: 'array', description: 'Creates a polar array of objects around a center.', isDestructive: false, name: 'Array Polar',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to array', true), _param('center', _V3, 'Center of rotation [x,y,z]', true), _param('count', 'number', 'Number of copies', true), _param('angle', 'number', 'Total angle in degrees', false)] },
    'boolean.difference':  { category: 'boolean', description: 'Subtracts solids from a target solid.', 
        expand: (a) => `_SelNone _SelId ${String(a['target'])} ${_selById(a['subtractors'] as ReadonlyArray<string>)} _BooleanDifference _Enter _SelNone`,isDestructive: true, name: 'Boolean Difference',
        params: [_param('target', 'UUID', 'Target solid object ID', true), _param('subtractors', 'UUID[]', 'Solid IDs to subtract', true)] },
    'boolean.intersection': { category: 'boolean', description: 'Creates the overlapping volume of two or more solids.', isDestructive: true, name: 'Boolean Intersection',
        params: [_param('operands', 'UUID[]', 'Object IDs to intersect', true)] },
    'boolean.split':       { category: 'boolean', description: 'Splits solids at their intersections.', isDestructive: true, name: 'Boolean Split',
        params: [_param('operands', 'UUID[]', 'Object IDs to split', true)] },
    'boolean.twoObjects':  { category: 'boolean', description: 'Performs all boolean operations between two solids interactively.', isDestructive: true, name: 'Boolean 2 Objects',
        params: [_param('objectA', 'UUID', 'First solid ID', true), _param('objectB', 'UUID', 'Second solid ID', true)] },
    'boolean.union':       { category: 'boolean', description: 'Combines overlapping solids into a single solid.', 
        expand: (a) => `_SelNone ${_selById(a['operands'] as ReadonlyArray<string>)} _BooleanUnion _Enter _SelNone`,isDestructive: true, name: 'Boolean Union',
        params: [_param('operands', 'UUID[]', 'Object IDs to union', true)] },
    'control.insertPoint': { category: 'control', description: 'Inserts a new control point into a curve or surface.', isDestructive: true, name: 'Insert Control Point',
        params: [_param('objectId', 'UUID', 'Curve or surface ID', true)] },
    'control.pointsOn':    { category: 'control', description: 'Enables control point display for selected objects.', isDestructive: false, name: 'Points On',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to show points', true)] },
    'control.removePoint': { category: 'control', description: 'Removes a control point from a curve or surface.', isDestructive: true, name: 'Remove Control Point',
        params: [_param('objectId', 'UUID', 'Curve or surface ID', true)] },
    'edge.chamfer':        { category: 'edge', description: 'Creates a chamfer line between two curves.', isDestructive: false, name: 'Chamfer Curves',
        params: [_param('curve1Id', 'UUID', 'First curve ID', true), _param('curve2Id', 'UUID', 'Second curve ID', true), _param('distance', 'number', 'Chamfer distance', true)] },
    'edge.chamferEdge':    { category: 'edge', description: 'Bevels edges of a solid with a specified distance.', isDestructive: true, name: 'Chamfer Edge',
        params: [_param('objectId', 'UUID', 'Solid object ID', true), _param('distance', 'number', 'Chamfer distance', true)] },
    'edge.fillet':         { category: 'edge', description: 'Creates a fillet arc between two curves.', isDestructive: false, name: 'Fillet Curves',
        params: [_param('curve1Id', 'UUID', 'First curve ID', true), _param('curve2Id', 'UUID', 'Second curve ID', true), _param('radius', 'number', 'Fillet radius', true)] },
    'edge.filletEdge':     { category: 'edge', description: 'Rounds edges of a solid with a specified radius.', isDestructive: true, name: 'Fillet Edge',
        params: [_param('objectId', 'UUID', 'Solid object ID', true), _param('radius', 'number', 'Fillet radius', true)] },
    'edit.dupEdge':        { category: 'edit', description: 'Extracts a duplicate curve from surface or polysurface edges.', isDestructive: false, name: 'Duplicate Edge',
        params: [_param('objectId', 'UUID', 'Surface or polysurface ID', true)] },
    'edit.explode':        { category: 'edit', description: 'Breaks polycurves or polysurfaces into individual segments.', isDestructive: true, name: 'Explode',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to explode', true)] },
    'edit.extendSrf':      { category: 'edit', description: 'Extends a surface edge by a specified length.', isDestructive: true, name: 'Extend Surface',
        params: [_param('surfaceId', 'UUID', 'Surface to extend', true), _param('length', 'number', 'Extension length', true)] },
    'edit.join':           { category: 'edit', description: 'Joins curves or surfaces into polycurves or polysurfaces.', isDestructive: true, name: 'Join',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to join', true)] },
    'edit.rebuild':        { category: 'edit', description: 'Rebuilds a curve or surface with new point count and degree.', isDestructive: true, name: 'Rebuild',
        params: [_param('objectId', 'UUID', 'Object ID to rebuild', true), _param('pointCount', 'number', 'New control point count', true), _param('degree', 'number', 'New degree', false)] },
    'edit.split':          { category: 'edit', description: 'Splits curves or surfaces at intersection points.', isDestructive: true, name: 'Split',
        params: [_param('objectIds', 'UUID[]', 'Objects to split', true), _param('cutterIds', 'UUID[]', 'Cutting object IDs', true)] },
    'edit.trim':           { category: 'edit', description: 'Trims curves or surfaces using cutting objects.', isDestructive: true, name: 'Trim',
        params: [_param('objectIds', 'UUID[]', 'Objects to trim', true), _param('cutterIds', 'UUID[]', 'Cutting object IDs', true)] },
    'geometry.box':        { category: 'geometry', description: 'Creates a box from two opposite corner points.', 
        expand: (a) => `_Box ${_fmtVec(a['corner1'] as ReadonlyArray<number>)} ${_fmtVec(a['corner2'] as ReadonlyArray<number>)} _Enter`,isDestructive: false, name: 'Create Box',
        params: [_param('corner1', _V3, 'First corner [x,y,z]', true), _param('corner2', _V3, 'Opposite corner [x,y,z]', true)] },
    'geometry.cylinder':   { category: 'geometry', description: 'Creates a cylinder from center, radius, and height.', 
        expand: (a) => `_Cylinder ${_fmtVec(a['center'] as ReadonlyArray<number>)} ${String(a['radius'])} ${String(a['height'])} _Enter`,isDestructive: false, name: 'Create Cylinder',
        params: [_param('center', _V3, 'Base center [x,y,z]', true), _param('radius', 'number', 'Cylinder radius', true), _param('height', 'number', 'Cylinder height', true)] },
    'geometry.extrude':    { category: 'geometry', description: 'Extrudes a curve along a direction vector.', 
        expand: (a) => `_SelNone _SelId ${String(a['curveId'])} _ExtrudeCrv _Direction ${_fmtVec(a['direction'] as ReadonlyArray<number>)} ${String(a['distance'])} _Enter _SelNone`,isDestructive: false, name: 'Extrude Curve',
        params: [_param('curveId', 'UUID', 'Source curve object ID', true), _param('direction', _V3, 'Extrusion direction [x,y,z]', true), _param('distance', 'number', 'Extrusion distance', true)] },
    'geometry.sphere':     { category: 'geometry', description: 'Creates a sphere from center point and radius.', 
        expand: (a) => `_Sphere ${_fmtVec(a['center'] as ReadonlyArray<number>)} ${String(a['radius'])} _Enter`,isDestructive: false, name: 'Create Sphere',
        params: [_param('center', _V3, 'Center point [x,y,z]', true), _param('radius', 'number', 'Sphere radius', true)] },
    'mesh.create':         { category: 'mesh', description: 'Creates a mesh from NURBS geometry.', isDestructive: false, name: 'Mesh from NURBS',
        params: [_param('objectIds', 'UUID[]', 'NURBS object IDs to mesh', true)] },
    'mesh.reduce':         { category: 'mesh', description: 'Reduces mesh polygon count while preserving shape.', isDestructive: true, name: 'Reduce Mesh',
        params: [_param('meshId', 'UUID', 'Mesh ID to reduce', true), _param('targetCount', 'number', 'Target polygon count', true)] },
    'mesh.toNurb':         { category: 'mesh', description: 'Converts mesh faces to NURBS surfaces.', isDestructive: false, name: 'Mesh to NURBS',
        params: [_param('meshId', 'UUID', 'Source mesh ID', true)] },
    'offset.curveOnSrf':   { category: 'offset', description: 'Offsets a curve constrained to a surface.', isDestructive: false, name: 'Offset Curve on Surface',
        params: [_param('curveId', 'UUID', 'Source curve ID', true), _param('surfaceId', 'UUID', 'Constraining surface ID', true), _param('distance', 'number', 'Offset distance', true)] },
    'offset.surface':      { category: 'offset', description: 'Creates a new surface offset from an existing surface.', isDestructive: false, name: 'Offset Surface',
        params: [_param('surfaceId', 'UUID', 'Source surface ID', true), _param('distance', 'number', 'Offset distance', true)] },
    'solid.extrudeSrf':    { category: 'solid', description: 'Extrudes a surface along a direction to create a solid.', isDestructive: false, name: 'Extrude Surface',
        params: [_param('surfaceId', 'UUID', 'Surface to extrude', true), _param('direction', _V3, 'Extrusion direction [x,y,z]', true), _param('distance', 'number', 'Extrusion distance', true)] },
    'solid.pipe':          { category: 'solid', description: 'Creates a pipe solid along a rail curve.', isDestructive: false, name: 'Pipe',
        params: [_param('railId', 'UUID', 'Rail curve ID', true), _param('radius', 'number', 'Pipe radius', true), _param('cap', 'boolean', 'Cap ends', false)] },
    'subd.create':         { category: 'subd', description: 'Creates a SubD primitive shape.', isDestructive: false, name: 'SubD',
        params: [_param('shape', 'string', 'Primitive type (box, sphere, cylinder)', true)] },
    'subd.fromMesh':       { category: 'subd', description: 'Creates a SubD surface from an existing mesh.', isDestructive: false, name: 'SubD from Mesh',
        params: [_param('meshId', 'UUID', 'Source mesh ID', true)] },
    'subd.toSubD':         { category: 'subd', description: 'Converts NURBS geometry to SubD representation.', isDestructive: true, name: 'To SubD',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to convert', true)] },
    'surface.blendSrf':    { category: 'surface', description: 'Creates a blend surface between two surface edges.', isDestructive: false, name: 'Blend Surface',
        params: [_param('surface1Id', 'UUID', 'First surface ID', true), _param('surface2Id', 'UUID', 'Second surface ID', true), _param('continuity', 'string', 'Continuity type (position, tangent, curvature)', false)] },
    'surface.loft':        { category: 'surface', description: 'Creates a surface by lofting through profile curves.', isDestructive: false, name: 'Loft',
        params: [_param('curveIds', 'UUID[]', 'Profile curve IDs in order', true)] },
    'surface.networkSrf':  { category: 'surface', description: 'Creates a surface from a network of intersecting curves.', isDestructive: false, name: 'Network Surface',
        params: [_param('curveIds', 'UUID[]', 'Network curve IDs', true)] },
    'surface.patch':       { category: 'surface', description: 'Creates a trimmed patch surface from boundary curves or points.', isDestructive: false, name: 'Patch',
        params: [_param('curveIds', 'UUID[]', 'Boundary curve IDs', true), _param('spans', 'number', 'Patch span count', false)] },
    'surface.planarSrf':   { category: 'surface', description: 'Creates a planar surface from closed planar curves.', isDestructive: false, name: 'Planar Surface',
        params: [_param('curveIds', 'UUID[]', 'Closed planar curve IDs', true)] },
    'surface.sweep1':      { category: 'surface', description: 'Sweeps a profile curve along a single rail curve.', isDestructive: false, name: 'Sweep 1 Rail',
        params: [_param('railId', 'UUID', 'Rail curve ID', true), _param('profileIds', 'UUID[]', 'Cross-section profile IDs', true)] },
    'surface.sweep2':      { category: 'surface', description: 'Sweeps a profile curve along two rail curves.', isDestructive: false, name: 'Sweep 2 Rails',
        params: [_param('rail1Id', 'UUID', 'First rail curve ID', true), _param('rail2Id', 'UUID', 'Second rail curve ID', true), _param('profileIds', 'UUID[]', 'Cross-section profile IDs', true)] },
    'transform.mirror':    { category: 'transform', description: 'Mirrors selected objects across a plane.', 
        expand: (a) => `_SelNone ${_selById(a['objectIds'] as ReadonlyArray<string>)} _Mirror ${_fmtVec(a['planeOrigin'] as ReadonlyArray<number>)} ${_fmtVec(a['planeNormal'] as ReadonlyArray<number>)} _Enter _SelNone`,isDestructive: true, name: 'Mirror Objects',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to mirror', true), _param('planeOrigin', _V3, 'Mirror plane origin [x,y,z]', true), _param('planeNormal', _V3, 'Mirror plane normal [x,y,z]', true)] },
    'transform.rotate':    { category: 'transform', description: 'Rotates selected objects around a center point.', 
        expand: (a) => `_SelNone ${_selById(a['objectIds'] as ReadonlyArray<string>)} _Rotate ${_fmtVec(a['center'] as ReadonlyArray<number>)} ${String(a['angle'])} _Enter _SelNone`,isDestructive: true, name: 'Rotate Objects',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to rotate', true), _param('center', _V3, 'Rotation center [x,y,z]', true), _param('angle', 'number', 'Rotation angle in degrees', true)] },
    'transform.scale':     { category: 'transform', description: 'Scales selected objects from an origin point.', 
        expand: (a) => `_SelNone ${_selById(a['objectIds'] as ReadonlyArray<string>)} _Scale ${_fmtVec(a['origin'] as ReadonlyArray<number>)} ${String(a['factor'])} _Enter _SelNone`,isDestructive: true, name: 'Scale Objects',
        params: [_param('objectIds', 'UUID[]', 'Object IDs to scale', true), _param('origin', _V3, 'Scale origin [x,y,z]', true), _param('factor', 'number', 'Scale factor', true)] },
} as const satisfies Record<string, _TemplateSpec>;
// why: HashMap for structural equality and immutable lookup; derived once from vocabulary
const _ExpanderMap = HashMap.fromIterable(
    (Object.entries(_TEMPLATE_VOCABULARY) as ReadonlyArray<readonly [string, _TemplateSpec]>)
        .filter((entry): entry is readonly [string, _TemplateSpec & { readonly expand: (args: Record<string, unknown>) => string }] => entry[1].expand !== undefined)
        .map(([id, spec]) => [id, spec.expand] as const));

// --- [ERRORS] ----------------------------------------------------------------

class CommandDispatchError extends Data.TaggedError('CommandDispatchError')<{
    readonly reason:        keyof typeof _DispatchPolicy;
    readonly details?:      unknown;
    readonly failureClass?: Envelope.FailureClass;
}> {
    get code() { return _DispatchPolicy[this.reason].code; }
    get retryable() { return this.resolvedFailureClass === 'retryable'; }
    get resolvedFailureClass(): Envelope.FailureClass { return this.failureClass ?? _DispatchPolicy[this.reason].failureClass; }
    get errorPayload() { return { code: this.code, details: this.details, failureClass: this.resolvedFailureClass, message: this.message } as const; }
    override get message() {
        const prefix = `CommandDispatch/${this.reason}`;
        return this.details === undefined ? prefix : `${prefix}: ${JSON.stringify(this.details)}`;
    }
}

// --- [SERVICES] --------------------------------------------------------------

class CommandDispatch extends Effect.Service<CommandDispatch>()('kargadan/CommandDispatch', {
    effect: Effect.gen(function* () {
        const socket = yield* KargadanSocketClient;
        const config = yield* HarnessConfig;
        const { commandDeadlineMs, protocolVersion, resolveCapabilities: capabilities, tokenExpiryMinutes } = config;
        const catalogRef = yield* Ref.make<ReadonlyArray<Envelope.CatalogEntry>>([]);
        const phaseRef = yield* Ref.make<'connecting' | 'active' | 'closed'>('connecting');
        const _request = Effect.fn('CommandDispatch.request')((envelope: Envelope.Outbound) =>
            socket.request(envelope).pipe(
                Effect.catchTag('SocketClientError', (error) => Ref.set(phaseRef, 'closed').pipe(
                    Effect.andThen(Effect.fail(new CommandDispatchError({
                        details: { socketDetail: error.detail, socketReason: error.reason },
                        reason: Match.value(error.reason).pipe(
                            Match.when('protocol', () => 'protocol' as const),
                            Match.orElse(() => error.terminal ? 'disconnected' as const : 'transport' as const)),
                    }))))),
            ));
        const handshake = Effect.fn('CommandDispatch.handshake')(
            ({ token, ...identity }: Envelope.Identity & { readonly token: string }) =>
                Ref.set(phaseRef, 'connecting').pipe(
                    Effect.zipRight(_request({ _tag: 'handshake.init', ...identity,
                        auth: { token, tokenExpiresAt: new Date(Date.now() + Duration.toMillis(Duration.minutes(tokenExpiryMinutes))) },
                        capabilities, protocolVersion,
                        telemetryContext: { attempt: 1, operationTag: 'handshake.init', spanId: identity.requestId.replaceAll('-', ''), traceId: identity.correlationId },
                    })),
                    Effect.flatMap((response) => Match.value(response).pipe(
                        Match.tag('handshake.ack', (ack) => Effect.all([
                            Ref.set(phaseRef, 'active'), Ref.set(catalogRef, ack.catalog), Effect.log('kargadan.session.authenticated'),
                        ], { discard: true }).pipe(Effect.as(ack))),
                        Match.tag('handshake.reject', (r) => Ref.set(catalogRef, []).pipe(Effect.zipRight(
                            Effect.fail(new CommandDispatchError({ details: { code: r.code, message: r.message }, failureClass: r.failureClass, reason: 'rejected' }))))),
                        Match.orElse((reply) => Effect.fail(new CommandDispatchError({ details: { expected: 'handshake.ack|handshake.reject', received: reply._tag }, reason: 'protocol' })))))));
        // why: template commands rewrite to script.run with expanded Rhino command strings
        const execute = Effect.fn('CommandDispatch.execute')((command: Envelope.Command) => {
            const expanded = HashMap.get(_ExpanderMap, command.commandId).pipe(
                Option.map((expand) => ({ ...command, args: { script: expand(command.args) }, commandId: 'script.run' }) as Envelope.Command),
                Option.getOrElse(() => command));
            return _request(expanded).pipe(Effect.flatMap((response) => Match.value(response).pipe(
                Match.tag('result', Effect.succeed),
                Match.orElse((reply) => Effect.fail(new CommandDispatchError({ details: { expected: 'result', received: reply._tag }, reason: 'protocol' }))))));
        });
        const heartbeat = Effect.fn('CommandDispatch.heartbeat')((base: Envelope.IdentityBase) =>
            _request({ _tag: 'heartbeat', ...base, mode: 'ping', requestId: crypto.randomUUID() }).pipe(
                Effect.flatMap((response) => Match.value(response).pipe(
                    Match.when({ _tag: 'heartbeat', mode: 'pong' as const }, Effect.succeed),
                    Match.orElse((reply) => Effect.fail(new CommandDispatchError({ details: { expected: 'heartbeat.pong', received: reply._tag }, reason: 'protocol' })))))));
        const receiveCatalog = Effect.fn('CommandDispatch.receiveCatalog')(() => Ref.get(catalogRef));
        const buildCommand = (identityBase: Envelope.IdentityBase, commandId: string, args: Record<string, unknown>, options?: {
            readonly attempt?:    number; readonly deadlineMs?: number; readonly idempotency?: Envelope.Command['idempotency'];
            readonly objectRefs?: Envelope.Command['objectRefs']; readonly operationTag?: string;
            readonly requestId?:  string; readonly undoScope?: Envelope.Command['undoScope'];
        }): Envelope.Command => {
            const requestId = options?.requestId ?? crypto.randomUUID();
            return {
                _tag: 'command', ...identityBase, args, commandId, deadlineMs: options?.deadlineMs ?? commandDeadlineMs,
                idempotency: options?.idempotency, objectRefs: options?.objectRefs, requestId,
                telemetryContext: { attempt: Math.max(1, options?.attempt ?? 1), operationTag: options?.operationTag ?? commandId,
                    spanId:  requestId.replaceAll('-', ''), traceId: identityBase.correlationId },
                undoScope:   options?.undoScope,
            };
        };
        const buildErrorResult = (command: Envelope.Command, error: Envelope.ErrorPayload): Envelope.Result => ({
            _tag: 'result', appId: command.appId, correlationId: command.correlationId,
            dedupe: { decision: 'rejected', originalRequestId: command.requestId },
            error, requestId: command.requestId, sessionId: command.sessionId, status: 'error',
        });
        return { buildCommand, buildErrorResult, execute, handshake, heartbeat, phase: Ref.get(phaseRef), receiveCatalog, start: socket.start, takeEvent: socket.takeEvent } as const;
    }),
}) {
    static readonly templateCatalog = Object.entries(_TEMPLATE_VOCABULARY).map(([id, spec]) => _toCatalogEntry(id, spec));
}

// --- [EXPORT] ----------------------------------------------------------------

export { CommandDispatch, CommandDispatchError };
