<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
  <img src="assets/logo-light.svg" width="96" alt="MyGitDash logo" />
</picture>

# MyGitDash

<b>Every number behind your GitHub repositories, on one screen.</b><br>
<i>Stars, traffic, commits, pull requests and CI health. Running on your machine, one command away.</i>

<br>

[![CI](https://github.com/JeanExtreme002/MyGitDash/actions/workflows/ci.yml/badge.svg)](https://github.com/JeanExtreme002/MyGitDash/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/JeanExtreme002/MyGitDash/graph/badge.svg)](https://codecov.io/gh/JeanExtreme002/MyGitDash)
[![npm](https://img.shields.io/npm/v/mygitdash?logo=npm&color=red)](https://www.npmjs.com/package/mygitdash)
[![Node Version](https://img.shields.io/badge/node-20.19+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue)](#quick-start)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

<br>

<img src="assets/overview.png" alt="MyGitDash showing the overview of a repository" width="880" />

</div>

<br>

GitHub spreads your project's numbers across a dozen tabs and deletes traffic after 14 days. **MyGitDash brings them together in one fast dashboard**, and keeps the history GitHub throws away.

## Quick start

You only need [Node.js](https://nodejs.org) 20.19 or newer.

```bash
npx mygitdash
```

Your browser opens on [http://localhost:4280](http://localhost:4280). Sign in and you are done.

Prefer a permanent command? Install it globally:

```bash
npm install -g mygitdash
mygitdash
```

## What's inside

<table>
  <tr>
    <td width="50%"><img src="assets/stars.png" alt="Stars page" /></td>
    <td width="50%"><img src="assets/commits.png" alt="Commits page" /></td>
  </tr>
  <tr>
    <td align="center"><b>Stars</b><br>Full history, monthly growth and milestones</td>
    <td align="center"><b>Commits</b><br>Contribution calendar, code frequency and work hours</td>
  </tr>
  <tr>
    <td width="50%"><img src="assets/pulls.png" alt="Pull requests page" /></td>
    <td width="50%"><img src="assets/actions.png" alt="Actions page" /></td>
  </tr>
  <tr>
    <td align="center"><b>Pull requests</b><br>Merge rate, sizes, authors and what is waiting</td>
    <td align="center"><b>Actions</b><br>Success rate, failures and run time of every workflow</td>
  </tr>
</table>

Also **Overview**, **Traffic**, **Issues**, **Contributors**, **Hotspots**, **Releases** and **Deployments** for each repository, a home page across everything you own, and <kbd>⌘</kbd> <kbd>K</kbd> to jump to any repository. Light and dark themes included.

## Follow how your projects grow

See where every repository is heading: stars gained, release cadence, how fast pull requests land and how healthy your CI is. Pin the projects you care about, and the home page ranks all of them by stars, activity or traffic.

## Traffic history that never expires

GitHub keeps only the last 14 days of traffic. MyGitDash saves each window on your machine and merges it with what it saw before, so your views and clones history keeps growing for as long as you use it.

## Signing in

- **GitHub CLI:** if you use the [GitHub CLI](https://cli.github.com), one click reuses your session.
- **Personal access token:** paste a [token](https://github.com/settings/tokens/new?scopes=repo,read:user,read:org&description=MyGitDash) with the `repo`, `read:user` and `read:org` scopes.

Have your own GitHub OAuth App? Set `MYGITDASH_CLIENT_ID` to also get a **Sign in with GitHub** button that confirms a short code in your browser.

## Privacy

No backend, no account, no analytics. MyGitDash listens only on `127.0.0.1` and talks only to `api.github.com`. Your token, pins, cache and traffic history stay in `~/.mygitdash`, readable only by you. Signing out deletes the token.

## Options

```text
mygitdash [options]

  -p, --port <number>  Port to listen on (default: 4280)
      --no-open        Do not open the browser automatically
  -v, --version        Print the version
  -h, --help           Show this message
```

| Variable              | What it does                                               |
| --------------------- | ---------------------------------------------------------- |
| `MYGITDASH_HOME`      | Keeps the data somewhere other than `~/.mygitdash`         |
| `MYGITDASH_CLIENT_ID` | Enables **Sign in with GitHub** through your own OAuth App |

## Contributing

Ideas, bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) shows how to run the project locally in a couple of minutes.

## License

[MIT](LICENSE)
