import fs from "node:fs/promises";
import path from "node:path";
import { archivedFile, workspaceStore } from "../../server/workspace.js";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const mime: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".md": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};
export async function GET(request: Request) {
  const file = archivedFile(
    workspaceStore(),
    new URL(request.url).searchParams.get("path"),
  );
  if (!file) return new Response("找不到归档文件。", { status: 404 });
  try {
    return new Response(await fs.readFile(file), {
      headers: {
        "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("找不到归档文件。", { status: 404 });
  }
}
