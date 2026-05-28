You are opening this repository as a codebase analyst and architecture cartographer.

Your job is to inspect the actual source code and generate a high-trust, deeply detailed architecture memory file for future AI sessions.

This file is the most important artifact in this repository for AI comprehension. Every future AI session will read this file FIRST and use it as the primary navigation map before touching any code. If this file is shallow, vague, or misses critical relationships, every future session will start broken.

You must be careful, evidence-based, and explicit about uncertainty.

PRIMARY OBJECTIVE

Create or update a repository architecture memory document under the `docs` directory.

There are two operating modes:

1. Initial mode
Use this when the repository has no prior system map.
Create:
`docs/system-map.md`

2. Update mode
Use this when a prior system map already exists and the user wants a refreshed map after code changes.
Create:
`docs/system-map-v[number].md`

In update mode, the new file must contain only the meaningful changes relative to the latest prior system map, not a full rewrite of the entire map.

MODE SELECTION RULES

Decide mode as follows:

- If `docs/system-map.md` does not exist and no `docs/system-map-v*.md` files exist, run in Initial mode.
- If `docs/system-map.md` exists or any `docs/system-map-v*.md` files exist, and the user is asking to re-run after repository changes, run in Update mode.
- In Update mode, first locate the latest prior map:
  - Prefer the highest numbered `docs/system-map-v[number].md`
  - If no versioned file exists, use `docs/system-map.md`
- Never overwrite previous map files unless the user explicitly asks for overwrite.
- In Update mode, determine the next version number by taking the highest existing `system-map-v[number].md` and adding 1.
- If no versioned file exists yet, the first update file should be:
  `docs/system-map-v1.md`

GLOBAL REQUIREMENTS

- Read the actual source code, configuration, manifests, and project structure.
- Do not rely only on README or docs. Treat README/docs as supporting context, not source of truth.
- Use evidence from code whenever possible.
- Do not modify application code.
- Only create the required file inside `docs`.
- Do not invent architecture or runtime behavior without code evidence.
- Mark uncertain conclusions explicitly.
- Prefer depth on high-impact areas over shallow coverage of everything.
- Optimize the output for future LLM re-reading, not for prose elegance.
- The document must help a future AI answer:
  - what the system does
  - how it is structured
  - where the entry points are
  - which modules are central
  - what depends on what
  - where to look first for a new task
  - what is risky to change
  - what areas are uncertain or dynamic
  - what specific coupling or sync constraints exist between components
  - what actual bugs or dead code paths exist in the current state

ANALYSIS SCOPE

Inspect enough of the repo to build a trustworthy system understanding. Focus on:

- repository purpose and overall shape
- languages present in the repo
- frameworks, package managers, build tools, test tools, workspace tools
- monorepo/workspace structure if present
- major packages, apps, services, libraries, modules, domains, bounded contexts
- architecture layers and dependency direction
- entry points:
  - app bootstrap
  - server startup
  - CLI entry points
  - worker/job/scheduler entry points
  - main routes/controllers/handlers if relevant
  - window/process creation points if desktop/mobile
- key symbols (both class-level AND critical method-level):
  - important classes
  - important functions and methods that are orchestration points or high-risk routines
  - interfaces and type contracts
  - base abstractions
  - high-impact configuration objects
  - central services/repositories/managers/controllers
- important relationships:
  - imports/exports
  - calls
  - extends/implements
  - instantiates/composes
  - depends on
  - uses external systems/resources
  - event emission and subscription patterns
  - IPC/RPC contract surfaces
- runtime-relevant flows:
  - request flow
  - startup flow
  - background job flow
  - command flow
  - data flow across layers
  - streaming/event-driven flows
- important external dependencies:
  - database
  - cache
  - queue
  - HTTP clients
  - cloud SDKs
  - auth providers
  - file storage
  - messaging/event systems
  - child processes or external binaries
- hotspots:
  - high fan-in modules
  - high fan-out modules
  - shared core abstractions
  - fragile coupling points
  - circular dependencies if visible
- cross-validation checks:
  - for each declared route/window/entry point, verify the target handler/page/component actually exists and is wired
  - for each event emitter, verify at least one subscriber exists
  - for shared constants/dimensions/schemas, verify all usage sites agree
  - report any dead code paths, unconnected wiring, or stale references found
