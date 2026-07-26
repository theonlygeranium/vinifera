# Architecture — [PROJECT NAME]

**Last updated:** YYYY-MM-DD
**Maintainer:** Any agent (must reflect actual Schubert state)

---

## System Overview

<!-- TODO: Replace with a description of the actual system architecture -->

```
[Client] → [Reverse Proxy: Caddy] → [Application] → [Database]
```

---

## Components

| Component | Technology | Schubert Path | Port |
|-----------|-----------|---------------|------|
| <!-- e.g. Frontend --> | <!-- e.g. Next.js 15 --> | `/opt/[REPO-NAME]/frontend` | `3000` |
| <!-- e.g. Backend --> | <!-- e.g. FastAPI --> | `/opt/[REPO-NAME]/backend` | `8000` |

---

## External Dependencies

| Service | Purpose | Notes |
|---------|---------|-------|
| LiteLLM (local) | LLM routing | `http://localhost:4000` — shared across all Schubert projects |
| Ollama (local) | Model serving | `http://localhost:11434` — never call directly, use LiteLLM |
| Caddy | Reverse proxy | Managed globally — do not modify without authorization |

---

## Data Flow

<!-- TODO: Describe the primary data flow through the system -->

---

## Environment Variables

See `.env.example` for the full list of required variables.

---

## Known Constraints and Limitations

<!-- Document any architectural constraints, technical debt, or limitations -->
