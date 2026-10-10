"""Stream edge without the Stream Chat side effect (§8.13).

Vision Agents' StreamEdge.create_conversation() creates Chat channel `messaging:{callId}` and
`agent.say()` then writes every utterance into it, which would store agent text at Stream
(§1.4 #2). We return an in-memory conversation instead: same interface, nothing leaves the process.
"""

from vision_agents.core.agents.conversation import InMemoryConversation
from vision_agents.plugins.getstream import Edge as StreamEdge


class NoChatEdge(StreamEdge):
    async def create_conversation(self, call, user, instructions):
        self.conversation = InMemoryConversation(instructions, [])
        return self.conversation
