/**
 * RFC 6902 (JSON Patch) authoritative test vectors.
 * Source: github.com/json-patch/json-patch-tests — external oracle independent of implementation.
 */
import { it } from '@effect/vitest';
import { Diff } from '@parametric-portal/server/utils/diff';
import { Effect } from 'effect';
import { expect } from 'vitest';

// --- [CONSTANTS] -------------------------------------------------------------

const RFC6902_VECTORS = [
    { comment: 'A.1 add object member',          doc: { foo: 'bar' },                                                        expected: { baz: 'qux', foo: 'bar' }, patch: [{ op: 'add', path: '/baz', value: 'qux' }]                                         },
    { comment: 'A.2 add array element',           doc: { foo: ['bar', 'baz'] },                                               expected: { foo: ['bar', 'qux', 'baz'] }, patch: [{ op: 'add', path: '/foo/1', value: 'qux' }]                                       },
    { comment: 'A.3 remove object member',        doc: { baz: 'qux', foo: 'bar' },                                            expected: { foo: 'bar' }, patch: [{ op: 'remove', path: '/baz' }]                                                    },
    { comment: 'A.4 remove array element',        doc: { foo: ['bar', 'qux', 'baz'] },                                        expected: { foo: ['bar', 'baz'] }, patch: [{ op: 'remove', path: '/foo/1' }]                                                  },
    { comment: 'A.5 replace value',               doc: { baz: 'qux', foo: 'bar' },                                            expected: { baz: 'boo', foo: 'bar' }, patch: [{ op: 'replace', path: '/baz', value: 'boo' }]                                     },
    { comment: 'A.6 move value (nested)',         doc: { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } },      expected: { foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } }, patch: [{ from: '/foo/waldo', op: 'move', path: '/qux/thud' }]                              },
    { comment: 'A.7 move array element',          doc: { foo: ['all', 'grass', 'cows', 'eat'] },                               expected: { foo: ['all', 'cows', 'eat', 'grass'] }, patch: [{ from: '/foo/1', op: 'move', path: '/foo/3' }]                                     },
    { comment: 'A.8 test value (success)',        doc: { baz: 'qux', foo: ['a', 2, 'c'] },                                    expected: { baz: 'qux', foo: ['a', 2, 'c'] }, patch: [{ op: 'test', path: '/baz', value: 'qux' }, { op: 'test', path: '/foo/1', value: 2 }] },
    { comment: 'A.10 add nested object',          doc: { foo: 'bar' },                                                        expected: { child: { grandchild: {} }, foo: 'bar' }, patch: [{ op: 'add', path: '/child', value: { grandchild: {} } }]                           },
    { comment: 'A.14 tilde escape (~0 ~1)',       doc: { '/': 9, '~1': 10 },                                                  expected: { '/': 9, '~1': 10 }, patch: [{ op: 'test', path: '/~01', value: 10 }]                                           },
    { comment: 'A.16 add array via /-',           doc: { foo: ['bar'] },                                                      expected: { foo: ['bar', ['abc', 'def']] }, patch: [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }]                               },
    { comment: 'copy from nested path',           doc: { bar: 1, baz: [{ qux: 'hello' }] },                                   expected: { bar: 1, baz: [{ qux: 'hello' }], boo: { qux: 'hello' } }, patch: [{ from: '/baz/0', op: 'copy', path: '/boo' }]                                      },
    { comment: 'replace whole document',          doc: { foo: 'bar' },                                                        expected: { baz: 'qux' }, patch: [{ op: 'replace', path: '', value: { baz: 'qux' } }]                                },
    { comment: 'copy then mutate destination',    doc: { foo: { bar: { baz: [{ boo: 'net' }] } } },                           expected: { bak: { bar: { baz: [{ boo: 'qux' }] } }, foo: { bar: { baz: [{ boo: 'net' }] } } }, patch: [{ from: '/foo', op: 'copy', path: '/bak' }, { op: 'replace', path: '/bak/bar/baz/0/boo', value: 'qux' }] },
    { comment: 'JSON Pointer special chars',      doc: { '': 0, 'a/b': 1, foo: ['bar', 'baz'], 'm~n': 8 },                   expected: { '': 0, 'a/b': 1, foo: ['bar', 'baz'], 'm~n': 8 }, patch: [{ op: 'test', path: '/foo/0', value: 'bar' }, { op: 'test', path: '/', value: 0 }, { op: 'test', path: '/a~1b', value: 1 }, { op: 'test', path: '/m~0n', value: 8 }] },
] as const;

// --- [ORACLE] ----------------------------------------------------------------

it.effect('P11: RFC 6902 vectors', () =>
    Effect.forEach(RFC6902_VECTORS, (vector) =>
        Diff.apply(vector.doc as Record<string, unknown>, { ops: [...vector.patch] }).pipe(
            Effect.tap((result) => { expect(result, vector.comment).toEqual(vector.expected); }),
            Effect.asVoid,
        ),
    ).pipe(Effect.asVoid));
