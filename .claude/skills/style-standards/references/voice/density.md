# [H1][DENSITY]
>**Dictum:** *Visuals compress beyond text capacity.*

<br>

[IMPORTANT] Tabular structures yield 40% average performance gain over unstructured text. Markdown format achieves 60.7% accuracy—16 points ahead of CSV (44.3%).

| [INDEX] | [FORMAT]    | [ACCURACY] | [TOKEN_EFFICIENCY] |
| :-----: | ----------- | :--------: | :----------------: |
|   [1]   | Markdown-KV |   60.7%    |   2.7× baseline    |
|   [2]   | XML         |   56.0%    |   1.8× baseline    |
|   [3]   | JSON        |   52.3%    |   0.85× baseline   |
|   [4]   | CSV         |   44.3%    |   1.0× baseline    |

---
## [1][TABLES]
>**Dictum:** *Tables compress comparisons.*

<br>

**Use When:** Comparing > 2 entities on > 2 dimensions.<br>
**Format:** Align columns. Keep cell content concise.

---
## [2][DIAGRAMS]
>**Dictum:** *Diagrams compress flows.*

<br>

**Use When:** Describing flows > 3 steps or hierarchies > 2 levels.<br>
**Optimization:** Use `graph TD` (Top-Down) for flow. Use `classDiagram` for architecture.<br>
**Context Value:** `1 Diagram ≈ 500 Text Tokens`.
