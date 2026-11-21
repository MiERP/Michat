# Dependency exceptions

`pnpm audit --prod --audit-level=high` is the release gate. Low-severity
advisories that remain are tracked here with a review date.

| Package | Advisory | Severity | Why accepted | Review by |
| ------- | -------- | -------- | ------------ | --------- |
| _none_  | —        | —        | —            | —         |

Resolved on 2026-11-09:

- `@ai-sdk/provider-utils` GHSA-866g-f22w-33x8 (uncontrolled resource
  consumption) — fixed by moving to 3.0.45: `ai` 5.0.286 and
  `@ai-sdk/{openai,openai-compatible,deepseek}` were updated, and a
  `@ai-sdk/provider-utils@<3.0.28` override covers
  `ollama-ai-provider-v2`, which pins 3.0.19 exactly.
- `katex` GHSA-238p-pmpm-9mq7 (prototype pollution can bypass trust
  restrictions) — fixed by the `katex: ^0.19.1` override (0.19.1 installed),
  because `rehype-katex` and `remark-math` still declare `katex ^0.16`.

Both packages now have floors in `scripts/check-dependency-floor.cjs`
(`3.0.28` and `0.18.2`), so a future lockfile regression fails
`pnpm check:deps`. Re-run `pnpm audit --prod` when either package, or the
provider packages that pull them in, is upgraded — the overrides must stay in
place until those dependencies declare the patched range themselves. New high
or critical advisories must be fixed or added here with an explicit
reachability argument before release.
