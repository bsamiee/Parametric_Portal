# [H1][CONSTRAINTS]
>**Dictum:** *Quantity thresholds bound comprehension.*

<br>

[CRITICAL] Performance degrades from 77.67% (Level I) to 32.96% (Level IV) as constraint nesting increases.

---
## [1][DENSITY]
>**Dictum:** *Density bounds cognitive load.*

<br>

[IMPORTANT]:
1.  [ALWAYS] **Limit Per Level:** Maximum 3-5 constraints per instruction level.
2.  [ALWAYS] **Hierarchical Ordering:** PRIMARY → SECONDARY → TERTIARY.
3.  [ALWAYS] **Decomposition:** Break complex requirements into sequential simple steps.

[CRITICAL]:
- [NEVER] **Constraint Saturation:** Simultaneous 6+ constraints cause <25% satisfaction.

---
## [2][FEW_SHOT]
>**Dictum:** *Quality outweighs quantity.*

<br>

[IMPORTANT] Few-shot performance peaks at 5-25 examples. Hundreds cause functional correctness collapse.

[IMPORTANT]:
1.  [ALWAYS] **Selection Over Quantity:** Distinctive examples (TF-IDF: term frequency × inverse document frequency) reduce count by 60%.
2.  [ALWAYS] **Diversity:** 2-3 high-quality examples > 10 mediocre examples.

[CRITICAL]:
- [NEVER] **Many-Shot:** 100+ examples cause functional correctness collapse.