- unknown or dynamic areas:
  - reflection
  - dependency injection wiring
  - generated code
  - config-driven behavior
  - dynamic imports
  - metaprogramming
  - macros
  - runtime registration
  - framework magic
  - anything only partially inferable from static reading

REPOSITORY READING STRATEGY

Follow this process:

1. Inspect repository root and top-level structure.
2. Detect languages, package/build/workspace manifests, and major framework clues.
3. Identify the most important directories, packages, apps, libraries, and modules.
4. Identify entry points and startup/bootstrap paths.
5. Identify architecture layers and dependency direction.
6. Identify the most important symbols and their relationships.
7. Trace the main execution and data flows.
8. Identify external integrations and infrastructure boundaries.
9. Identify hotspots, risky coupling, and likely impact zones.
10. Cross-validate wiring: verify that declared entry points, routes, windows, event channels, and shared contracts are actually connected in code. Report any gaps.
11. Record unknowns and low-confidence areas explicitly.
12. Produce the required output file in the correct mode.

TRUST AND CONFIDENCE RULES

For each important claim, prefer direct code evidence.

Use these confidence levels internally when deciding wording:
- High confidence: directly supported by code structure or explicit wiring
- Medium confidence: strongly suggested by patterns across multiple files
- Low confidence: inferred from naming/convention with limited direct evidence

In the document:
- state confident claims directly
- mark uncertain claims with words like:
  - likely
  - appears to
  - inferred from
  - low confidence
- never present low-confidence guesses as facts

IGNORE OR DE-PRIORITIZE

Unless they are architecturally important, de-prioritize:
- lockfiles details
- generated build outputs
- vendor directories
- `node_modules`
- `.git`
- binary artifacts
- coverage output
- temporary caches

Use tests selectively:
- read tests when they clarify architecture, expected flows, contracts, or important entry points
- do not let tests dominate the map unless the repo is test-driven and the architecture is best revealed there

---

INITIAL MODE OUTPUT REQUIREMENTS

If running in Initial mode, create:

`docs/system-map.md`

This file must be a standalone, reusable architecture memory document that serves as the definitive navigation map for all future AI sessions.

Target output size: 350-500 lines for a medium codebase (50-200 source files). Scale proportionally for larger or smaller codebases. Prefer depth on high-impact modules over shallow coverage of everything.

Use exactly this structure and order:

# System Map

## Snapshot
Include:
- Generated at (with timezone)
- Repository path or name
- Detected languages
- Detected frameworks/tools (be thorough — include UI libraries, ORM, state management, build tools, testing frameworks)
- Monorepo or single-project
- Primary manifests/configs examined (list all config files you actually read)
- Confidence note: state HIGH/MEDIUM/LOW confidence per area. Do not use a single blanket confidence level.
  Example: "High confidence on module layout and IPC boundaries. Medium confidence on runtime behavior that depends on packaged binaries. Low confidence on cross-platform behavior outside Windows."
- Optional commit/hash if available

## Repository Overview
Explain:
- what the repository does (1-2 sentences, concrete)
- core capabilities as a bullet list (each capability on its own line)
- overall architectural style and its key properties
- the process/runtime model (e.g., "Electron main + renderer", "Node.js server + worker threads", "monolithic Express app")

## Workspace Or Project Structure
Summarize the top-level structure:
- major apps/packages/services/libraries with their PURPOSE (not just directory name)
- key directories with a one-line explanation of what lives there
- monorepo boundaries if any
- build output directories and how they relate to source
- any directories that are expected to exist at runtime but are empty/absent in the repo (e.g., binary/model directories populated by CI)

## Architecture Layers
Describe the main layers, their responsibilities, AND the dependency direction between them.
For each layer include:
- layer name
- main files/directories
- responsibility (1-2 sentences)
- dependency direction (which layers it calls, which layers call it)

## Module Map
List the important modules/domains/packages.
Target: 8-15 modules for a medium codebase.

For each module include ALL of these fields:
- name
- purpose: what it does (1-2 sentences)
- key paths: specific file paths, not just directory names
- depends on: internal modules this module calls or imports from
- used by: which modules or layers call into this one
- major external dependencies: third-party libraries this module directly uses
- why it matters: explain the specific RISK, COUPLING, or FRAGILITY — not just the module's role.

