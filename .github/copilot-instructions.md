# Copilot instructions

Follow [AGENTS.md](../AGENTS.md) at the root of the repository: the project's promises, where code goes, and its rules for code, interface, writing, tests and pull requests.

When reviewing a pull request, flag in particular:

- Anything that weakens a promise in AGENTS.md: a new outside host, a write to GitHub, telemetry, the token leaving `~/.gitmetrics` or going anywhere but GitHub, or a change to the files in `~/.gitmetrics` without a migration.
- A route without parameter validation, a route that reads GitHub without a cache, or a request per item that could exhaust GitHub's API budget.
- Metric logic outside a tested `build*` function, or a new metric without a test.
- Interface that breaks the settled look: bordered cards or callout boxes on data pages, the logo's red on a button, links to github.com where a GitMetrics page exists.
- Real repository, organization or people names used as examples or in descriptions.
