# Dependency exceptions

`pnpm audit --prod --audit-level=high` is the release gate. Low-severity
advisories that remain are tracked here with a review date.

| Package | Advisory | Severity | Why accepted | Review by |
| --- | --- | --- | --- | --- |
| `@ai-sdk/provider-utils` | GHSA-866g-f22w-33x8 (uncontrolled resource consumption) | Low | Only used by local model plumbing; no untrusted remote payload path is exposed. | 2026-12-09 |
| `katex` | GHSA-238p-pmpm-9mq7 (prototype pollution can bypass trust restrictions) | Low | MiChat renders KaTeX with `trust` disabled and sanitizes pasted HTML. | 2026-12-09 |

Re-run `pnpm audit --prod` when either package is upgraded. New high or
critical advisories must be fixed or added here with an explicit reachability
argument before release.
