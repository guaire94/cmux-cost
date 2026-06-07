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

/** Result of costing a usage bundle. `cost` is null when any model price is missing. */
export interface CostResult {
  usage: Usage;
  tokens: number;
  cost: number | null;
  unknownModels: string[];
}

/** A single agent transcript (main session or one subagent/teammate). */
export interface Transcript {
  /** session id (main) or agent id (teammate) */
  id: string;
  path: string;
  /** human label — for teammates, derived from the first task prompt */
  label?: string;
  byModel: Map<string, Usage>;
}

/** A session = its main transcript plus any subagent transcripts. */
export interface Session {
  id: string;
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
