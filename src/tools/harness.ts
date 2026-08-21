import { z } from "zod";
import { ValidationError } from "../types.js";

/**
 * Fake server + fake client for the tool tests, so the handlers run with no
 * network and no McpServer. Every client method resolves with the shared
 * `{ data, cost }` envelope; `throwOn` makes one method reject the way the
 * real client would.
 */

type Args = Record<string, unknown>;
export type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

export interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolConfig {
  title?: string;
  description?: string;
  annotations?: Annotations;
  inputSchema?: z.ZodRawShape;
}

export const COST = { actualQueryCost: 10, currentlyAvailable: 1500, maximumAvailable: 2000, restoreRate: 100 };

export interface Harness {
  calls: { method: string; params: unknown[] }[];
  configs: Record<string, ToolConfig>;
  tools: Record<string, Handler>;
}

/**
 * Builds the harness for one register function. `methods` maps client method
 * names to the data their fake resolves with.
 */
export function harness(
  register: (server: unknown, client: unknown) => void,
  methods: Record<string, unknown>,
  opts: { throwOn?: string } = {},
): Harness {
  const calls: { method: string; params: unknown[] }[] = [];
  const client: Record<string, unknown> = {};
  for (const [method, data] of Object.entries(methods)) {
    client[method] = async (...params: unknown[]) => {
      calls.push({ method, params });
      if (opts.throwOn === method) throw new ValidationError(`${method} отклонён`);
      return { data, cost: COST };
    };
  }
  const configs: Record<string, ToolConfig> = {};
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, cfg: ToolConfig, handler: Handler) => {
      configs[name] = cfg;
      tools[name] = handler;
    },
  };
  register(server, client);
  return { calls, configs, tools };
}
