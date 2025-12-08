---
name: tavily-tools
type: complex
depth: base
description: >-
  Executes Tavily AI web operations via unified Python CLI. Use when searching
  the web with AI-powered results, extracting content from URLs, crawling
  websites for structured data, or mapping site structure and discovering URLs.
---

# [H1][TAVILY-TOOLS]
>**Dictum:** *Single polymorphic script replaces MCP tools.*

<br>

Execute Tavily AI queries via unified Python CLI. Zero MCP tokens loaded.

---
## [1][COMMANDS]
>**Dictum:** *Dispatch table routes all commands.*

<br>

| [CMD]    | [MCP_EQUIVALENT]              | [ARGS]                                                              |
| -------- | ----------------------------- | ------------------------------------------------------------------- |
| search   | `mcp__tavily__tavily-search`  | `--query` `--topic` `--search-depth` `--max-results` `--time-range` |
| extract  | `mcp__tavily__tavily-extract` | `--urls` `--extract-depth` `--format` `--include-images`            |
| crawl    | `mcp__tavily__tavily-crawl`   | `--url` `--max-depth` `--max-breadth` `--limit` `--instructions`    |
| map_site | `mcp__tavily__tavily-map`     | `--url` `--max-depth` `--max-breadth` `--limit` `--instructions`    |

---
## [2][USAGE]
>**Dictum:** *Single script, polymorphic dispatch.*

<br>

```bash
# Web search with AI
uv run .claude/skills/tavily-tools/scripts/tavily.py search --query "React 19 features" --max-results 5
uv run .claude/skills/tavily-tools/scripts/tavily.py search --query "Nx 22 release" --topic news --time-range week

# Advanced search with filters
uv run .claude/skills/tavily-tools/scripts/tavily.py search --query "Effect-TS patterns" --search-depth advanced --include-images
uv run .claude/skills/tavily-tools/scripts/tavily.py search --query "TypeScript 6" --include-domains "github.com,dev.to"

# Extract content from URLs
uv run .claude/skills/tavily-tools/scripts/tavily.py extract --urls "https://example.com,https://docs.example.com"
uv run .claude/skills/tavily-tools/scripts/tavily.py extract --urls "https://linkedin.com/in/user" --extract-depth advanced

# Crawl website
uv run .claude/skills/tavily-tools/scripts/tavily.py crawl --url "https://docs.example.com" --max-depth 2 --limit 20
uv run .claude/skills/tavily-tools/scripts/tavily.py crawl --url "https://api.example.com" --instructions "Find API endpoints"

# Map site structure
uv run .claude/skills/tavily-tools/scripts/tavily.py map_site --url "https://example.com" --max-depth 3
uv run .claude/skills/tavily-tools/scripts/tavily.py map_site --url "https://docs.site.com" --select-paths "/api/.*,/guides/.*"
```

[IMPORTANT] API key auto-injected via 1Password at shell startup. Manual export not required.

---
## [3][OUTPUT]
>**Dictum:** *JSON output for Claude parsing.*

<br>

All commands output JSON: `{"status": "success|error", ...}`.

**Response Fields:**
- `search` — `{query: string, results: object[], images: object[], answer: string}`
- `extract` — `{urls: string[], results: object[], failed: object[]}`
- `crawl` — `{base_url: string, results: object[], urls_crawled: int}`
- `map_site` — `{base_url: string, urls: string[], total_mapped: int}`

---
## [4][ARGUMENTS]
>**Dictum:** *Complete argument reference.*

<br>

### [4.1][SEARCH]
| [ARG]                          | [TYPE] | [DEFAULT]  | [DESCRIPTION]                   |
| ------------------------------ | ------ | ---------- | ------------------------------- |
| `--query`                      | string | (required) | Search query                    |
| `--topic`                      | enum   | `general`  | `general` or `news`             |
| `--search-depth`               | enum   | `basic`    | `basic` or `advanced`           |
| `--max-results`                | int    | `10`       | Maximum results (5-20)          |
| `--time-range`                 | enum   | (none)     | `day`, `week`, `month`, `year`  |
| `--days`                       | int    | (none)     | Days back (news only)           |
| `--include-domains`            | string | (none)     | Comma-separated allowed domains |
| `--exclude-domains`            | string | (none)     | Comma-separated blocked domains |
| `--include-images`             | flag   | false      | Include images in response      |
| `--include-image-descriptions` | flag   | false      | Include image descriptions      |
| `--include-raw-content`        | flag   | false      | Include parsed HTML content     |
| `--include-favicon`            | flag   | false      | Include favicon URLs            |
| `--country`                    | string | (none)     | Boost results from country      |
| `--start-date`                 | string | (none)     | Filter after date (YYYY-MM-DD)  |
| `--end-date`                   | string | (none)     | Filter before date (YYYY-MM-DD) |

### [4.2][EXTRACT]
| [ARG]               | [TYPE] | [DEFAULT]  | [DESCRIPTION]                    |
| ------------------- | ------ | ---------- | -------------------------------- |
| `--urls`            | string | (required) | Comma-separated URLs to extract  |
| `--extract-depth`   | enum   | `basic`    | `basic` or `advanced` (LinkedIn) |
| `--format`          | enum   | `markdown` | `markdown` or `text`             |
| `--include-images`  | flag   | false      | Include extracted images         |
| `--include-favicon` | flag   | false      | Include favicon URLs             |

### [4.3][CRAWL]
| [ARG]               | [TYPE] | [DEFAULT]  | [DESCRIPTION]                         |
| ------------------- | ------ | ---------- | ------------------------------------- |
| `--url`             | string | (required) | Base URL to start crawl               |
| `--max-depth`       | int    | `1`        | Max crawl depth from base             |
| `--max-breadth`     | int    | `20`       | Max links per page level              |
| `--limit`           | int    | `50`       | Total pages to crawl                  |
| `--instructions`    | string | (none)     | Natural language crawl guidance       |
| `--select-paths`    | string | (none)     | Comma-separated path regex patterns   |
| `--select-domains`  | string | (none)     | Comma-separated domain regex patterns |
| `--allow-external`  | flag   | false      | Include external links in response    |
| `--extract-depth`   | enum   | `basic`    | `basic` or `advanced`                 |
| `--format`          | enum   | `markdown` | `markdown` or `text`                  |
| `--include-favicon` | flag   | false      | Include favicon URLs                  |

### [4.4][MAP_SITE]
| [ARG]              | [TYPE] | [DEFAULT]  | [DESCRIPTION]                         |
| ------------------ | ------ | ---------- | ------------------------------------- |
| `--url`            | string | (required) | Base URL to map                       |
| `--max-depth`      | int    | `1`        | Max mapping depth from base           |
| `--max-breadth`    | int    | `20`       | Max links per page level              |
| `--limit`          | int    | `50`       | Total URLs to discover                |
| `--instructions`   | string | (none)     | Natural language mapping guidance     |
| `--select-paths`   | string | (none)     | Comma-separated path regex patterns   |
| `--select-domains` | string | (none)     | Comma-separated domain regex patterns |
| `--allow-external` | flag   | false      | Include external links in response    |
