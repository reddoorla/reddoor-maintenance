export const BLOCK: number;
export const SIMPLE_LIMIT: number;
export const CHUNK: number;
export const ENV_VARS: string[];
export const MAX_ATTEMPTS: number;
export const USAGE: string;

export interface HeadersLike {
  get(name: string): string | null;
}

export interface ResponseLike {
  status: number;
  headers?: HeadersLike;
  text(): Promise<string>;
}

export interface RequestInitLike {
  method: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;

export interface Deps {
  fetch: FetchLike;
  env: Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>;
}

export interface Account {
  name?: { display_name?: string };
  email?: string;
  team?: { name?: string };
  root_info?: { root_namespace_id?: string; home_namespace_id?: string };
}

export interface Ctx extends Deps {
  token: string;
  root: string;
  account: Account;
}

export type Options =
  | { cmd: "check" }
  | { cmd: "upload"; folder: string; files: string[]; overwrite: boolean }
  | { cmd: "close-request"; ids: string[] }
  | { cmd: "hash"; files: string[] };

export interface UploadResult {
  local: string;
  path: string;
  size: number;
  remoteSize: number | undefined;
  localHash: string;
  remoteHash: string | undefined;
  ok: boolean;
}

export interface CloseResult {
  id: string;
  title: string | undefined;
  is_open: boolean | undefined;
  ok: boolean;
}

export class DropboxError extends Error {
  constructor(endpoint: string, status: number, body: unknown);
  endpoint: string;
  status: number;
  body: unknown;
  scope: string | null;
}

export function missingScope(body: unknown): string | null;
export function parseArgs(argv: string[]): Options;
export function contentHash(buf: Uint8Array): string;
export function contentHashFile(path: string): Promise<string>;
export function headerJson(value: unknown): string;
export function dropboxPath(folder: string, file: string): string;
export function missingEnv(env: Record<string, string | undefined>): string[];
export function rootHeader(rootNamespaceId: string): string;
export function mintToken(deps: Deps): Promise<string>;
export function connect(deps: Deps): Promise<Ctx>;
export function rpc(ctx: Ctx, endpoint: string, arg: unknown): Promise<unknown>;
export function contentCall(
  ctx: Ctx,
  endpoint: string,
  arg: unknown,
  data: Uint8Array,
): Promise<unknown>;
export function uploadFile(
  ctx: Ctx,
  local: string,
  folder: string,
  opts?: { overwrite?: boolean; simpleLimit?: number; chunk?: number },
): Promise<UploadResult>;
export function closeRequest(ctx: Ctx, id: string): Promise<CloseResult>;
export function run(o: Options, deps: Deps): Promise<{ code: number; lines: string[] }>;
export function proxyReexecEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> | null;
