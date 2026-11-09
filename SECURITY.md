# Security Policy

MiChat is a local-first desktop application. The security boundary that matters
most is the renderer ↔ main process boundary, followed by imported documents,
imported URLs, clipboard input, and the update channel.

## Supported versions

Security fixes are applied to the latest released minor version. Please test a
fix against the current `Michat-*` branch before reporting it as unresolved.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Report it privately to
the maintainers (the repository security contact) with:

- affected version/commit,
- reproduction steps or a proof of concept,
- impact (data exposure, code execution, denial of service),
- any suggested mitigation.

We will acknowledge the report and coordinate a fix and disclosure date.

## Security model

- MiChat runs with the privileges of the signed-in OS user. It is not a
  multi-user service and does not expose an authentication surface.
- The renderer is sandboxed, context-isolated, and receives only the curated
  `window.api` surface. It never receives provider API keys.
- Provider configuration is encrypted with the OS credential store when
  available. Do not run with `--no-sandbox` or with context isolation disabled.
- Imported documents are untrusted. Size, extension, magic bytes, and local
  paths are validated before a file is copied or parsed. Parsers should be
  treated as an attack surface; report parser crashes or memory issues.
- Web imports are limited to public HTTP(S) URLs. Private, loopback, link-local,
  multicast, reserved, and IPv4-mapped IPv6 addresses are rejected. Redirects
  are revalidated and response bodies are capped.
- Retrieved document content is untrusted prompt data, not instructions.
- Updates should be signed and installed only after explicit user action. Do
  not disable signature verification or auto-install in a custom build.

## Data at rest

The SQLite database and the `knowledge-files/` document copies are stored in the
application user-data directory and are **not encrypted by default**. MiChat
enables SQLite `secure_delete` and vacuums after destructive deletes, but this
does not protect against disk theft, OS backups, or malware. Use full-disk
encryption on machines that hold sensitive documents, and protect OS backups.

Uninstalling the app does not automatically delete user data; remove the
application user-data directory if the data must be destroyed.

## Dependencies

Run `pnpm audit --prod --audit-level=high` and `pnpm check:deps` before a
release. Advisories that are not reachable must be recorded with a review date
in `docs/security/dependency-exceptions.md`.

## Out of scope

- Attacks that already require administrator/root or physical access.
- Vulnerabilities in third-party model files the user chooses to import.
- Denial of service caused by intentionally huge local files beyond the
  documented import limits.
