import { extname } from "node:path";
import { diffLines } from "diff";

export type SessionStartReason = "startup" | "reload" | "new" | "resume" | "fork";

export function resolveMetricsEndpoint(baseEndpoint: string, metricsEndpoint?: string): string {
  if (metricsEndpoint) return metricsEndpoint;
  const normalized = baseEndpoint.replace(/\/+$/, "");
  return normalized.endsWith("/v1/metrics") ? normalized : `${normalized}/v1/metrics`;
}

export function sessionStartType(
  reason: SessionStartReason,
  hasExistingEntries: boolean,
): "fresh" | "resume" | "continue" | undefined {
  if (reason === "reload") return undefined;
  if (reason === "resume") return "resume";
  if (reason === "fork") return "continue";
  if (reason === "new") return "fresh";
  return hasExistingEntries ? "continue" : "fresh";
}

function countLines(value: string): number {
  if (!value) return 0;
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.length;
}

export function changedLineCounts(
  before: string,
  after: string,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;

  for (const change of diffLines(before, after)) {
    if (change.added) added += countLines(change.value);
    if (change.removed) removed += countLines(change.value);
  }

  return { added, removed };
}

const LANGUAGES: Record<string, string> = {
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".go": "Go",
  ".h": "C",
  ".hpp": "C++",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".json": "JSON",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".scala": "Scala",
  ".sh": "Shell",
  ".sql": "SQL",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".xml": "XML",
  ".yaml": "YAML",
  ".yml": "YAML",
};

export function languageForPath(path: string): string {
  return LANGUAGES[extname(path).toLowerCase()] ?? "unknown";
}

const SHELL_SEGMENT_START = String.raw`(?:^|[;&|()]\s*)`;
const PR_URL = /https?:\/\/[^\s]+\/(?:pull|merge_requests)\/\d+/g;
const PR_CREATE_COMMAND = new RegExp(
  `${SHELL_SEGMENT_START}(?:gh\\s+pr\\s+create|glab\\s+mr\\s+create)(?:\\s|$)`,
);
const GIT_COMMIT_COMMAND = new RegExp(
  `${SHELL_SEGMENT_START}git(?:\\s+-[A-Za-z][^\\s]*)*\\s+commit(?:\\s|$)`,
);

export function createdPullRequestCount(command: string, output: string): number {
  if (!PR_CREATE_COMMAND.test(command) || /(?:^|\s)--dry-run(?:\s|$)/.test(command)) return 0;
  return new Set(output.match(PR_URL) ?? []).size;
}

export function createsGitCommit(command: string): boolean {
  return GIT_COMMIT_COMMAND.test(command) && !/(?:^|\s)--dry-run(?:\s|$)/.test(command);
}

function decodeHeaderPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  return Object.fromEntries(
    raw
      .split(",")
      .map((pair) => pair.trim())
      .filter(Boolean)
      .flatMap((pair) => {
        const separator = pair.indexOf("=");
        return separator > 0
          ? [
              [
                decodeHeaderPart(pair.slice(0, separator).trim()),
                decodeHeaderPart(pair.slice(separator + 1).trim()),
              ],
            ]
          : [];
      }),
  );
}

export function parseResourceAttributes(raw: string | undefined): Record<string, string> {
  return parseHeaders(raw);
}
