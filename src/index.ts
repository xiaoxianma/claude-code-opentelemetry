import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir, hostname, release } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Attributes, Counter } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  ConsoleMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import {
  changedLineCounts,
  createdPullRequestCount,
  createsGitCommit,
  languageForPath,
  parseHeaders,
  parseResourceAttributes,
  resolveMetricsEndpoint,
  type SessionStartReason,
  sessionStartType,
} from "./core.js";

const MAX_TRACKED_FILE_BYTES = 10 * 1024 * 1024;
const MAX_USER_ACTIVE_GAP_SECONDS = 60;
const EXTENSION_VERSION = "1.1.0";

type MetricSet = {
  session: Counter;
  lines: Counter;
  pullRequest: Counter;
  commit: Counter;
  cost: Counter;
  token: Counter;
  codeEditDecision: Counter;
  activeTime: Counter;
};

type Runtime = {
  provider: MeterProvider;
  metrics: MetricSet;
  endpoint: string;
};

type EditSnapshot = {
  path: string;
  language: string;
  model: string;
};

type BashSnapshot = {
  command: string;
  cwd: string;
  head?: string;
};

type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  cost?: { total?: number };
};

function enabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function gitConfig(key: string): string | undefined {
  try {
    return (
      execFileSync("git", ["config", "--global", "--get", key], {
        encoding: "utf8",
        timeout: 2_000,
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function persistentUserId(): string {
  const stateDir = resolve(homedir(), ".pi", "agent", "state");
  const path = resolve(stateDir, "otel-user-id");

  try {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) return existing;
  } catch {
    // First run or unreadable state: create a fresh anonymous identifier.
  }

  const id = randomUUID();
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${id}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return id;
}

function terminalType(): string {
  if (process.env.TMUX) return "tmux";
  return process.env.TERM_PROGRAM || process.env.TERMINAL_EMULATOR || process.env.TERM || "unknown";
}

function organizationId(email: string | undefined): string {
  const explicit = process.env.CLAUDE_CODE_ORGANIZATION_ID;
  if (explicit) return explicit;
  const domain = email?.split("@").at(-1)?.toLowerCase();
  return domain?.split(".")[0] || "local";
}

function outputText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((block) =>
      block && typeof block === "object" && "text" in block && typeof block.text === "string"
        ? [block.text]
        : [],
    )
    .join("\n");
}

async function textFile(path: string): Promise<string | undefined> {
  try {
    const data = await readFile(path);
    if (data.length > MAX_TRACKED_FILE_BYTES || data.includes(0)) return undefined;
    return data.toString("utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "" : undefined;
  }
}

function gitHead(cwd: string): string | undefined {
  try {
    return (
      execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

function newCommits(cwd: string, before: string | undefined, after: string | undefined): string[] {
  if (!after || before === after) return [];
  if (!before) return [after];
  try {
    return execFileSync("git", ["-C", cwd, "rev-list", "--reverse", `${before}..${after}`], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

function metricReaders(endpoint: string): PeriodicExportingMetricReader[] {
  const exporters = (process.env.OTEL_METRICS_EXPORTER ?? "none")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const interval = Number.parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? "60000", 10);
  const exportIntervalMillis = Number.isFinite(interval) && interval > 0 ? interval : 60_000;
  const readers: PeriodicExportingMetricReader[] = [];

  if (exporters.includes("otlp")) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: endpoint,
          headers: {
            ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS),
            ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS),
          },
        }),
        exportIntervalMillis,
      }),
    );
  }
  if (exporters.includes("console")) {
    readers.push(
      new PeriodicExportingMetricReader({
        exporter: new ConsoleMetricExporter(),
        exportIntervalMillis,
      }),
    );
  }
  return readers;
}

function createRuntime(): Runtime | undefined {
  if (process.env.CLAUDE_CODE_ENABLE_TELEMETRY !== "1") return undefined;
  const baseEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const metricsEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  if (!baseEndpoint && !metricsEndpoint) return undefined;

  const endpoint = resolveMetricsEndpoint(baseEndpoint ?? "", metricsEndpoint);
  const readers = metricReaders(endpoint);
  if (readers.length === 0) return undefined;

  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: "pi-coding-agent",
      [ATTR_SERVICE_VERSION]: EXTENSION_VERSION,
      "os.type": process.platform,
      "os.version": release(),
      "host.arch": process.arch,
      "host.name": hostname(),
    }),
    readers,
  });
  const meter = provider.getMeter("dev.xiaoxianma.claude_code_opentelemetry", EXTENSION_VERSION);

  return {
    provider,
    endpoint,
    metrics: {
      session: meter.createCounter("claude_code.session.count", {
        description: "Count of CLI sessions started",
      }),
      lines: meter.createCounter("claude_code.lines_of_code.count", {
        description: "Count of lines of code modified",
      }),
      pullRequest: meter.createCounter("claude_code.pull_request.count", {
        description: "Number of pull requests created",
      }),
      commit: meter.createCounter("claude_code.commit.count", {
        description: "Number of git commits created",
      }),
      cost: meter.createCounter("claude_code.cost.usage", {
        description: "Cost of the coding-agent session",
        unit: "USD",
      }),
      token: meter.createCounter("claude_code.token.usage", {
        description: "Number of tokens used",
        unit: "tokens",
      }),
      codeEditDecision: meter.createCounter("claude_code.code_edit_tool.decision", {
        description: "Count of code editing tool decisions",
      }),
      activeTime: meter.createCounter("claude_code.active_time.total", {
        description: "Total active time",
        unit: "s",
      }),
    },
  };
}

