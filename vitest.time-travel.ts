import { vi } from "vitest";

export const TIME_TRAVEL_FAKES = ["Date"] as const;

export function installTimeTravel(days: number): Date {
  const target = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  vi.useFakeTimers({ toFake: [...TIME_TRAVEL_FAKES], shouldAdvanceTime: true });
  vi.setSystemTime(target);
  return target;
}
