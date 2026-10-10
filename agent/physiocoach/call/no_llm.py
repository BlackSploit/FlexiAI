"""`llm=` is mandatory on Agent; PhysioCoach never generates speech with it (§1.4 #5, #6)."""

from typing import AsyncIterator, Optional

from vision_agents.core.edge.types import Participant
from vision_agents.core.llm.llm import LLM, LLMResponseDelta, LLMResponseFinal


class NoLLM(LLM):
    """Deterministic coach: rule cues and notes come from code, the LLM note from core/note_llm.py."""

    async def simple_response(
        self, text: str, participant: Optional[Participant] = None
    ) -> AsyncIterator[LLMResponseDelta | LLMResponseFinal]:
        return
        yield  # an async generator that yields nothing
