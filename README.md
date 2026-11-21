<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
  <img src="assets/logo-light.svg" width="96" alt="MyGitDash logo" />
</picture>

# MyGitDash

<b>Every number behind your GitHub repositories, in one dashboard.</b><br>
<i>Stars, traffic, commits, pull requests and CI health. Running on your machine, one command away.</i>

<p align="center">
  <a href="https://github.com/JeanExtreme002/MyGitDash/actions/workflows/ci.yml"><img src="https://github.com/JeanExtreme002/MyGitDash/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://codecov.io/gh/JeanExtreme002/MyGitDash"><img src="https://codecov.io/gh/JeanExtreme002/MyGitDash/graph/badge.svg" alt="Coverage" /></a>
  <a href="https://www.npmjs.com/package/mygitdash"><img src="https://img.shields.io/npm/v/mygitdash?logo=npm&color=red" alt="npm" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-20.19+-339933?logo=nodedotjs&logoColor=white" alt="Node Version" /></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-blue" alt="Platforms" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT" /></a>
</p>

<img src="assets/overview.png" alt="MyGitDash showing the overview of a repository" width="880" />

</div>

GitHub shows bits of your projects in scattered places, forgets older traffic and leaves the big picture to you. **MyGitDash fills those gaps** with one fast dashboard that sees everything and remembers it.

## Quick start

You only need [Node.js](https://nodejs.org) 20.19 or newer.

```bash
npx mygitdash
```

Your browser opens on [http://localhost:4280](http://localhost:4280). Sign in and you are done.

**Install it globally:**

```bash
npm install -g mygitdash
mygitdash
```

## What's inside

<p align="center">
  <img src="assets/pages-grid.png" alt="Stars, Commits, Pull requests and Actions pages" width="880" />
</p>

Each repository also gets **Overview**, **Traffic**, **Issues**, **Contributors**, **Hotspots**, **Releases** and **Deployments**, plus a home page across everything you own and <kbd>Ctrl</kbd> + <kbd>K</kbd> to jump anywhere. Light and dark themes included.

## Follow how your projects grow

See where every repository is heading: stars gained, release cadence, how fast pull requests land and how healthy your CI is. Pin the projects you care about, and the home page ranks all of them by stars, activity or traffic.

## Traffic history that never expires

GitHub keeps only the last 14 days of traffic. MyGitDash saves each window on your machine and merges it with what it saw before, so your views and clones history keeps growing for as long as you use it.

## Signing in

**GitHub CLI:**<br>
If you use the [GitHub CLI](https://cli.github.com), one click reuses your session.

**Personal access token:**<br>
Paste a [token](https://github.com/settings/tokens/new?scopes=repo,read:user,read:org&description=MyGitDash) with the `repo`, `read:user` and `read:org` scopes.

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
