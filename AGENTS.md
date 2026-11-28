# AGENTS.md

Guidance for AI coding assistants (Claude Code, Codex, Copilot, Cursor, Gemini and others) working on GitMetrics. Human contributors are welcome to read it too: it is the short version of how this project keeps its quality. For setup and the release process, see [CONTRIBUTING.md](CONTRIBUTING.md).

## What GitMetrics is

A dashboard for GitHub repositories that runs on the user's own computer: `npx @gitmetrics/app` starts a local server and opens the browser on `http://localhost:4280`. It shows stars, traffic, commits, pull requests, reviews, issues, Actions, releases, deployments and organizations, and keeps traffic beyond the 14 days GitHub shows.

### Promises that must never break

These are why people trust it with a GitHub token. Don't weaken one on your own: a change that touches one needs the maintainer's agreement first, and then must be something the user turns on, told plainly what it does.

- **Local only.** The server listens on `127.0.0.1`, refuses other hosts, and requires the `x-gitmetrics: 1` header on every non-GET `/api` call. Keep both checks in `src/server/app.ts`.
- **Talks to GitHub and npm only, unless the user turns something else on.** The server reaches `api.github.com`, `github.com` (sign-in) and `registry.npmjs.org` (updates).
- **Read-only on GitHub.** Never write to GitHub: no comments, labels, stars, merges or any other mutation.
- **No telemetry.** No analytics, tracking, crash reporting or "anonymous usage" of any kind.
- **The token stays private.** It lives in `~/.gitmetrics/config.json`, readable only by the user. Never log it, print it, put it in a URL or send it anywhere but GitHub.
- **Changes to the computer only when asked.** Shortcuts, starting with the computer and the like happen only when the user turns them on, and turning them off undoes them.
- **Data stays compatible.** Users keep months of traffic in `~/.gitmetrics`. Never change those files in a way an older or newer version can't read without a migration.

## Commands

```bash
npm install
npm run dev       # API on :4281 with restart, web app on :5173 with hot reload
make check        # lint, format, types and tests: what CI runs
make format       # fix formatting
make start        # build and run it as users do
```

Run `make check` before saying a change is done. A change isn't done because it compiles: run the app and look at it.

## Where things go

- `src/server/metrics/*.ts`: one file per area. Each metric has a pure `build*` function (raw data in, numbers out) and a small `get*` function that fetches. Put the logic in `build*`, so it can be tested without a network.
- `src/server/app.ts`: the routes. Validate every parameter (see `ACCOUNT` and `SEARCH_TEXT` in `metrics/mine.ts`) and answer `400` with a short message. Cache GitHub answers with `memory.wrap`, keyed by the signed-in login and everything the answer depends on.
- `src/server/github.ts`: the GitHub client. Use `get`, `pages`, `paginate`, `graphql` and `count`, not `fetch`.
- `src/shared/types.ts`: every response shape, shared by server and web, so a changed endpoint is a type error in the UI.
- `src/web/lib/queries.ts`: one TanStack Query hook per endpoint.
- `src/web/pages`: pages; `src/web/components/ui.tsx`: the shared building blocks.
- `site/`: the landing page at gitmetrics.pro, built apart from the app.
- `tests/`: Vitest. `tests/sections.test.ts` runs the real routes against a fake GitHub.

## Code

- TypeScript is strict, with `noUncheckedIndexedAccess`. No `any`, and no `!` or `as` to silence a real case: handle it.
- Reuse before writing: `mapLimit` in `util.ts`, the GitHub client, the formatters in `web/lib/format.ts`, the components in `ui.tsx`. Two copies of the same knowledge will drift.
- Mind the API budget: GitHub allows 5,000 requests an hour, shared by everything the user opens. Prefer one GraphQL query to many REST calls, never one request per item without a cache, and read only what the page shows.
- Comments say why, in plain sentences: what a reader couldn't guess from the code. Not what the next line does.
- Keep a change to its purpose. No drive-by renames, reformatting or refactors in unrelated files. A bug found next to your change may be fixed too, in its own commit, and said so.
- Errors the user sees are short, say what happened, and say what to do when there's something to do.
- Add dependencies only when they clearly pay for themselves: each one ships to every user, and its license must allow the AGPL with the [NOTICE](NOTICE) terms.

## Interface

GitMetrics has a settled look. A new page should look like it was always there: start from the structure of an existing one (`src/web/pages/repo/Pulls.tsx` is a good model). A new pattern is fine when none fits; say why in the pull request.

- Pages open with `PageHeader`: an icon, a short title, a dimmed description and the main numbers as `Counter`s.
- Sections sit straight on the page with `SectionHeader` (a title and a dimmed caption). Lists are hairline rows. Notes are one quiet line with an icon.
- On data pages, avoid bordered cards, tiles, stat strips and colored callout boxes. A bar suits a share of a whole (languages, the API budget), not decoration. Dialogs and first-run offers have more room: cards to choose from, or an illustration, are fine there.
- Loading shows skeletons in the shape of what comes; errors and empty states use `ErrorState`, `EmptyState` and `QueryView`.
- The logo's red (`LOGO_RED`) is for the logo, page titles and rare accents, never for buttons, which would read as danger. The main step of a feature uses `PRIMARY_ACTION`.
- Icons come from Tabler, sparingly, where they help find something. No decorative or "sparkle" icons on buttons and headings.
- People and accounts link to their page inside GitMetrics, not to github.com. GitHub itself is one quiet button at the end.
- Check every visual change in dark mode, light mode and at 390px wide.
- The landing page in `site/` has its own look, in `site/style.css`: these rules are for the app.

## Writing

Everything a user reads (UI, README, landing page, release notes) is in English and written for a global audience.

- Plain and short. Sentence case for titles, no period at the end of headings.
- Say what something does for the user, concretely. No hype ("powerful", "seamless", "blazing fast"), no exclamation marks.
- Examples use neutral placeholders: `octo/app`, Jane Doe, `$`.
- Numbers and durations go through the formatters, so they read the same everywhere.
- The README stays short and visual. Release notes live in GitHub Releases: there is no CHANGELOG.md.

## Tests

- Every new or changed metric gets a test of its `build*` function. Every new route is covered in `tests/sections.test.ts` or next to its feature.
- Tests never reach the network or change the machine: fake `fetch`, temporary folders and the `run` stand-in, as `tests/launch.test.ts` does for shortcuts.
- A test should fail without the change it covers. Check that it does.

## Commits and pull requests

- Titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `chore:` and the like, with a lowercase subject and no final period. CI checks it.
- One coherent change per pull request, in commits that can be reviewed one by one.
- The description says what changed for the user and how it was checked. For a visual change, add screenshots in dark and light mode, and regenerate the pictures in `assets/` with `npm run screenshots` if the pages in them changed.
- Never name the real repositories, organizations or people you tried a change on. Use placeholders like `alice/app`.
- Versions and releases are the maintainer's: don't bump `package.json` or create tags unless asked to.

## For AI assistants

- Say in the pull request that an AI assistant helped, and which one. The person opening it answers for the change, so they should go over what the assistant wrote.
- Don't guess GitHub's API: check the fields and limits in GitHub's documentation, or in the code that already reads them.
- Don't report a change as working without having run it: `make check`, and the app itself for anything the user sees.
- When a request conflicts with this file, say so instead of working around it quietly.
- When unsure whether something fits the project, open an issue or ask in the pull request before building it.
