"""Vision Agents integration: the only package (with agent_main) that imports vision_agents / getstream.

Do not use `from __future__ import annotations` here: Vision Agents routes event handlers by their
resolved type hints (§8.1).
"""
