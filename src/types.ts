/** Token usage counters, summed across messages. */
export interface Usage {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

/** Per-token price in USD for one model. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Result of costing a usage bundle. `cost` is always the sum of the *known*
 * model costs (a real number, a lower bound). `partial` is true when at least
 * one model's price could not be resolved, so the UI can show e.g. "$1.20+"
 * instead of fabricating an exact figure.
 */
export interface CostResult {
  usage: Usage;
  tokens: number;
  cost: number;
  partial: boolean;
  unknownModels: string[];
}

/** A Claude account = one config dir (e.g. ~/.claude-talabat) and its label. */
export interface Account {
  dir: string; // absolute path to the config dir (NOT the projects subdir)
  label: string; // human label shown in the report, e.g. "Talabat"
}

/** A cmux workspace a session ran in. */
export interface Workspace {
  id: string; // CMUX_WORKSPACE_ID (UUID)
  title: string; // e.g. "[Talabat] Flutter App"
}

/** A single agent transcript (main session or one subagent/teammate). */
export interface Transcript {
  /** session id (main) or agent id (teammate) */
  id: string;
  path: string;
  /** teammate's handle, when known (e.g. "dbg-auth") — the Agent `name`/self-intro */
  name?: string;
  /** teammate's role/type (e.g. "debugger") — the key for the by-agent global view */
  agentType?: string;
  /** human label — for teammates, "[handle] (type) task" or the task alone */
  label?: string;
  byModel: Map<string, Usage>;
}

/** A session = its main transcript plus any subagent transcripts. */
export interface Session {
  id: string;
  account: Account; // which Claude account this session belongs to
  project: string;
  mainPath: string;
  main: Transcript;
  teammates: Transcript[];
  /** most recent activity timestamp (epoch ms), 0 if unknown */
  lastActivity: number;
}

export function emptyUsage(): Usage {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 };
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreation: a.cacheCreation + b.cacheCreation,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

export function totalTokens(u: Usage): number {
  return u.input + u.output + u.cacheCreation + u.cacheRead;
}
