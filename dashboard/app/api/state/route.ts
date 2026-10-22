import { dashboardState } from "../../../server/state.js";
import { workspaceStore } from "../../../server/workspace.js";
import { ENVIRONMENT } from "../../../../modules/skill-identity.mjs";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const stateCache = { at: 0, value: undefined as ReturnType<typeof dashboardState> | undefined };
export function GET(request: Request) {
  try {
    const force = new URL(request.url).searchParams.get("fresh") === "1";
    const now = Date.now();
    if (!force && stateCache.value && now - stateCache.at < 5000)
      return Response.json(stateCache.value, { headers: { "Cache-Control": "no-store" } });
    const value = dashboardState(workspaceStore());
    stateCache.at = Date.now();
    stateCache.value = value;
    return Response.json(value, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      {
        error: `无法读取工作区，请检查 ${ENVIRONMENT.WORKSPACE_ROOT} 和项目初始化状态。`,
      },
      { status: 500 },
    );
  }
}
