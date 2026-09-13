import type { Report } from "./types";

// Preserve the persisted numeric contract while distinguishing "not enough
// evidence to score" from a genuine zero. Legacy reports keep their score.
export function reportHasUsableScore(report: Report): boolean {
  return !(report.dimensions.length === 5 && report.dimensions.every((dimension) => dimension.summary.trimStart().startsWith("信息不足：")));
}
