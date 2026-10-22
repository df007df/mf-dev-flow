import { graphImpact, graphSnapshot, graphSvg } from "../../../server/readers/graph.js";
import { workspaceStore } from "../../../server/workspace.js";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 只读接口：snapshot / ?impact=<seeds>&direction= / ?svg=<focus>&depth=
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const store = workspaceStore();
    const impact = url.searchParams.get("impact");
    if (impact) {
      const seeds = impact.split(",").map((item) => item.trim()).filter(Boolean);
      if (!seeds.length) return Response.json({ error: "impact 需要至少一个 ref" }, { status: 400 });
      const direction = url.searchParams.get("direction") === "sources" ? "sources" : "dependents";
      return Response.json(graphImpact(store, { seeds, direction }), { headers: { "Cache-Control": "no-store" } });
    }
    const focus = url.searchParams.get("svg");
    if (focus) {
      const svg = graphSvg(store, { focus, depth: url.searchParams.get("depth") ?? "3" });
      return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" } });
    }
    return Response.json(graphSnapshot(store), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: String((error as Error)?.message ?? error).slice(0, 300) }, { status: 500 });
  }
}
