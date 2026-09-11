import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { EventEmitter } from "node:events";
import { isIP, isIPv4, isIPv6 } from "node:net";
import { buildSync } from "esbuild";
import { getFunctionName } from "convex/server";

// Dynamic Convex handler/validator boundary, not a replacement data model.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dynamic = any;
export type Fields = Record<string, Dynamic>;
export type Row = Fields & { _id: string; _creationTime: number };
type Handler = { _handler: (ctx: unknown, args: Fields) => Promise<Dynamic>; exportArgs: () => string; isMutation?: boolean; isQuery?: boolean; isAction?: boolean };
type Exported = Record<string, Handler>;
export type Trace = { at: number; name: string; args: Fields; result?: Dynamic; error?: string };
export const START = Date.UTC(2026, 8, 11, 12);
const requireActual = createRequire(import.meta.url);
const bundles = new Map<string, string>();
function valid(value: Dynamic, validator: Fields): boolean {
  switch (validator.type) {
    case "any": return true;
    case "null": return value === null;
    case "id": return typeof value === "string" && value.startsWith(`${validator.tableName}:`);
    case "literal": return value === validator.value;
    case "string": case "number": case "boolean": case "bigint": return typeof value === validator.type;
    case "bytes": return value instanceof ArrayBuffer;
    case "union": return validator.value.some((v: Fields) => valid(value, v));
    case "array": return Array.isArray(value) && value.every(v => valid(v, validator.value));
    case "record": return value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.entries(value).every(([key, v]) => valid(key, validator.keys) && valid(v, validator.values.fieldType));
    case "object": return value !== null && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).every(key => key in validator.value || value[key] === undefined) &&
      Object.entries(validator.value).every(([key, spec]) => {
        const field = spec as Fields;
        return value[key] === undefined ? field.optional === true : valid(value[key], field.fieldType);
      });
    default: assert.fail(`Unimplemented Convex validator ${validator.type}`);
  }
}
function source(name: string) {
  if (!bundles.has(name)) bundles.set(name, buildSync({
    entryPoints: [`convex/${name}.ts`], bundle: true, platform: "node",
    format: "cjs", external: ["@anthropic-ai/sdk", "openai", "zod", "convex/*", "@clerk/backend", "nodemailer", "imapflow", "mailparser"], write: false,
  }).outputFiles[0].text);
  return bundles.get(name)!;
}

/** Infrastructure only. Every function reference dispatches the actual
 * registered handler. Mutations are serializable with rollback; indexed
 * queries use the real schema's field ordering, never a canned result. */
