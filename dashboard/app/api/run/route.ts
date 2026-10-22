import { runDetail } from "../../../server/state.js";
import { workspaceStore } from "../../../server/workspace.js";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get("type"),
    id = params.get("id");
  if (!type || !id || !/^[\p{L}\p{N}_-]+$/u.test(id))
    return Response.json({ error: "运行参数无效。" }, { status: 400 });
  const detail = runDetail(workspaceStore(), type, id);
  return Response.json(detail ?? { error: "找不到运行记录。" }, {
    status: detail ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
