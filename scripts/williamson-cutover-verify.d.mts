export type SiteKey = "homes" | "construction";

export interface Site {
  key: SiteKey;
  label: string;
  apex: string;
  www: string;
  preview: string;
  netlifyId: string;
  paths: string[];
  mx: string[];
  txt: string[];
}

export const SITES: Record<SiteKey, Site>;
export const NETLIFY_APEX_IP: string;
export const MAX_HOPS: number;

export type RecordType = "MX" | "TXT";

export interface Resolver {
  name: string;
  url(name: string, type: RecordType): string;
}

export const RESOLVERS: Resolver[];

export interface Options {
  sites: SiteKey[];
  preview: boolean;
}

export interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  body?: { cancel(): Promise<void> } | null;
}

export type FetchLike = (
  url: string,
  init: { redirect: "manual"; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<ResponseLike>;

export interface Deps {
  fetch?: FetchLike;
  concurrency?: number;
  timeoutMs?: number;
}

export interface Hop {
  url: string;
  status: number;
  server: string | null;
  location: string | null;
}

export interface PageResult {
  kind: "page";
  site: SiteKey;
  url: string;
  ok: boolean;
  problems: string[];
  hops: Hop[];
}

export interface DnsResult {
  kind: "mx" | "txt";
  site: SiteKey;
  resolver: string;
  ok: boolean;
  problems: string[];
  got: string[];
}

export type CheckResult = PageResult | DnsResult;

export interface VerifyResult {
  ok: boolean;
  code: number;
  lines: string[];
  results: CheckResult[];
}

export function parseArgs(argv: string[]): Options;
export function proxyReexecEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> | null;
export function transportLine(env: Record<string, string | undefined>): string;
export function hostsFor(site: Site, preview: boolean): string[];
export function normMx(data: string): string;
export function normTxt(data: string): string;
export function checkPage(
  site: Site,
  host: string,
  path: string,
  allowed: string[],
  deps?: Deps,
): Promise<PageResult>;
export function checkDns(site: Site, deps?: Deps): Promise<DnsResult[]>;
export function verify(o: Options, deps?: Deps): Promise<VerifyResult>;