export default function claudeCodeMetrics(pi: ExtensionAPI): void {
  let runtime: Runtime | undefined;
  let standardAttributes: Attributes = {};
  let currentModel = "unknown";
  let cliActiveSince: number | undefined;
  let userActiveSince: number | undefined;
  let lastError: string | undefined;
  const editSnapshots = new Map<string, EditSnapshot>();
  const observedFiles = new Map<string, string>();
  const pendingEdits = new Map<string, number>();
  const bashSnapshots = new Map<string, BashSnapshot>();
  const seenCommits = new Set<string>();

  const attrs = (extra: Attributes = {}): Attributes => ({ ...standardAttributes, ...extra });

  const addActiveTime = (type: "cli" | "user", seconds: number): void => {
    if (seconds > 0) runtime?.metrics.activeTime.add(seconds, attrs({ type }));
  };

  pi.registerCommand("claude-metrics-status", {
    description: "Show Claude-compatible OpenTelemetry metrics status",
    handler: async (_args, ctx) => {
      const text = runtime
        ? `Claude-compatible metrics active\nEndpoint: ${runtime.endpoint}${lastError ? `\nLast error: ${lastError}` : ""}`
        : "Claude-compatible metrics disabled or missing OTEL configuration";
      ctx.ui.notify(text, lastError ? "warning" : "info");
    },
  });

  pi.on("session_start", async (event, ctx) => {
    runtime = createRuntime();
    if (!runtime) return;

    const email = gitConfig("user.email");
    const resourceAttributes = enabled(process.env.OTEL_METRICS_INCLUDE_RESOURCE_ATTRIBUTES, true)
      ? parseResourceAttributes(process.env.OTEL_RESOURCE_ATTRIBUTES)
      : {};
    standardAttributes = {
      ...resourceAttributes,
      "organization.id": organizationId(email),
      "user.id": persistentUserId(),
      "terminal.type": terminalType(),
    };
    if (enabled(process.env.OTEL_METRICS_INCLUDE_SESSION_ID, true)) {
      standardAttributes["session.id"] = ctx.sessionManager.getSessionId();
    }
    if (email) standardAttributes["user.email"] = email;
    if (enabled(process.env.OTEL_METRICS_INCLUDE_ENTRYPOINT, false)) {
      standardAttributes["app.entrypoint"] = ctx.mode === "rpc" ? "sdk-cli" : "cli";
    }
    if (enabled(process.env.OTEL_METRICS_INCLUDE_VERSION, false)) {
      standardAttributes["app.version"] = EXTENSION_VERSION;
    }

    currentModel = ctx.model?.id ?? "unknown";
    userActiveSince = Date.now();
    const startType = sessionStartType(
      event.reason as SessionStartReason,
      ctx.sessionManager.getEntries().length > 0,
    );
    if (startType) {
      runtime.metrics.session.add(1, attrs({ start_type: startType, model: currentModel }));
    }

    // Publish every dashboard series immediately; zero-valued counters become nonzero only on observed activity.
    runtime.metrics.lines.add(0, attrs({ type: "added", model: currentModel }));
    runtime.metrics.lines.add(0, attrs({ type: "removed", model: currentModel }));
    runtime.metrics.pullRequest.add(0, attrs());
    runtime.metrics.commit.add(0, attrs());
    runtime.metrics.cost.add(0, attrs({ model: currentModel, query_source: "main" }));
    for (const type of ["input", "output", "cacheRead", "cacheCreation"]) {
      runtime.metrics.token.add(0, attrs({ model: currentModel, query_source: "main", type }));
    }
    runtime.metrics.codeEditDecision.add(
      0,
      attrs({ tool_name: "Edit", decision: "accept", source: "config", language: "unknown" }),
    );
    runtime.metrics.activeTime.add(0, attrs({ type: "user" }));
    runtime.metrics.activeTime.add(0, attrs({ type: "cli" }));
  });

  pi.on("model_select", async (event) => {
    currentModel = event.model.id;
  });

  pi.on("input", async () => {
    if (!runtime) return;
    if (userActiveSince !== undefined) {
      const elapsed = (Date.now() - userActiveSince) / 1_000;
      addActiveTime("user", Math.min(elapsed, MAX_USER_ACTIVE_GAP_SECONDS));
    }
    userActiveSince = undefined;
  });

  pi.on("agent_start", async () => {
    if (runtime && cliActiveSince === undefined) cliActiveSince = Date.now();
  });

  pi.on("agent_settled", async () => {
    if (!runtime) return;
    if (cliActiveSince !== undefined) {
      addActiveTime("cli", (Date.now() - cliActiveSince) / 1_000);
      cliActiveSince = undefined;
    }
    userActiveSince = Date.now();
  });

  pi.on("turn_end", async (event) => {
    if (!runtime || event.message.role !== "assistant") return;
    const message = event.message as typeof event.message & { usage?: Usage; model?: string };
    const usage = message.usage;
    if (!usage) return;

    const model = message.model ?? currentModel;
    const effort = pi.getThinkingLevel();
    const requestAttrs: Attributes = {
      model,
      query_source: "main",
      ...(effort === "off" ? {} : { effort }),
    };
    const tokenValues = [
      ["input", usage.input ?? 0],
      ["output", usage.output ?? 0],
      ["cacheRead", usage.cacheRead ?? 0],
      ["cacheCreation", usage.cacheWrite ?? 0],
    ] as const;
    for (const [type, value] of tokenValues) {
      if (value > 0) runtime.metrics.token.add(value, attrs({ ...requestAttrs, type }));
    }
    const cost = usage.cost?.total ?? 0;
    if (cost > 0) runtime.metrics.cost.add(cost, attrs(requestAttrs));
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!runtime) return;
    const toolName = event.toolName.toLowerCase();
    const input = event.input as { path?: unknown; command?: unknown };

    if (["edit", "write", "notebookedit"].includes(toolName) && typeof input.path === "string") {
      const path = resolve(ctx.cwd, input.path.replace(/^@/, ""));
      const before = await textFile(path);
      if (before !== undefined) {
        if ((pendingEdits.get(path) ?? 0) === 0) observedFiles.set(path, before);
        pendingEdits.set(path, (pendingEdits.get(path) ?? 0) + 1);
        editSnapshots.set(event.toolCallId, {
          path,
          language: languageForPath(path),
          model: currentModel,
        });
      }
    }

    if (toolName === "bash" && typeof input.command === "string") {
      bashSnapshots.set(event.toolCallId, {
        command: input.command,
        cwd: ctx.cwd,
        head: gitHead(ctx.cwd),
      });
    }
  });

  pi.on("tool_result", async (event) => {
    if (!runtime) return;
    const toolName = event.toolName.toLowerCase();
    const edit = editSnapshots.get(event.toolCallId);
    if (edit) {
      editSnapshots.delete(event.toolCallId);

      if (!event.isError) {
        const displayName =
          toolName === "notebookedit"
            ? "NotebookEdit"
            : `${toolName[0]?.toUpperCase()}${toolName.slice(1)}`;
        runtime.metrics.codeEditDecision.add(
          1,
          attrs({
            tool_name: displayName,
            decision: "accept",
            source: "config",
            language: edit.language,
          }),
        );

        const after = await textFile(edit.path);
        const before = observedFiles.get(edit.path);
        if (before !== undefined && after !== undefined) {
          const changed = changedLineCounts(before, after);
          observedFiles.set(edit.path, after);
          if (changed.added > 0) {
            runtime.metrics.lines.add(changed.added, attrs({ type: "added", model: edit.model }));
          }
          if (changed.removed > 0) {
            runtime.metrics.lines.add(
              changed.removed,
              attrs({ type: "removed", model: edit.model }),
            );
          }
        }
      }

      const remaining = (pendingEdits.get(edit.path) ?? 1) - 1;
      if (remaining > 0) pendingEdits.set(edit.path, remaining);
      else pendingEdits.delete(edit.path);
    }

    const bash = bashSnapshots.get(event.toolCallId);
    if (bash) {
      bashSnapshots.delete(event.toolCallId);
      if (createsGitCommit(bash.command)) {
        const afterHead = gitHead(bash.cwd);
        const commits = newCommits(bash.cwd, bash.head, afterHead).filter(
          (commit) => !seenCommits.has(commit),
        );
        for (const commit of commits) seenCommits.add(commit);
        if (commits.length > 0) runtime.metrics.commit.add(commits.length, attrs());
      }

      if (!event.isError) {
        const pullRequests = createdPullRequestCount(bash.command, outputText(event.content));
        if (pullRequests > 0) runtime.metrics.pullRequest.add(pullRequests, attrs());
      }
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (!runtime) return;
    if (cliActiveSince !== undefined) {
      addActiveTime("cli", (Date.now() - cliActiveSince) / 1_000);
      cliActiveSince = undefined;
    }
    if (userActiveSince !== undefined) {
      addActiveTime(
        "user",
        Math.min((Date.now() - userActiveSince) / 1_000, MAX_USER_ACTIVE_GAP_SECONDS),
      );
      userActiveSince = undefined;
    }
    try {
      await runtime.provider.forceFlush();
      await runtime.provider.shutdown();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) ctx.ui.notify(`OTEL metrics export failed: ${lastError}`, "warning");
    } finally {
      runtime = undefined;
    }
  });
}
