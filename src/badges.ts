import type { SessionView } from "./aggregate.js";
import { badgeColor, badgeText } from "./badge.js";
import { setStatus } from "./cmux.js";
import { addCost, zeroCost } from "./cost.js";
import type { Config } from "./config.js";
import type { CostResult } from "./types.js";

export interface WorkspaceBadge {
  workspaceId: string;
  text: string;
  color: string;
}

/**
 * Sum cost per cmux workspace and format a badge for each. Pure — only sessions
 * carrying a workspace id contribute (sessions with an unknown workspace can't
 * be placed on a cmux badge).
 */
export function workspaceBadges(views: SessionView[], cfg: Config): WorkspaceBadge[] {
  const map = new Map<string, CostResult>();
  for (const v of views) {
    const id = v.workspace?.id;
    if (!id) continue;
    map.set(id, addCost(map.get(id) ?? zeroCost(), v.cost));
  }
  return [...map.entries()].map(([workspaceId, cost]) => ({
    workspaceId,
    text: badgeText(cost, cfg.currency),
    color: badgeColor(cost, cfg),
  }));
}

/**
 * Best-effort: (re)apply every workspace's cost badge in cmux. Badges are
 * runtime state cmux drops when it is killed, so this is what makes costs show
 * up again as soon as cmux relaunches (the dock control calls it on startup).
 */
export function pushWorkspaceBadges(views: SessionView[], cfg: Config): void {
  for (const b of workspaceBadges(views, cfg)) {
    setStatus("cost", b.text, {
      workspace: b.workspaceId,
      icon: "dollarsign",
      color: b.color,
    });
  }
}