"Why it matters" quality standard:
- BAD: "this is important for chat" (just restates the role)
- BAD: "all model execution funnels through this layer" (too abstract)
- GOOD: "despite generic abstractions, current builtin registration is effectively llama-centric and is a major future change point"
- GOOD: "semantic retrieval and chunk cleanup depend on this staying consistent with Drizzle tables and FTS tables — manual sync required"

## Entry Points
List all starting points with file paths and short explanations.
Include:
- process/app bootstrap files
- major request/command entry points
- window/worker/job creation points
- build/tooling entry points (config files that affect output)
- registration roots (where handlers/routes/plugins are wired together)

For each entry point, explain what it initializes or triggers.

## Key Symbols
List the most important symbols in the codebase.
Target: 12-20 symbols for a medium codebase.

CRITICAL: Include BOTH class-level AND method-level symbols.
- Include classes/interfaces that are central abstractions
- ALSO include specific methods/functions that are:
  - critical orchestration points (e.g., the method that wires the entire startup)
  - high-risk internal routines (e.g., the private method that does the actual indexing pipeline)
  - non-obvious hotspots (things a future AI would not discover without deep reading)
  - event setup functions that wire streaming/async behavior

Prioritize symbols by:
1. Fan-in: how many callers depend on this
2. Blast radius: how much breaks if this changes
3. Non-obviousness: would a future AI miss this by just scanning file names?

For each symbol include ALL of these fields:
- symbol name (include the class name for methods, e.g., `KnowledgeService._indexContent`)
- kind: function | method | class | interface | type | constant | component
- file path
- responsibility: what it does (1-2 sentences, specific)
- directly depends on: what it calls or imports
- used by / called by: what calls it
- why it matters: explain the specific risk or coupling, same quality standard as Module Map

## Main Flows
Describe the main runtime flows.

Format rules:
- For flows with 5 or fewer steps: use a single-line arrow chain
  Example: `Renderer -> preload IPC -> handler -> service -> DB`
- For flows with more than 5 steps: use numbered sub-steps under the flow name
  Example:
  1. `Renderer chatStore.sendMessage()`
  2. `-> preload window.api.sendMessage()`
  3. `-> IPC send-message in chatHandlers.ts`
  4. `-> persist user + assistant placeholder messages`
  5. `-> build history + persona prompt + archived-session memory`
  6. `-> optional KnowledgeService.search() for RAG context`
  7. `-> provider sendMessageStream()`
  8. `-> stream chunks back via message-chunk events`
  9. `-> persist final content/citations + token accounting`
  10. `-> possible session auto-switch`

Include these flows at minimum (if they exist in the codebase):
- App/server startup sequence
- Main user action flow (the primary thing users do)
- Data ingestion/processing pipeline
- Background/async flows
- Cleanup/deletion cascades
- Error/retry flows if architecturally significant

## Dependency Map
Summarize the most important internal and external dependency relationships.

Include:
- Central dependency spine: the main call chain from UI to persistence
- Most central modules by fan-in: list the top 5-8 files that the most other files import
- Important internal dependency relationships: specific module-to-module dependencies that are non-obvious or risky
- Major external boundaries: databases, APIs, file systems, child processes, network services
- Fragile couplings: look specifically for:
  - hardcoded constants shared across multiple files (e.g., dimensions, ports, magic strings)
  - manual synchronization between data stores (e.g., SQL table + vector table + FTS table must stay in sync)
  - implicit contracts not enforced by types (e.g., IPC channel names as strings)
  - platform-dependent fallbacks (e.g., encryption that falls back to plaintext)
  - convention-based wiring without compile-time checks
- Circular dependencies if visible

## Impact Map
This section is critical.
For each high-impact module or symbol, explain:
- if this changes
- what is likely directly affected
- what is likely downstream/transitively affected
- what kinds of regressions or breakage are plausible

