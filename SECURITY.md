# Security policy

## Trust model

`claude-code-opentelemetry` is a pi extension. Like every pi extension, it runs with permissions of local user and is not a sandbox. Install only packages and versions you trust.

Extension:

- reads OTEL configuration and headers from process environment
- reads global Git email for dashboard identity when available
- creates a random installation identifier under pi state directory
- reads edited text before and after file operations to calculate line deltas
- inspects relevant tool results locally to detect commits and pull requests
- sends metric datapoints and resource metadata to configured OTLP endpoint

It does not intentionally export prompts, model responses, source text, file paths, shell commands, tool arguments, tool output, API keys, or OTLP header values. See README privacy section for metadata that is exported by design.

Collector endpoint, transport security, authentication, storage, access control, and retention remain operator responsibilities. Anyone controlling process environment or collector can redirect or observe telemetry.

## Supported versions

Security fixes target latest published npm version. Upgrade with:

```bash
pi update npm:claude-code-opentelemetry
```

## Report a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/xiaoxianma/claude-code-opentelemetry/security/advisories/new). Do not open a public issue for undisclosed vulnerabilities.

Include affected version, impact, reproduction steps, and minimal proof of concept. Redact credentials, private endpoints, personal data, prompts, and source code.

## In scope

- unintended export of content documented as never exported
- credential or OTLP header disclosure
- sending telemetry to endpoint other than configured OTLP endpoint
- unsafe handling of package-owned state files
- reachable vulnerabilities in shipped runtime dependencies

## Out of scope

- expected execution with local user's permissions
- behavior caused by attacker-controlled environment, pi configuration, collector, or local files
- prompt injection or malicious model output
- collector-side security, availability, or retention policy
- metadata documented as exported by design
