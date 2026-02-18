# ruff: noqa: ARG005
"""GraphQL dispatch handlers for GitHub CLI discussion workflows."""

import json
from collections.abc import Callable
from typing import Any, Final

type Handler = tuple[Callable[[dict], tuple[str, ...]], Callable[[str, dict], dict]]


def _json(output: str) -> Any:
    """Parse JSON output, returning empty dict for empty strings."""
    return json.loads(output) if output else {}


def _repo_vars() -> tuple[str, ...]:
    """Get GraphQL owner/repo vars for current repo."""
    from gh import run_command

    ok, out = run_command(('gh', 'repo', 'view', '--json=owner,name'))
    data = _json(out) if ok else {}
    return ('-f', f'owner={data.get("owner", {}).get("login", "")}', '-f', f'repo={data.get("name", "")}')


def _repo_id() -> str:
    """Get repository node ID."""
    from gh import run_command

    ok, out = run_command(('gh', 'repo', 'view', '--json=id'))
    return _json(out).get('id', '') if ok else ''


DISCUSSION_LIST_QUERY: Final = (
    'query=query($owner:String!,$repo:String!,$limit:Int!)'
    '{repository(owner:$owner,name:$repo)'
    '{discussions(first:$limit)'
    '{nodes{number title author{login}category{name}createdAt isAnswered}}}}'
)
DISCUSSION_VIEW_QUERY: Final = (
    'query=query($owner:String!,$repo:String!,$num:Int!)'
    '{repository(owner:$owner,name:$repo)'
    '{discussion(number:$num)'
    '{id number title body author{login}category{name}createdAt '
    'answer{body author{login}}comments(first:50){nodes{id body author{login}}}}}}'
)
DISCUSSION_CATEGORY_LIST_QUERY: Final = (
    'query=query($owner:String!,$repo:String!)'
    '{repository(owner:$owner,name:$repo)'
    '{discussionCategories(first:25){nodes{id name emoji description isAnswerable}}}}'
)
DISCUSSION_CREATE_MUTATION: Final = (
    'query=mutation($repoId:ID!,$catId:ID!,$title:String!,$body:String!)'
    '{createDiscussion(input:{repositoryId:$repoId,categoryId:$catId,title:$title,body:$body})'
    '{discussion{id number url}}}'
)


GRAPHQL_CMDS: Final[dict[str, tuple[tuple[str, ...], tuple[str, ...], Handler]]] = {
    # --- Discussions (GraphQL) ---
    'discussion-list': (
        (),
        ('limit',),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                DISCUSSION_LIST_QUERY,
                *_repo_vars(),
                '-F',
                f'limit={a.get("limit", "30")}',
            ),
            lambda o, a: {
                'discussions': _json(o).get('data', {}).get('repository', {}).get('discussions', {}).get('nodes', [])
            },
        ),
    ),
    'discussion-view': (
        ('number',),
        (),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                DISCUSSION_VIEW_QUERY,
                *_repo_vars(),
                '-F',
                f'num={a["number"]}',
            ),
            lambda o, a: {
                'number': a['number'],
                'discussion': _json(o).get('data', {}).get('repository', {}).get('discussion', {}),
            },
        ),
    ),
    'discussion-category-list': (
        (),
        (),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                DISCUSSION_CATEGORY_LIST_QUERY,
                *_repo_vars(),
            ),
            lambda o, a: {
                'categories': _json(o)
                .get('data', {})
                .get('repository', {})
                .get('discussionCategories', {})
                .get('nodes', [])
            },
        ),
    ),
    'discussion-create': (
        ('category_id', 'title', 'body'),
        (),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                DISCUSSION_CREATE_MUTATION,
                '-f',
                f'repoId={_repo_id()}',
                '-f',
                f'catId={a["category_id"]}',
                '-f',
                f'title={a["title"]}',
                '-f',
                f'body={a["body"]}',
            ),
            lambda o, a: {'created': _json(o).get('data', {}).get('createDiscussion', {}).get('discussion', {})},
        ),
    ),
    'discussion-comment': (
        ('discussion_id', 'body'),
        ('reply_to',),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                (
                    'query=mutation($id:ID!,$body:String!,$replyToId:ID!){addDiscussionComment(input:{discussionId:$id,body:$body,replyToId:$replyToId}){comment{id}}}'
                    if a.get('reply_to')
                    else 'query=mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{id}}}'
                ),
                '-f',
                f'id={a["discussion_id"]}',
                '-f',
                f'body={a["body"]}',
                *(('-f', f'replyToId={a["reply_to"]}') if a.get('reply_to') else ()),
            ),
            lambda o, a: {'discussion_id': a['discussion_id'], 'commented': True},
        ),
    ),
    'discussion-close': (
        ('discussion_id',),
        ('reason',),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                (
                    'query=mutation($id:ID!,$reason:DiscussionCloseReason){closeDiscussion(input:{discussionId:$id,reason:$reason}){discussion{id}}}'
                    if a.get('reason')
                    else 'query=mutation($id:ID!){closeDiscussion(input:{discussionId:$id}){discussion{id}}}'
                ),
                '-f',
                f'id={a["discussion_id"]}',
                *(('-f', f'reason={a["reason"]}') if a.get('reason') else ()),
            ),
            lambda o, a: {'discussion_id': a['discussion_id'], 'closed': True, 'reason': a.get('reason')},
        ),
    ),
    'discussion-delete': (
        ('discussion_id',),
        (),
        (
            lambda a: (
                'gh',
                'api',
                'graphql',
                '-f',
                'query=mutation($id:ID!){deleteDiscussion(input:{id:$id}){discussion{id}}}',
                '-f',
                f'id={a["discussion_id"]}',
            ),
            lambda o, a: {'discussion_id': a['discussion_id'], 'deleted': True},
        ),
    ),
}
