# Security Policy

## Supported Version

Security fixes are provided for the latest public Wayfinder release.

| Version | Supported |
| --- | --- |
| 0.3.10 | Yes |
| Earlier releases | No |

## Report a Vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not open a
public issue for a suspected vulnerability.

Include:

- the affected Wayfinder version and operating system;
- reproducible steps and the expected security boundary;
- the practical impact;
- a minimal proof of concept using synthetic data.

Do not include real AI conversations, source code from private projects,
credentials, or a copy of `~/.wayfinder`.

## Data Boundary

The current release stores normalized history, collection cursors, and
snapshots under `~/.wayfinder`. It has no Wayfinder account, analytics service,
advertising, cloud sync, or cloud analysis. See [PRIVACY.md](PRIVACY.md) for
the complete data policy.
