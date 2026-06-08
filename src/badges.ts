import type { SessionView } from "./aggregate.js";
import { badgeColor, badgeText } from "./badge.js";
import { setStatus } from "./cmux.js";
import type { Config } from "./config.js";

export interface WorkspaceBadge {
  workspaceId: string;
  text: string;
  color: string;
}

/**
 * One badge per cmux workspace, showing its MOST RECENT session's cost — the
 * same number the `Stop` hook would have set (budget colours are tuned per
 * session, so summing the workspace's whole history would just paint everything
 * red). Only sessions carrying a workspace id can be placed on a cmux badge.
 */
export function workspaceBadges(views: SessionView[], cfg: Config): WorkspaceBadge[] {
  const latest = new Map<string, SessionView>();
  for (const v of views) {
    const id = v.workspace?.id;
    if (!id) continue;
    const cur = latest.get(id);
    if (!cur || v.lastActivity > cur.lastActivity) latest.set(id, v);
  }
  return [...latest.entries()].map(([workspaceId, v]) => ({
    workspaceId,
    text: badgeText(v.cost, cfg.currency),
    color: badgeColor(v.cost, cfg),
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