export function corePipelineFixture(network: (url: URL, init: RequestInit, f: ReturnType<typeof corePipelineFixture>) => Promise<Response>) {
  let now = START, serial = 0;
  let mutationTail: Promise<unknown> = Promise.resolve();
  const tables: Record<string, Row[]> = { _scheduled_functions: [] };
  const modules = new Map<string, Exported>();
  const trace: Trace[] = [], logs: string[] = [], unexpected: string[] = [];
  const indexes: Record<string, Record<string, string[]>> = {};
  const stored = new Map<string, Blob>();
  const die = (message: string): never => { unexpected.push(message); throw new Error(message); };
  const transport: typeof fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : undefined;
    const url = new URL(request?.url ?? String(input));
    const options = request ? { method: request.method, headers: request.headers, body: await request.clone().text(), ...init } : init;
    trace.push({ at: now, name: "network", args: { url: url.href, method: options.method ?? "GET" } });
    try { return await network(url, options, api); }
    catch (error) { return die(`Unexpected/failed synthetic network ${url}: ${String(error)}`); }
  };
  function load(name: string): Exported {
    if (modules.has(name)) return modules.get(name)!;
    const runtime = { exports: {} as Exported };
    const localRequire = (id: string) => {
      if (["node:dns/promises", "dns/promises"].includes(id)) return {
        lookup: async (host: string) => {
          if (!/\.(example|example\.gov|example\.edu)$/.test(host)) die(`Unexpected DNS ${host}`);
          return [{ address: "93.184.216.34", family: 4 }];
        },
      };
      if (["node:https", "https"].includes(id)) return { request: (options: Fields, receive: (res: Dynamic) => void) => {
        const req = new EventEmitter() as Dynamic;
        req.setTimeout = () => req;
        req.destroy = (error: Error) => { req.emit("error", error); return req; };
        req.end = (body?: Buffer) => {
          void transport(`https://${options.hostname}${options.path}`, { method: options.method, headers: options.headers, body: body?.toString() })
            .then(async response => {
              const res = new EventEmitter() as Dynamic;
              res.statusCode = response.status;
              res.headers = Object.fromEntries(response.headers.entries());
              res.destroy = (error?: Error) => { if (error) res.emit("error", error); };
              receive(res);
              res.emit("data", Buffer.from(await response.arrayBuffer())); res.emit("end");
            }, error => req.emit("error", error));
        };
        return req;
      } };
      if (["net", "node:net"].includes(id)) return new Proxy({ isIP, isIPv4, isIPv6 }, { get: (target, key) => key in target ? target[key as keyof typeof target] : die(`Unapproved socket API ${String(key)}`) });
      if (["http", "node:http", "http2", "node:http2", "tls", "node:tls", "undici", "node:dns", "dns", "child_process", "node:child_process"].includes(id)) return new Proxy({}, { get: (_target, key) => die(`Unapproved network module ${id}.${String(key)}`) });
      return requireActual(id);
    };
    class ClockDate extends Date {
      constructor(...args: Dynamic[]) { super(...(args.length ? args : [now]) as [Dynamic]); }
      static now() { return now; }
    }
    runInNewContext(source(name), {
      module: runtime, exports: runtime.exports, require: localRequire,
      Date: ClockDate, URL, URLSearchParams, Buffer, TextEncoder, TextDecoder,
      Error, TypeError, RangeError, SyntaxError,
      Response, Request, Headers, AbortSignal, AbortController, Blob,
      fetch: transport, setTimeout, clearTimeout, structuredClone,
      console: Object.fromEntries(["log", "warn", "error", "info"].map(level => [level, (...values: unknown[]) => logs.push(values.map(String).join(" "))])),
      process: { env: { ANTHROPIC_API_KEY: "synthetic-only", OPENAI_API_KEY: "synthetic-only", DATAFORSEO_LOGIN: "synthetic-only", DATAFORSEO_PASSWORD: "synthetic-only" } },
    });
    modules.set(name, runtime.exports); return runtime.exports;
  }
  const schema = JSON.parse((load("schema").default as unknown as { export: () => string }).export());
  for (const table of schema.tables) {
    tables[table.tableName] = [];
    indexes[table.tableName] = Object.fromEntries(table.indexes.map((index: Fields) => [index.indexDescriptor, [...index.fields, "_creationTime"]]));
  }
  const get = (id: string) => Object.values(tables).flat().find(row => row._id === id) ?? null;
  const copy = <T>(value: T): T => structuredClone(value);
  const add = (table: string, values: Fields): string => {
    assert.ok(tables[table], `Unknown table ${table}`);
    const id = `${table}:${++serial}`;
    tables[table].push({ ...copy(values), _id: id, _creationTime: now }); return id;
  };
  const field = (row: Row, key: string) => key.split(".").reduce((value, part) => value?.[part], row as Dynamic);
  type Expr = (row: Row) => Dynamic;
  const expression = (value: Dynamic): Expr => typeof value === "function" ? value : () => value;
  const filterBuilder = {
    field: (key: string): Expr => row => field(row, key),
    eq: (a: Dynamic, b: Dynamic): Expr => row => expression(a)(row) === expression(b)(row),
    neq: (a: Dynamic, b: Dynamic): Expr => row => expression(a)(row) !== expression(b)(row),
    gt: (a: Dynamic, b: Dynamic): Expr => row => expression(a)(row) > expression(b)(row),
    gte: (a: Dynamic, b: Dynamic): Expr => row => expression(a)(row) >= expression(b)(row),
    lt: (a: Dynamic, b: Dynamic): Expr => row => expression(a)(row) < expression(b)(row),
    lte: (a: Dynamic, b: Dynamic): Expr => row => expression(a)(row) <= expression(b)(row),
    and: (...args: Dynamic[]): Expr => row => args.every(arg => expression(arg)(row)),
    or: (...args: Dynamic[]): Expr => row => args.some(arg => expression(arg)(row)),
    not: (arg: Dynamic): Expr => row => !expression(arg)(row),
  };
  const context: Dynamic = {
    auth: { getUserIdentity: async () => null },
    db: {
      system: { get: async (id: string) => copy(get(id)) },
      get: async (id: string) => copy(get(id)),
      normalizeId: (table: string, id: string) => id.startsWith(`${table}:`) ? id : null,
      insert: async (table: string, values: Fields) => add(table, values),
      patch: async (id: string, values: Fields) => {
        const row = get(id); assert.ok(row, `Missing patch ${id}`);
        for (const [key, value] of Object.entries(values)) {
          if (value === undefined) delete row[key]; else row[key] = copy(value);
        }
      },
      delete: async (id: string) => {
        const row = get(id); assert.ok(row, `Missing delete ${id}`);
        for (const rows of Object.values(tables)) if (rows.includes(row)) rows.splice(rows.indexOf(row), 1);
      },
      query: (table: string) => {
        assert.ok(tables[table], `Unknown table ${table}`);
        if (table === "provider_spend_approvals") die("Dormant all-in feature entered ordinary core test");
        const predicates: Expr[] = []; let sortFields = ["_creationTime"], direction = 1;
        const range: Dynamic = Object.fromEntries(["eq", "gt", "gte", "lt", "lte"].map(op => [op, (key: string, value: Dynamic) => {
          predicates.push(filterBuilder[op as "eq"](filterBuilder.field(key), value)); return range;
        }]));
        const rows = () => copy(tables[table].filter(row => predicates.every(p => p(row))).sort((a, b) => {
          for (const key of sortFields) { const x = field(a, key), y = field(b, key);
            if (x !== y) return direction * (x === undefined ? -1 : y === undefined ? 1 : x < y ? -1 : 1);
          }
          return direction * a._id.localeCompare(b._id, undefined, { numeric: true });
        }));
        const chain: Dynamic = {
          withIndex: (name: string, fn?: (q: Dynamic) => unknown) => {
            sortFields = name === "by_creation_time" ? ["_creationTime"] : indexes[table]?.[name];
            assert.ok(sortFields, `Unknown index ${table}.${name}`); fn?.(range); return chain;
          },
          filter: (fn: (q: typeof filterBuilder) => Expr) => { predicates.push(fn(filterBuilder)); return chain; },
          order: (order: string) => { direction = order === "desc" ? -1 : 1; return chain; },
          collect: async () => rows(), take: async (limit: number) => rows().slice(0, limit),
          first: async () => rows()[0] ?? null,
          unique: async () => { const found = rows(); assert.ok(found.length <= 1); return found[0] ?? null; },
          paginate: async ({ numItems, cursor }: { numItems: number; cursor?: string }) => {
            const found = rows(), offset = Number(cursor ?? 0); return { page: found.slice(offset, offset + numItems), isDone: offset + numItems >= found.length, continueCursor: String(offset + numItems) };
          },
          [Symbol.asyncIterator]: async function* () { yield* rows(); },
        }; return chain;
      },
    },
    storage: {
      store: async (blob: Blob) => { const id = `_storage:${++serial}`; stored.set(id, blob); return id; },
      getUrl: async (id: string) => { assert.ok(stored.has(id)); return `https://assets.example/${id}`; },
      get: async (id: string) => stored.get(id) ?? null,
    },
  };
  const schedule = (at: number, ref: Parameters<typeof getFunctionName>[0], args: Fields) =>
    add("_scheduled_functions", { at, name: getFunctionName(ref), args, state: { kind: "pending" } });
  context.scheduler = {
    runAfter: async (delay: number, ref: Parameters<typeof getFunctionName>[0], args: Fields) => schedule(now + delay, ref, args),
    runAt: async (at: number, ref: Parameters<typeof getFunctionName>[0], args: Fields) => schedule(Number(at), ref, args),
    cancel: async (id: string) => { const row = get(id); assert.ok(row); row.state = { kind: "canceled" }; },
  };
  const invoke = async (name: string, args: Fields) => {
    const [module, member] = name.split(":");
    const handler = load(module)[member]; assert.ok(handler?._handler, `Missing real handler ${name}`);
    assert.ok(valid(args, JSON.parse(handler.exportArgs())), `Arguments violate the real Convex validator: ${name}`);
    const item: Trace = { at: now, name, args: copy(args) }; trace.push(item);
    const execute = async () => {
      const before = handler.isMutation ? copy(tables) : undefined;
      try { const result = await handler._handler(context, copy(args)); item.result = copy(result); return copy(result); }
      catch (error) {
        if (before) for (const [table, rows] of Object.entries(before)) tables[table] = rows;
        item.error = String(error); throw error;
      }
    };
    if (!handler.isMutation) return execute();
    const pending = mutationTail.then(execute); mutationTail = pending.catch(() => {}); return pending;
  };
  for (const kind of ["runQuery", "runMutation", "runAction"]) context[kind] = (ref: Parameters<typeof getFunctionName>[0], args: Fields) => invoke(getFunctionName(ref), args);
  const api = { tables, trace, logs, unexpected, stored, add, get, invoke,
    now: () => now, setTime: (value: number) => { assert.ok(value >= now); now = value; },
    async runNextScheduled() {
      const next = tables._scheduled_functions.filter(row => row.state.kind === "pending" && row.at <= now).sort((a, b) => a.at - b.at || a._creationTime - b._creationTime)[0];
      if (!next) return null;
      next.state = { kind: "inProgress" };
      try { const result = await invoke(next.name, next.args); next.state = { kind: "success" }; return { name: next.name, result }; }
      catch (error) { next.state = { kind: "failed" }; throw error; }
    },
    assertOffline() { assert.deepEqual(unexpected, []); },
  };
  return api;
}
