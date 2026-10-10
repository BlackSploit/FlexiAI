"""Agent-worker control plane (§7.9, §8.14): FastAPI supervisor, one agent process per call.

Imports FastAPI and Redis, never vision_agents (the supervisor stays light).
"""
