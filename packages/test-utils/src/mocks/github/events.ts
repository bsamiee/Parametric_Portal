/**
 * GitHub webhook event factories: type-safe payload generators for workflow testing.
 * Field names use snake_case to match GitHub API schema (required for payload compatibility).
 */

// biome-ignore-all lint/style/useNamingConvention: GitHub API uses snake_case field names

// --- [TYPES] -----------------------------------------------------------------

type EventAction =
    | 'issue_comment.created'
    | 'pull_request_review.submitted'
    | 'pull_request_review_comment.created'
    | 'pull_request_target.opened'
    | 'pull_request_target.ready_for_review';

type User = {
    readonly id: number;
    readonly login: string;
    readonly type: 'Bot' | 'User';
};

type Repository = {
    readonly full_name: string;
    readonly id: number;
    readonly name: string;
    readonly owner: User;
};

type IssueCommentPayload = {
    readonly action: 'created';
    readonly comment: {
        readonly author_association: string;
        readonly body: string;
        readonly id: number;
        readonly user: User;
    };
    readonly issue: {
        readonly number: number;
        readonly pull_request?: { readonly url: string };
        readonly title: string;
    };
    readonly repository: Repository;
    readonly sender: User;
};

type PullRequestReviewPayload = {
    readonly action: 'submitted';
    readonly pull_request: {
        readonly draft: boolean;
        readonly head: { readonly ref: string; readonly repo: Repository; readonly sha: string };
        readonly number: number;
        readonly title: string;
    };
    readonly repository: Repository;
    readonly review: {
        readonly author_association: string;
        readonly body: string;
        readonly id: number;
        readonly state: 'approved' | 'changes_requested' | 'commented';
        readonly user: User;
    };
    readonly sender: User;
};

type PullRequestReviewCommentPayload = {
    readonly action: 'created';
    readonly comment: {
        readonly author_association: string;
        readonly body: string;
        readonly diff_hunk: string;
        readonly id: number;
        readonly path: string;
        readonly user: User;
    };
    readonly pull_request: {
        readonly draft: boolean;
        readonly head: { readonly ref: string; readonly repo: Repository; readonly sha: string };
        readonly number: number;
        readonly title: string;
    };
    readonly repository: Repository;
    readonly sender: User;
};

type PullRequestTargetPayload = {
    readonly action: 'opened' | 'ready_for_review';
    readonly pull_request: {
        readonly draft: boolean;
        readonly head: { readonly ref: string; readonly repo: Repository; readonly sha: string };
        readonly number: number;
        readonly title: string;
    };
    readonly repository: Repository;
    readonly sender: User;
};

type EventPayload =
    | IssueCommentPayload
    | PullRequestReviewCommentPayload
    | PullRequestReviewPayload
    | PullRequestTargetPayload;

type FactoryOptions = {
    readonly body?: string;
    readonly login?: string;
    readonly number?: number;
    readonly repo?: string;
};

// --- [CONSTANTS] -------------------------------------------------------------

const B = Object.freeze({
    defaults: {
        author_association: 'MEMBER',
        body: 'Test comment body',
        login: 'test-user',
        number: 1,
        repo: 'owner/repo',
        sha: 'abc123def456',
    },
    repository: (fullName: string): Repository => {
        const parts = fullName.split('/');
        const owner = parts[0] ?? 'owner';
        const name = parts[1] ?? 'repo';
        return { full_name: fullName, id: 1, name, owner: B.user(owner) };
    },
    user: (login: string): User => ({ id: 1, login, type: 'User' }),
} as const);

// --- [DISPATCH_TABLES] -------------------------------------------------------

