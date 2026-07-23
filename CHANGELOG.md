# Changelog

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
