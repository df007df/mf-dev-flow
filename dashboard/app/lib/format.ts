export function stamp(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

export function readable(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readable).join("\n");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return readable(
      item.note ??
        item.summary ??
        item.content ??
        item.text ??
        JSON.stringify(value),
    );
  }
  return String(value);
}

export function order<T extends { rank?: number; id: string }>(items: T[]) {
  return [...items].sort(
    (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.id.localeCompare(b.id),
  );
}

export function featurePrompt(feature: { id: string; title: string }) {
  return `使用 mf-dev-flow 更新功能演进地图。\n功能：${feature.id} · ${feature.title}。\n补充内容：<功能点疑问回答，或功能点补充说明>`;
}

export function developmentPrompt(feature: { id: string; title: string }) {
  return `使用 mf-dev-flow 完整开发功能点。\n功能：${feature.id} · ${feature.title}。\n默认流程：按功能点完整开发闭环执行。`;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    window.prompt("复制给 Agent 的执行提示词", value);
  }
}