Plausible regressions quality standard:
- MUST be specific and testable scenarios, not abstract failure categories
- BAD: "things could break" / "chat might not work"
- BAD: "identity drift, missing stream completion" (too vague to test)
- GOOD: "broken streaming UI because renderer expects exact event shape from message-chunk channel"
- GOOD: "duplicate messages in chat history because both placeholder and final persist paths fire"
- GOOD: "silent data loss if vector store dimensions change but existing embeddings are not reindexed"

Target: 6-10 impact entries covering the highest-risk modules.

## Cross-Validation Findings
Report the results of your wiring verification checks:
- Dead code paths: files/components/routes that exist but are not wired into the active code
- Unconnected events: emitters without subscribers or vice versa
- Shared constant mismatches: where the same value is hardcoded in multiple places
- Stale references: imports or references to renamed/moved/deleted files
- Route/window gaps: declared routes without matching pages, or pages without matching route declarations

If no issues found, state "No cross-validation issues detected" with your confidence level.

## Hotspots
List:
- high fan-in files/modules (most imported by others)
- high fan-out files/modules (imports/calls the most other things)
- core shared abstractions (types/interfaces/base classes used across many modules)
- risky integration points (specific risks, not generic descriptions)
- central configuration or orchestration files

## Unknowns And Low-Confidence Areas
List anything dynamic, implicit, generated, convention-based, or only partially inferred.
For each unknown, explain:
- what is unknown
- why it could not be determined from static reading
- what a future AI should do to resolve it (e.g., "run the app and inspect network traffic", "check CI pipeline for resource population")

## Suggested First Read For Future Sessions
Recommend the smallest high-value set of files (8-12 files) a future AI should read first to get oriented quickly.

For EACH file include a one-line reason explaining what understanding it provides:
- BAD: just listing file paths with no explanation
- GOOD: "`src/main/index.ts` — best single-file overview of startup order and service composition"
- GOOD: "`src/main/ipc/chatHandlers.ts` — highest-value business flow: chat, RAG, streaming, citations, session rollover"

Order by reading priority (most important first).

---

INITIAL MODE STYLE RULES

- Keep it concise, structured, and high-signal.
- Prefer bullets and compact structured lists over long prose.
- Include concrete file paths for ALL important claims.
- Mention symbol names where useful, including method names for critical paths.
- Rank by importance within each section.
- Do not dump every file, class, or function — curate ruthlessly.
- Every "why it matters" field must explain a specific risk, coupling, or fragility.
- Every "plausible regression" must be a testable scenario.
- Optimize for a future AI that needs to understand the system in one read without scanning any source files.

---

UPDATE MODE OUTPUT REQUIREMENTS

If running in Update mode, create:

`docs/system-map-v[number].md`

This update file must be delta-focused.
It must describe only the meaningful changes relative to the latest prior system map.
It must not restate the entire full architecture unless absolutely necessary.

Before writing the update file:
- read the latest prior system map
- inspect the current codebase
- compare the current codebase to the prior system map
- detect what actually changed in architecture, dependencies, modules, entry points, hotspots, and impact zones

Use exactly this structure and order:

# System Map Update v[number]

## Snapshot
Include:
- Generated at (with timezone)
- Repository path or name
- Update file name
- Previous map used for comparison
- Detected languages
- Confidence note (per-area, not blanket)
- Optional commit/hash if available

## Change Scope
State what kind of update this is:
- small targeted changes
- moderate architectural drift
- major structural changes

## High-Level Change Summary
Provide a concise summary of the most important changes only.

## Added
List newly introduced items that matter architecturally:
- modules/packages/apps
- entry points
- symbols (class-level AND method-level if they are orchestration points)
- dependencies
- flows
- infrastructure integrations

For each added item include:
- what was added
- where it is (file paths)
- why it matters (specific risk/coupling, not just role description)

## Removed
List architecturally relevant removals:
- removed modules
- removed entry points
- removed symbols
- removed dependencies
- removed flows

For each removed item include:
- what was removed
- where it was
- likely impact (specific, testable scenarios)

## Changed
List materially changed existing items:
- renamed or moved modules
- changed responsibilities
- changed dependency direction
- changed entry points
- changed control flow
- changed infrastructure usage
- changed public interfaces
- changed high-impact symbols

For each changed item include:
- what changed
- where (file paths)
- old understanding vs new understanding
- why the change matters (specific risk/coupling)