const factories = {
    'issue_comment.created': (opts: FactoryOptions): IssueCommentPayload => ({
        action: 'created',
        comment: {
            author_association: B.defaults.author_association,
            body: opts.body ?? B.defaults.body,
            id: 1,
            user: B.user(opts.login ?? B.defaults.login),
        },
        issue: {
            number: opts.number ?? B.defaults.number,
            pull_request: {
                url: `https://api.github.com/repos/${opts.repo ?? B.defaults.repo}/pulls/${opts.number ?? B.defaults.number}`,
            },
            title: 'Test PR',
        },
        repository: B.repository(opts.repo ?? B.defaults.repo),
        sender: B.user(opts.login ?? B.defaults.login),
    }),

    'pull_request_review_comment.created': (opts: FactoryOptions): PullRequestReviewCommentPayload => ({
        action: 'created',
        comment: {
            author_association: B.defaults.author_association,
            body: opts.body ?? B.defaults.body,
            diff_hunk: '@@ -1,3 +1,4 @@',
            id: 1,
            path: 'src/index.ts',
            user: B.user(opts.login ?? B.defaults.login),
        },
        pull_request: {
            draft: false,
            head: {
                ref: 'feature-branch',
                repo: B.repository(opts.repo ?? B.defaults.repo),
                sha: B.defaults.sha,
            },
            number: opts.number ?? B.defaults.number,
            title: 'Test PR',
        },
        repository: B.repository(opts.repo ?? B.defaults.repo),
        sender: B.user(opts.login ?? B.defaults.login),
    }),

    'pull_request_review.submitted': (opts: FactoryOptions): PullRequestReviewPayload => ({
        action: 'submitted',
        pull_request: {
            draft: false,
            head: {
                ref: 'feature-branch',
                repo: B.repository(opts.repo ?? B.defaults.repo),
                sha: B.defaults.sha,
            },
            number: opts.number ?? B.defaults.number,
            title: 'Test PR',
        },
        repository: B.repository(opts.repo ?? B.defaults.repo),
        review: {
            author_association: B.defaults.author_association,
            body: opts.body ?? B.defaults.body,
            id: 1,
            state: 'commented',
            user: B.user(opts.login ?? B.defaults.login),
        },
        sender: B.user(opts.login ?? B.defaults.login),
    }),

    'pull_request_target.opened': (opts: FactoryOptions): PullRequestTargetPayload => ({
        action: 'opened',
        pull_request: {
            draft: false,
            head: {
                ref: 'feature-branch',
                repo: B.repository(opts.repo ?? B.defaults.repo),
                sha: B.defaults.sha,
            },
            number: opts.number ?? B.defaults.number,
            title: 'Test PR',
        },
        repository: B.repository(opts.repo ?? B.defaults.repo),
        sender: B.user(opts.login ?? B.defaults.login),
    }),

    'pull_request_target.ready_for_review': (opts: FactoryOptions): PullRequestTargetPayload => ({
        action: 'ready_for_review',
        pull_request: {
            draft: false,
            head: {
                ref: 'feature-branch',
                repo: B.repository(opts.repo ?? B.defaults.repo),
                sha: B.defaults.sha,
            },
            number: opts.number ?? B.defaults.number,
            title: 'Test PR',
        },
        repository: B.repository(opts.repo ?? B.defaults.repo),
        sender: B.user(opts.login ?? B.defaults.login),
    }),
} as const satisfies Record<EventAction, (opts: FactoryOptions) => EventPayload>;

// --- [PURE_FUNCTIONS] --------------------------------------------------------

const GitHubEvents = Object.freeze({
    claudeTrigger: (opts: FactoryOptions = {}) =>
        GitHubEvents.create('issue_comment.created', { body: '@claude please help', ...opts }),
    create: <T extends EventAction>(event: T, opts: FactoryOptions = {}): ReturnType<(typeof factories)[T]> =>
        factories[event](opts) as ReturnType<(typeof factories)[T]>,

    geminiTrigger: (opts: FactoryOptions = {}) =>
        GitHubEvents.create('issue_comment.created', { body: '@gemini please review', ...opts }),

    prOpened: (opts: FactoryOptions = {}) => GitHubEvents.create('pull_request_target.opened', opts),

    prReview: (opts: FactoryOptions = {}) => GitHubEvents.create('pull_request_review.submitted', opts),

    toFile: (payload: EventPayload, path: string): string => {
        const content = GitHubEvents.toJSON(payload);
        return `// Generated event payload for: ${path}\n${content}`;
    },

    toJSON: (payload: EventPayload): string => JSON.stringify(payload, null, 2),
});

// --- [EXPORT] ----------------------------------------------------------------

export { B as GITHUB_EVENTS_TUNING, GitHubEvents };
export type {
    EventAction,
    EventPayload,
    FactoryOptions,
    IssueCommentPayload,
    PullRequestReviewCommentPayload,
    PullRequestReviewPayload,
    PullRequestTargetPayload,
};
