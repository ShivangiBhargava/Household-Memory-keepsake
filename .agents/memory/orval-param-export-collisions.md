---
name: Orval parameter export collisions
description: A generated TypeScript collision that can occur when one operation combines path and query parameters.
---

When an OpenAPI operation combines path and query parameters, inspect Orval's generated exports for duplicate `*Params` names before treating codegen as complete.

**Why:** Orval can emit the same parameter type from both its generated Zod API file and generated TypeScript types barrel, causing TS2308.

**How to apply:** If the generated names collide, reshape the contract (for example, use a body or a separate operation) and rerun codegen plus the workspace typecheck.
