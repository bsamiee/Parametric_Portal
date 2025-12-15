# [REF][EXPRESSIONS]
>**Dictum:** *Dynamic evaluation eliminates hardcoded parameters.*

<br>

---
## [1][SYNTAX]
>**Dictum:** *Prefix determines evaluation mode.*

<br>

| [INDEX] | [TYPE]  | [FORMAT]   | [EXAMPLE]                   |
| :-----: | ------- | ---------- | --------------------------- |
|   [1]   | Static  | No prefix  | `"https://api.example.com"` |
|   [2]   | Dynamic | `=` prefix | `"={{ $json.field }}"`      |

Delimiter: `{{ }}` brackets (Tournament templating)

---
## [2][VARIABLES]
>**Dictum:** *Variables expose workflow context.*


<br>

| [INDEX] | [VARIABLE]      | [DESCRIPTION]                                |
| :-----: | --------------- | -------------------------------------------- |
|   [1]   | `$json`         | Current item JSON                            |
|   [2]   | `$input`        | Input data (`.all()`, `.first()`, `.last()`) |
|   [3]   | `$('NodeName')` | Node reference (`.item.json.field`)          |
|   [4]   | `$workflow`     | Workflow metadata (`.id`, `.name`)           |
|   [5]   | `$execution`    | Execution context (`.id`, `.mode`)           |
|   [6]   | `$env`          | Environment variables                        |
|   [7]   | `$vars`         | Custom n8n variables                         |
|   [8]   | `$now`          | Luxon DateTime                               |
|   [9]   | `$itemIndex`    | Current item index (0-based)                 |
|  [10]   | `$prevNode`     | Previous node data                           |
|  [11]   | `$items()`      | All items from node                          |
|  [12]   | `$parameter`    | Node parameter value                         |

---
## [3][FUNCTIONS]
>**Dictum:** *Functions transform data inline.*

<br>

```javascript
// JMESPath query
{{ $jmespath($json, 'users[*].name') }}

// Luxon date
{{ $now.plus({days: 7}).toFormat('yyyy-MM-dd') }}

// Ternary conditional
{{ $json.status === 'error' ? 'Failed' : 'Success' }}

// IIFE for complex logic
{{(function() {
  return $json.items.reduce((sum, i) => sum + i.price, 0);
})()}}
```

---
## [4][PINNED_DATA_ACCESS]
>**Dictum:** *Pinned data lacks execution context.*

<br>

```javascript
// Standard access (fails with pinned data)
$('NodeName').item.json.field

// Pinned data access (required syntax)
$('NodeName').first().json.field
$('NodeName').last().json.field
$('NodeName').all()[0].json.field
```

`.item` fails on pinned data due to missing execution context.
