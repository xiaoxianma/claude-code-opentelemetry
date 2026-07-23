# Claude Code OpenTelemetry for Pi

**One OpenTelemetry pipeline. One Grafana dashboard. Claude Code and Pi.**

`claude-code-opentelemetry` is a [Pi coding agent](https://pi.dev) extension that exports Pi usage through the same metric names, units, and dashboard labels as Claude Code.

Point Pi at your existing OTLP collector, import [Grafana dashboard 25255 — Claude Code Metrics Prometheus](https://grafana.com/grafana/dashboards/25255-claude-code-metrics-prometheus/), and Pi appears beside Claude Code without a second collector, scraper, or translation job.

## Why this extension

Most Pi telemetry extensions publish a separate `pi_*` schema. That works, but it means maintaining separate dashboards and queries.

This extension instead provides wire-compatible versions of all eight [Claude Code OpenTelemetry metric families](https://code.claude.com/docs/en/monitoring-usage#metrics):

| OpenTelemetry metric | Prometheus series used by dashboard 25255 |
|---|---|
| `claude_code.session.count` | `claude_code_session_count_total` |
| `claude_code.lines_of_code.count` | `claude_code_lines_of_code_count_total` |
| `claude_code.pull_request.count` | `claude_code_pull_request_count_total` |
| `claude_code.commit.count` | `claude_code_commit_count_total` |
| `claude_code.cost.usage` | `claude_code_cost_usage_USD_total` |
| `claude_code.token.usage` | `claude_code_token_usage_tokens_total` |
| `claude_code.code_edit_tool.decision` | `claude_code_code_edit_tool_decision_total` |
| `claude_code.active_time.total` | `claude_code_active_time_seconds_total` |

It also emits dashboard-compatible labels including `organization_id`, `user_email`, `session_id`, `model`, `type`, `decision`, and `language`.

## Install

```bash
pi install git:github.com/xiaoxianma/claude-code-opentelemetry
```

Restart Pi after installation.

## Configure once

The extension intentionally reads the same standard environment variables used by Claude Code. If Claude Code already exports metrics from this shell, Pi needs no second endpoint configuration.

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=1
export OTEL_METRICS_EXPORTER=otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_EXPORTER_OTLP_ENDPOINT=https://otel-collector.example.com
export OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative
export OTEL_METRIC_EXPORT_INTERVAL=60000
```

The generic endpoint follows OTLP/HTTP conventions: `/v1/metrics` is appended automatically. A signal-specific `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` is used verbatim when present.

Static headers work with either standard variable; signal-specific headers override generic headers:

```bash
export OTEL_EXPORTER_OTLP_HEADERS='Authorization=Bearer%20token'
# or
export OTEL_EXPORTER_OTLP_METRICS_HEADERS='Authorization=Bearer%20token'
```

This extension exports metrics only. `OTEL_TRACES_EXPORTER=none` is recommended when your collector has no traces pipeline.

## Import dashboard 25255

1. Open Grafana.
2. Select **Dashboards → New → Import**.
3. Enter dashboard ID **25255**, or open its [Grafana catalog page](https://grafana.com/grafana/dashboards/25255-claude-code-metrics-prometheus/).
4. Choose the Prometheus-compatible data source receiving your collector's metrics.
5. Select organization, user, and model variables.

No dashboard rewrite is required. `service_name="pi-coding-agent"` distinguishes Pi series when needed.

## Collector example

Any OTLP/HTTP metrics collector works. This minimal OpenTelemetry Collector pipeline forwards metrics to a Prometheus remote-write backend:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch: {}

exporters:
  prometheusremotewrite:
    endpoint: https://prometheus.example.com/api/v1/write
    resource_to_telemetry_conversion:
      enabled: true

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [prometheusremotewrite]
```

Then configure both Claude Code and Pi with:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Metric behavior

- **Sessions:** classified as `fresh`, `resume`, or `continue`.
- **Tokens:** exported as `input`, `output`, `cacheRead`, and `cacheCreation`.
- **Cost:** uses Pi's provider-reported USD cost for each assistant turn.
- **Lines changed:** calculated from successful Edit/Write file effects and attributed to model and language.
- **Commits:** counted only when an observed `git commit` command advances `HEAD`.
- **Pull requests:** counted from successful `gh pr create` or `glab mr create` output.
- **Edit decisions:** reported as `accept` from `config`, because Pi intentionally has no built-in permission prompts.
- **Active time:** CLI processing uses measured wall time; user time uses a bounded interaction estimate because Pi does not expose Claude Code's internal keyboard-focus tracker.

Zero-valued series are published at session start so every dashboard panel is immediately discoverable before its first matching action.

## Identity and cardinality

The extension follows Claude-style labels while remaining useful without an Anthropic account:

- `user.email`: global `git config user.email`, when available
- `organization.id`: `CLAUDE_CODE_ORGANIZATION_ID`, otherwise the first label of the Git email domain, otherwise `local`
- `user.id`: random installation ID stored with mode `0600` under `~/.pi/agent/state/otel-user-id`
- `session.id`: Pi session UUID
- `terminal.type`: detected from terminal environment
- custom `OTEL_RESOURCE_ATTRIBUTES`: copied to metric datapoints by default

Claude-compatible cardinality switches are honored:

- `OTEL_METRICS_INCLUDE_SESSION_ID`
- `OTEL_METRICS_INCLUDE_VERSION`
- `OTEL_METRICS_INCLUDE_ENTRYPOINT`
- `OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES`

## Privacy

Metrics contain metadata and numeric counts only. This extension does **not** export:

- prompt or response text
- source-code contents
- tool arguments or tool output
- shell commands
- API keys or OTLP headers

`user.email` is included when configured in Git because dashboard 25255 uses it for user filtering. Review collector retention and access policy before deploying telemetry across a team.

## Verify

Inside Pi:

```text
/claude-metrics-status
```

Or query your Prometheus-compatible backend:

```promql
claude_code_session_count_total{service_name="pi-coding-agent"}
```

Run local checks:

```bash
npm install
npm run check
```

## Scope

This project targets Claude Code **metrics and dashboard compatibility**. It does not impersonate Claude Code, and it does not export Claude Code's OTLP logs/events or beta traces. Pi-specific measurements use the closest observable semantics described above.

## License

MIT

---

Not affiliated with Anthropic, Grafana Labs, or the Pi maintainers. Claude Code and Grafana are trademarks of their respective owners.
