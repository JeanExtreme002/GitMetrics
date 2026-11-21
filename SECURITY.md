# Security Policy

## Supported versions

Security fixes are released for the latest version of MyGitDash published on npm. Please update with `npm install -g mygitdash@latest`, or run `npx mygitdash@latest`, before reporting an issue.

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through [GitHub Security Advisories](https://github.com/JeanExtreme002/MyGitDash/security/advisories/new) instead. Include what you found, how to reproduce it and the impact you expect. You can expect a first answer within a few days, and you will be credited in the release notes unless you prefer otherwise.

## How MyGitDash handles your data

MyGitDash is designed to keep your GitHub token on your computer.

The token is stored in `~/.mygitdash/config.json` with permissions that only allow your user to read it (`0600`, inside a `0700` folder). It is only ever sent to `api.github.com`, and the browser never receives it. Signing out removes it from disk. When you sign in with GitHub, MyGitDash uses the OAuth Device Flow, so no client secret is shipped with the package.

The local server listens on `127.0.0.1` only. It refuses requests whose `Host` header is not a local address, which protects against DNS rebinding, and every request that changes state must carry a custom header that other websites cannot send. Together these stop a malicious page open in your browser from talking to MyGitDash.

Anyone who can log in as your user on your computer can read the token, just like with the GitHub CLI or Git credential files. If that is a concern, sign out when you are done or use a fine-grained token with read-only permissions.
