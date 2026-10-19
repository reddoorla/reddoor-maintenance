export interface Arm {
  id: string;
  model: string;
  effort?: string;
}
export const EFFORTS: readonly string[];
export function validateArm(arm: unknown, where?: string): string[];
export function validateArms(arms: unknown): string[];
export function armMarker(id: string): string;
export function refereeMarker(n: string): string;
export function readOnlyRules(dir: string): string;
