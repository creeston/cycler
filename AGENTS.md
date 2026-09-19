# Agent instructions

This file is the entry point for AI agents and new contributors. The rules live in the
documents below; this file only points to them.

## Read first

- [docs/development.md](docs/development.md) — where new code goes, TypeScript and React
  conventions, the scenario-first workflow for routing algorithms (§4), the pre-commit
  checklist (§6) and the commit message format (§7).
- [backlog/README.md](backlog/README.md) — pending work. Each task file states its context,
  expected outcome and how to verify it.

## Reference

- [docs/architecture.md](docs/architecture.md) — layers, module map, runtime flows, persistence.
- [docs/algorithms.md](docs/algorithms.md) — graph construction, gap bridging, routing strategies.
- [docs/features.md](docs/features.md) — features, use cases, operating limits.

## Non-negotiable

- Nothing under `app/domain/` imports a framework.
- A routing algorithm is written only after its `.dot` scenarios exist and fail
  (development.md §4.4).
- `npm run check` passes before every commit.
- Commits follow Conventional Commits (development.md §7): `<type>(<scope>): <summary>`.

## Handing work back

When a task is complete, stage the files that belong to it with `git add <paths>` and propose a
commit message in the format of development.md §7. Do not run `git commit` — the human reviews
the staged diff and commits. Leave unrelated changes unstaged.
