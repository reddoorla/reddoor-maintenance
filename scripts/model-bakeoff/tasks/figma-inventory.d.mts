import type { Arm } from "../lib/arms.mjs";
import type { Collection } from "../lib/score.mjs";
export const id: string;
export const title: string;
export const row: number;
export const sources: { from: string; match: RegExp; to: string }[];
export const collections: Collection[];
export const kinds: { layer: (value: unknown) => string };
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const arms: Arm[];
export const gold: Arm;
export function prompt(dir: string): string;
export function layerName(name: unknown): string;
export type MetaNode = {
  type: string;
  id: string;
  name: string;
  height: number;
  hidden: boolean;
  children: MetaNode[];
};
export function parseMetadata(xml: string): MetaNode;
export type JsxNode =
  { text: string } | { tag: string; attrs: Record<string, unknown>; children: JsxNode[] };
export function parseJsx(src: string): JsxNode[];
export function parseDesignContext(code: string): {
  assets: Record<string, string>;
  components: Record<string, JsxNode>;
  main: string;
};
export type Slice = {
  id: string;
  name: string;
  type: string;
  height: number;
  texts: number;
  images: number;
  instances: string[];
};
export type Field = { id: string; slice: string; tag: string; text: string; href: string };
export function inventory(
  metadata: unknown,
  designContext: unknown,
): { slices: Slice[]; fields: Field[] };
export function truth(dir: string): { slices: Slice[]; fields: Field[] };
