"""Templated live cues and the rule-based post-set note (§8.7). Every id is a pre-rendered clip."""

import re

from . import phrases
from .scoring import SetMetrics

DEPTH_CUE_MARGIN = 8   # a rep more than this many degrees short of target gets a depth cue

_SENTENCE_END = re.compile(r"[.!?।]+(?=\s|$)")


def split_sentences(text: str) -> list[str]:
    """Split on . ! ? । followed by whitespace or the end, ignoring empty fragments.

    A full stop inside a number ("2.5 seconds") is not a sentence end. Shared with validate_note.
    """
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


def live_cue_ids(rep, target: float, mode: str) -> list[str]:
    ids = [f"count.{rep.n:02d}"]                        # always the count word
    if rep.peak < target - DEPTH_CUE_MARGIN:
        ids.append("cue.bend_more" if mode == "flex" else "cue.raise_more")   # DEV-9
    elif rep.too_fast:
        ids.append("cue.slow")
    return ids                                          # depth cue wins over tempo (implementation choice)


def next_more_reps(m: SetMetrics) -> int:
    return min(10, m.reps_planned - m.reps_done) if m.reps_done < m.reps_planned else 3


def next_step_id(m: SetMetrics, short: bool) -> str:
    if short or m.fast_reps or m.reps_done < m.reps_planned:
        return f"note.more_reps.{next_more_reps(m)}"          # "Next: do K more reps, slowly."
    return f"note.keep_reps.{m.reps_planned}"                 # "Next time, do N reps the same way, slowly."


def rule_note_ids(m: SetMetrics, mode: str) -> list[str]:
    if m.reps_done == 0:
        return ["note.no_reps"]                               # 2 sentences
    n, t = round(m.avg_peak), int(m.target)
    achieved = f"note.achieved_{'bend' if mode == 'flex' else 'raise'}.{n}"
    short = m.avg_peak < m.target - DEPTH_CUE_MARGIN
    if short:
        ids = ["note.good_effort", achieved, f"note.target.{t}"]            # sentence 1 (clauses)
    elif m.avg_peak < m.target:
        ids = ["note.well_done", achieved, f"note.target.{t}"]              # near target
    else:
        ids = ["note.well_done", achieved, f"note.target_reached.{t}"]      # target reached
    if m.fast_reps:
        ids.append("note.too_fast")                                         # sentence 2 (only if too fast)
    ids.append(next_step_id(m, short))                                      # last sentence: one concrete step
    return ids


def render_note(ids: list[str]) -> dict[str, str]:
    """Join the clips' text. The punctuation lives in the phrases."""
    ps = [phrases.get(i) for i in ids]
    return {"ml": " ".join(p.ml for p in ps), "en": " ".join(p.en for p in ps)}


def rule_note(m: SetMetrics, mode: str) -> dict[str, str]:
    return render_note(rule_note_ids(m, mode))
