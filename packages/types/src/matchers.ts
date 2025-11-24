// --- Type Definitions --------------------------------------------------------

type TagMatcher<T extends { readonly _tag: string }> = <R>(
    cases: {
        [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => R;
    },
) => (value: T) => R;

// --- Core Tag Matcher --------------------------------------------------------

export const createTagMatcher =
    <T extends { readonly _tag: string }>(): TagMatcher<T> =>
    <R>(cases: { [K in T['_tag']]: (value: Extract<T, { _tag: K }>) => R }): ((value: T) => R) =>
    (value: T) => {
        const handler = cases[value._tag as T['_tag']];
        return handler(value as Extract<T, { _tag: typeof value._tag }>);
    };
