# Contributing to GitMetrics

Thanks for your interest in making GitMetrics better. This guide gets you from a fresh clone to a running development build, and explains how changes find their way into a release.

## Getting started

You need Node.js 22 (the version in `.nvmrc`) and npm.

```bash
git clone https://github.com/JeanExtreme002/GitMetrics.git
cd GitMetrics
npm install
npm run dev
```

`npm run dev` starts two processes side by side. The local API runs on port 4281 and restarts when you edit the server, while Vite serves the web app on [http://localhost:5173](http://localhost:5173) with hot reload and forwards `/api` calls to the API. To try the app exactly as users get it, run `make start`, which builds everything and launches the CLI.

If you want to keep your development data apart from your real one, point `GITMETRICS_HOME` to another folder before starting.

## Working with an AI assistant

AI assistants are welcome. [AGENTS.md](AGENTS.md) holds the project's rules for them: what GitMetrics promises its users, where code goes, and how it should look, read and be tested. Claude Code, Codex, Copilot, Cursor and most others read it on their own. Please say in your pull request that an assistant helped, and go over what it wrote before opening the pull request.

## How the project is organized

The code lives in three folders under `src`. `src/server` is the local Node server: it stores the token, talks to the GitHub REST and GraphQL APIs, caches answers and turns raw data into the numbers each page needs. Every metric has a `build*` function that is pure and easy to test, plus a small `get*` function that fetches the data. `src/web` is the React app, built with [Mantine](https://mantine.dev) and its chart components. `src/shared/types.ts` holds the response types used by both sides, so a change to an endpoint shows up as a type error in the UI.

Tests live in `tests` and run with Vitest.

## Before you open a pull request

Run the same checks as CI with a single command:

```bash
make check
```

It runs ESLint, Prettier, the TypeScript compiler and the test suite. `make format` fixes formatting for you. When you add or change a metric, please add a test for its `build*` function. For visual changes, a screenshot in light and dark mode helps the review a lot.

Pull request titles follow [Conventional Commits](https://www.conventionalcommits.org), for example `feat: show review time on the pull requests page` or `fix: keep star history when a repository is renamed`. The subject starts with a lowercase letter and does not end with a period.

## Adding a new metric

A typical new metric touches four places. Add the response type to `src/shared/types.ts`, write the `build*` and `get*` functions in `src/server/metrics`, register the section in `src/server/app.ts` with a sensible cache time, and create or extend a page in `src/web/pages/repo`. Keep pages focused: if a page starts to feel crowded, a new page in the sidebar is usually the better home.

Please keep an eye on the API budget. GitHub allows 5,000 requests per hour, so prefer GraphQL when it saves many REST calls and avoid one request per item unless the result can be cached on disk.

## Updating the screenshots

The pictures in `assets/` (used by the README and the landing page) come from the real app. The maintainer regenerates them when pages change, since they show the account that signs in, so a pull request can leave them as they are. To regenerate them:

```bash
npx playwright install chromium   # once
npm run screenshots
```

It builds the app, starts it on a free port with a temporary data folder, signs in with your GitHub CLI session, captures public pages only, frames them and deletes the temporary folder. Review the new pictures with `git diff` before committing them.

## Releasing

Releases are published from GitHub. Bump the version with `npm version <patch|minor|major> --no-git-tag-version`, merge that change, then create a GitHub Release with a tag like `v1.2.3`. The release notes on GitHub are the changelog. The `Publish to npm` workflow checks that the tag matches `package.json`, runs the tests and publishes the package with provenance.

## License of contributions

GitMetrics is licensed under the [GNU AGPL-3.0](LICENSE) with the additional terms in [NOTICE](NOTICE). By opening a pull request, you agree that your contribution is released under the same terms.

## Code of conduct

Everyone taking part in this project is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
