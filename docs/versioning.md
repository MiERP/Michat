# Versioning and releases

`package.json` is the **single source of truth** for the application version.
It feeds:

- `app.getVersion()` in the About page;
- electron-builder artifact names (`michat-<version>-setup.exe`);
- Windows file/product version applied by `scripts/afterPack.cjs`;
- `latest.yml` used by the auto-updater.

Do not hardcode the version anywhere else. `CHANGELOG.md` must contain an entry
for the current version.

## Semver policy

| Change | Bump |
| --- | --- |
| Breaking behavior, removed features, incompatible data/API | `major` |
| New user-facing feature, architecture replacement | `minor` |
| Bug fix, docs, build, dependency patch | `patch` |

The API-only release replaced the bundled model runtime and model management
with one external OpenAI-compatible API, so it is `2.0.0`.

## Commands

```bash
pnpm version:show                     # print the current version
pnpm check:version                    # package.json + CHANGELOG + builder consistency
pnpm version:patch --note "Fix ..."   # 2.0.0 -> 2.0.1
pnpm version:minor --note "Add ..."   # 2.0.0 -> 2.1.0
pnpm version:major --note "Break ..." # 2.0.0 -> 3.0.0
pnpm version:set 2.1.0 --note "..."   # explicit version
pnpm release:build                    # check version, then build the installer
```

`version:*` updates `package.json` and prepends a dated `CHANGELOG.md` entry.
Review and expand the generated changelog entry before committing.

## Release flow

1. Implement and test on a feature branch.
2. Choose the bump level and run the matching `pnpm version:*` command.
3. Expand `CHANGELOG.md` with user-visible changes.
4. Run `pnpm release:check` (typecheck, lint, tests, coverage, security, CJK,
   encoding, migrations, packaging).
5. Run `pnpm release:build`; verify `dist/michat-<version>-setup.exe`.
6. Commit and merge to `main`, then tag `v<version>` and publish the GitHub
   release with the installer and `latest.yml`.

The GitHub release repository is `MiERP/Michat` (see `electron-builder.yml` and
`dev-app-update.yml`). Published releases must match that repository so the
auto-updater can find `latest.yml`.
