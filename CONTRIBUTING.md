# Contributing

Thanks for improving `claude-code-opentelemetry`.

## Scope

Project has one narrow goal: export pi usage as Claude Code-compatible OpenTelemetry metrics. Changes should preserve metric names, units, dashboard attributes, and documented privacy boundaries unless a release explicitly changes that contract.

For substantial changes, open an issue first. Bug reports should include:

- pi and extension versions
- relevant non-secret OTEL configuration
- expected and observed metric behavior
- minimal reproduction steps

Never include collector credentials, authorization headers, prompts, source code, or private endpoints in issues.

## Development

```bash
npm install
npm run check
pi -e ./src/index.ts
```

`npm run check` runs formatting/lint checks, TypeScript, and tests. Before submitting:

1. Keep changes focused.
2. Add behavior tests for changed metric logic.
3. Update README when configuration or observable semantics change.
4. Run `npm pack --dry-run` and inspect published file list.
5. Confirm tracked files contain no credentials, personal data, internal endpoints, or machine-specific paths.

## Pull requests

Explain observable change and verification performed. Do not commit generated archives, environment files, collector exports, or local pi state.

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/xiaoxianma/claude-code-opentelemetry/security/advisories/new), not a public issue.
