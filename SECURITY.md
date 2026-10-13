# Security Policy

## Supported versions

Security fixes are applied to the default branch. Deployments should update to a current commit that contains the relevant fix.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use the repository's **Security → Report a vulnerability** form (GitHub Private Vulnerability Reporting) and include:

- affected version or commit
- reproduction steps or a minimal proof of concept
- expected impact
- suggested remediation, if available

You should receive an acknowledgement within 72 hours. After triage, maintainers will coordinate a fix and disclosure timeline with the reporter.

## Deployment responsibilities

- Generate unique `JWT_SECRET` and `AI_CONFIG_ENCRYPTION_KEY` values; never commit them.
- Terminate production traffic with HTTPS and configure an explicit origin allowlist.
- Keep encrypted backups and the encryption key in separate protected locations.
- Rotate any credential that may have appeared in logs, shell history, screenshots, or commits.
- Apply dependency and container updates promptly.

See [deployment guidance](./docs/deployment.md) and [permission rules](./docs/permissions.md) for production setup and authorization boundaries.