## Dependency Changes
Summarize important dependency graph changes:
- new internal dependencies
- removed internal dependencies
- new external dependencies
- removed external dependencies
- new coupling risks (with specific scenarios)
- reduced coupling if relevant
- newly visible circular dependencies

## Entry Point Changes
List any changed, added, or removed startup/request/job/CLI entry points.
Include file paths and what they initialize.

## Flow Changes
Describe only changed runtime flows.
Use numbered sub-steps for flows with more than 5 steps.

## Hotspot Changes
List newly risky areas or changes to previously central modules:
- fan-in increases
- fan-out increases
- new orchestrators
- new shared abstractions
- new fragile integration points

## Cross-Validation Findings
Re-run cross-validation checks and report any NEW issues introduced by the changes.

## Impact Of Changes
This section is critical.
Explain how the detected changes alter maintenance risk.
For each major change, include:
- what future tasks are now more likely to touch
- what areas now have broader impact
- what areas became safer or more isolated if applicable
- specific testable regression scenarios introduced by these changes

## Unknowns And Low-Confidence Areas
List any changed areas that remain dynamic, implicit, or only partially inferable.
For each unknown, explain what a future AI should do to resolve it.

## Recommended Files To Re-Read
Recommend the minimal set of files/directories a future AI should re-read now because of these changes.
For each file, include a one-line reason explaining why it needs re-reading.

---

UPDATE MODE STYLE RULES

- Focus only on meaningful differences from the prior map.
- Do not repeat unchanged sections of the architecture.
- Be explicit when something previously believed is no longer correct.
- If the repo changed so much that the prior map is substantially stale, say so clearly.
- Even in that case, still produce the required versioned update file, but mark that a fresh full baseline may be warranted.
- Apply the same quality standards for "why it matters" and "plausible regressions" as Initial mode.

---

QUALITY BAR

The output is only acceptable if it meets ALL of these criteria:

Comprehension test — a future AI reading only this file must be able to:
- [ ] Explain what the system does in 2 sentences
- [ ] Name the top 5 most central files and explain why they are central
- [ ] Trace the main user flow from UI to persistence without reading source
- [ ] Identify which files to modify for a given feature area
- [ ] Predict what else might break when changing a specific module
- [ ] List the fragile couplings and what keeps them in sync
- [ ] Identify dead code or unconnected wiring

Depth test — the output must include:
- [ ] At least 12 key symbols, including both classes AND critical methods
- [ ] At least 6 main flows with step-by-step detail
- [ ] At least 6 impact entries with specific testable regression scenarios
- [ ] At least 3 fragile couplings with specific files and values involved
- [ ] At least 1 cross-validation finding (even if "none found")
- [ ] Every "why it matters" explains a risk/coupling, never just restates the role
- [ ] Every "suggested first read" file has a reason

Specificity test — the output must NOT contain:
- [ ] Generic "why it matters" like "this is important" or "central to the system"
- [ ] Abstract regressions like "things could break" or "chat might not work"
- [ ] File lists without explanations
- [ ] Module descriptions that only restate the directory name
- [ ] Blanket confidence levels without per-area breakdown

---

IMPORTANT FAILURE AVOIDANCE RULES

- Do not create a vague, generic architecture summary.
- Do not merely restate directory names without explaining their role.
- Do not dump every file or every symbol — curate the most impactful ones.
- Do not overfit to naming conventions alone.
- Do not describe hypothetical runtime behavior without evidence.
- Do not skip impact analysis.
- Do not skip unknowns.
- Do not skip file paths.
- Do not skip entry points.
- Do not skip cross-validation checks.
- Do not overwrite previous versions unless explicitly asked.
- Do not write "why it matters" that merely restates what the module does.
- Do not write plausible regressions that are too vague to test.
- Do not list suggested reading files without explaining why each one matters.
- Do not use a single blanket confidence level — break it down by area.
- Do not skip method-level symbols when the method is a critical orchestration or risk point.

---

FINAL ACTION

Inspect the repository carefully enough to produce a trustworthy result.
Then create the correct file under `docs` in the correct mode:
- `docs/system-map.md` for Initial mode
- `docs/system-map-v[number].md` for Update mode
