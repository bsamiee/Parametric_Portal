from collections.abc import Callable, Iterable
from dataclasses import dataclass
from heapq import merge as heap_merge
from itertools import groupby
from operator import attrgetter
from statistics import fmean
from typing import Literal

from expression import Error, Ok, Result, pipe
from expression.collections import Map, seq

type Zone = Literal["north", "south", "east"]
ZONES: tuple[Zone, ...] = ("north", "south", "east")
type Blackout = tuple[int, tuple[Zone, ...]]
type Fused = tuple[float, int, tuple[Zone, ...]]

@dataclass(frozen=True, slots=True)
class Reading:
    epoch: int; zone: Zone; load: float

def fuse(epoch: int, cov: Map[Zone, float]) -> Result[Fused, Blackout]:
    gaps = tuple(z for z in ZONES if z not in cov)
    return Ok((fmean(vs), len(ZONES) - len(gaps), gaps)) if (vs := tuple(pipe(ZONES, seq.choose(cov.try_find)))) else Error((epoch, gaps))

def align[K, S, V, W, R](
    *feeds: Iterable[V],
    key: Callable[[V], K],
    entry: Callable[[V], tuple[S, W]],
    reducer: Callable[[K, Map[S, W]], R],
) -> Iterable[tuple[K, R]]:
    return ((k, reducer(k, Map.of_seq(entry(v) for v in grp))) for k, grp in groupby(heap_merge(*feeds, key=key), key=key))

def monitor(*feeds: Iterable[Reading]) -> Iterable[tuple[int, Result[Fused, Blackout]]]:
    return align(*feeds, key=attrgetter("epoch"), entry=attrgetter("zone", "load"), reducer=fuse)