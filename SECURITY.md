# Security Policy

MMM holds the most sensitive data a person has — their finances — so security
reports are taken seriously and handled privately.

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's
[private vulnerability reporting](https://github.com/aaronk2001/mmm-app/security/advisories/new)
for this repository. Include:

- the affected version or commit,
- steps to reproduce (a minimal proof of concept is ideal),
- the impact you believe it has.

You can expect an acknowledgement within 7 days. Fixes for confirmed issues
ship as a patch release, and reporters are credited in the release notes unless
they ask not to be.

## Scope

In scope: anything that lets data or API keys leave the machine without the
user's opt-in, lets web content or another local process read or modify the
ledger, or escapes the Electron renderer sandbox.

Out of scope: attacks that require an already-compromised OS user account, and
findings in third-party services the opt-in online features call.

The threat model and every control it relies on are documented in
[`docs/design/privacy-and-security.md`](docs/design/privacy-and-security.md).

## Supported versions

Only the latest release receives security fixes.
