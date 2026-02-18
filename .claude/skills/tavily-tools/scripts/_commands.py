"""Command implementations for Tavily CLI."""
# LOC: 120

from typing import Any, Final

DEFAULTS: Final[dict[str, Any]] = {
    'topic': 'general',
    'search_depth': 'basic',
    'max_results': 10,
    'extract_depth': 'basic',
    'format': 'markdown',
    'max_depth': 1,
    'max_breadth': 20,
    'limit': 50,
    'model': 'auto',
}


# --- [FUNCTIONS] --------------------------------------------------------------
def _split(value: str) -> list[str]:
    """Split comma-separated string, strip whitespace, filter empty."""
    return [segment.strip() for segment in value.split(',') if segment.strip()] if value else []


# --- [COMMANDS] ---------------------------------------------------------------
def search(opts: dict[str, Any], post_fn) -> dict:
    """Web search with AI-powered results."""
    body: dict[str, Any] = {
        'query': opts['query'],
        'topic': opts.get('topic') or DEFAULTS['topic'],
        'search_depth': opts.get('search_depth') or DEFAULTS['search_depth'],
        'max_results': opts.get('max_results') or DEFAULTS['max_results'],
        'include_images': opts.get('include_images', False),
        'include_image_descriptions': opts.get('include_image_descriptions', False),
        'include_raw_content': opts.get('include_raw_content', False),
        'include_favicon': opts.get('include_favicon', False),
        **({'include_domains': _split(opts['include_domains'])} if opts.get('include_domains') else {}),
        **({'exclude_domains': _split(opts['exclude_domains'])} if opts.get('exclude_domains') else {}),
        **{key: opts[key] for key in ('time_range', 'days', 'country', 'start_date', 'end_date') if opts.get(key)},
    }
    response = post_fn('/search', body)
    return {
        'status': 'success',
        'query': opts['query'],
        'results': response.get('results', []),
        'images': response.get('images', []),
        'answer': response.get('answer', ''),
    }


def extract(opts: dict[str, Any], post_fn) -> dict:
    """Extract content from URLs."""
    url_list = _split(opts['urls'])
    body = {
        'urls': url_list,
        'extract_depth': opts.get('extract_depth') or DEFAULTS['extract_depth'],
        'format': opts.get('format') or DEFAULTS['format'],
        'include_images': opts.get('include_images', False),
        'include_favicon': opts.get('include_favicon', False),
    }
    response = post_fn('/extract', body)
    return {
        'status': 'success',
        'urls': url_list,
        'results': response.get('results', []),
        'failed': response.get('failed_results', []),
    }


def crawl(opts: dict[str, Any], post_fn) -> dict:
    """Crawl website from base URL."""
    body: dict[str, Any] = {
        'url': opts['url'],
        'max_depth': opts.get('max_depth') or DEFAULTS['max_depth'],
        'max_breadth': opts.get('max_breadth') or DEFAULTS['max_breadth'],
        'limit': opts.get('limit') or DEFAULTS['limit'],
        'extract_depth': opts.get('extract_depth') or DEFAULTS['extract_depth'],
        'format': opts.get('format') or DEFAULTS['format'],
        'allow_external': opts.get('allow_external', False),
        'include_favicon': opts.get('include_favicon', False),
        **({'select_paths': _split(opts['select_paths'])} if opts.get('select_paths') else {}),
        **({'select_domains': _split(opts['select_domains'])} if opts.get('select_domains') else {}),
        **({'instructions': opts['instructions']} if opts.get('instructions') else {}),
    }
    response = post_fn('/crawl', body)
    results = response.get('results', [])
    return {'status': 'success', 'base_url': opts['url'], 'results': results, 'urls_crawled': len(results)}


def map_site(opts: dict[str, Any], post_fn) -> dict:
    """Map website structure."""
    body: dict[str, Any] = {
        'url': opts['url'],
        'max_depth': opts.get('max_depth') or DEFAULTS['max_depth'],
        'max_breadth': opts.get('max_breadth') or DEFAULTS['max_breadth'],
        'limit': opts.get('limit') or DEFAULTS['limit'],
        'allow_external': opts.get('allow_external', False),
        **({'select_paths': _split(opts['select_paths'])} if opts.get('select_paths') else {}),
        **({'select_domains': _split(opts['select_domains'])} if opts.get('select_domains') else {}),
        **({'instructions': opts['instructions']} if opts.get('instructions') else {}),
    }
    response = post_fn('/map', body)
    urls = response.get('urls', [])
    return {'status': 'success', 'base_url': opts['url'], 'urls': urls, 'total_mapped': len(urls)}


def research(opts: dict[str, Any], post_fn) -> dict:
    """Multi-step deep research with structured report."""
    body: dict[str, Any] = {
        'query': opts['query'],
        'model': opts.get('model') or DEFAULTS['model'],
    }
    response = post_fn('/research', body, timeout=300)
    return {
        'status': 'success',
        'query': opts['query'],
        'report': response.get('report', response.get('content', '')),
        'sources': response.get('sources', []),
    }
