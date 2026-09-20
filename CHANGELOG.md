# Changelog

## 1.2.0

- Report the pi provider route as a `provider` attribute on session, token, cost, and lines-of-code metrics
- Strip the provider-scoped vendor path from `model` so one model no longer splits across several label values
- Attribute each turn to the model and provider named by its assistant message rather than the session default

## 1.1.0

- Publish as `claude-code-opentelemetry` for one-command npm installation
- Adopt standard pi package layout with `src/`, `test/`, gallery artwork, linting, and package allowlist
- Rewrite documentation around npm installation, quick start, compatibility contract, privacy, and troubleshooting
- Count edit decisions and line changes only after successful edit/write operations

## 1.0.0

- Initial public release
- Export all eight Claude Code OpenTelemetry metric families from pi
- Support OTLP/HTTP and console metric exporters through standard OTEL environment variables
- Support Grafana dashboard 25255 metric names and labels
