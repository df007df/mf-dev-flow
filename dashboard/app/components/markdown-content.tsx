"use client";

import { marked } from "marked";
import DOMPurify from "dompurify";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ImagePreview, fileUrl } from "./documents";
import { documentAssetUrl, isArchiveImage } from "../lib/document-assets.mjs";
import { PromptButton } from "./ui";
import type { PrototypeDocumentPrompt, SystemDocumentPrompt } from "../lib/types";

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ] ?? character,
  );

function upgradeLegacyEdgeEvidenceTables(target: HTMLDivElement) {
  for (const list of target.querySelectorAll("ul")) {
    const items = [...list.children].filter(
      (element): element is HTMLLIElement => element instanceof HTMLLIElement,
    );
    if (!items.length) continue;
    const records = items.map((item) => {
      const links = [...item.querySelectorAll("a")];
      const screenshot = links.find((link) =>
        isArchiveImage(link.getAttribute("href") ?? ""),
      );
      const trace = links.find((link) => link !== screenshot);
      const detail = (item.textContent ?? "")
        .replace(/\s*截图\s*·\s*追踪\s*·\s*/, "；复现：")
        .replace(/\s+/g, " ")
        .trim();
      return { screenshot, trace, detail };
    });
    // Legacy v1 lists are converted only when every item is an evidence row.
    // Mixed lists can contain unresolved edges and must keep their original text.
    if (!records.every(({ screenshot }) => screenshot)) continue;
    const table = document.createElement("table");
    table.className = "edge-evidence-table";
    const header = table.createTHead().insertRow();
    for (const label of ["截图", "操作与结果", "证据"])
      header.insertCell().textContent = label;
    const body = table.createTBody();
    for (const { screenshot, trace, detail } of records) {
      const row = body.insertRow();
      const screenshotCell = row.insertCell();
      const image = document.createElement("img");
      image.src = screenshot!.getAttribute("href") ?? "";
      const edgeId = detail.match(/\bedge-[\w-]+/)?.[0];
      image.alt = edgeId ? `${edgeId} 截图` : "边操作截图";
      image.loading = "lazy";
      screenshotCell.append(image);
      row.insertCell().textContent = detail;
      const evidenceCell = row.insertCell();
      const evidenceId = detail.match(/\bevidence-[\w-]+/)?.[0];
      if (evidenceId) evidenceCell.append(document.createTextNode(`${evidenceId} · `));
      if (trace) {
        const traceLink = trace.cloneNode(true) as HTMLAnchorElement;
        traceLink.textContent = "查看追踪";
        evidenceCell.append(traceLink);
      }
    }
    list.replaceWith(table);
  }
}

export function MarkdownContent({
  content = "",
  assetBase,
  documentPath,
  prototypePrompts,
  systemPrompt,
  archiveImageLinks = "all",
  renderLegacyEdgeEvidenceTables = false,
}: {
  content?: string;
  assetBase?: string;
  documentPath?: string;
  prototypePrompts?: PrototypeDocumentPrompt[];
  systemPrompt?: SystemDocumentPrompt;
  archiveImageLinks?: "all" | "explicit-only";
  renderLegacyEdgeEvidenceTables?: boolean;
}) {
  const reader = useRef<HTMLDivElement>(null);
  const [headings, setHeadings] = useState<
    Array<{ id: string; text: string; level: number }>
  >([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [promptSlots, setPromptSlots] = useState<Array<{
    key: string; target: HTMLElement; label: string; prompt: string;
  }>>([]);
  // Polling returns new objects on every refresh. Equal prompt content must
  // not replace DOM slots or close an open prompt dialog.
  const promptSignature = JSON.stringify(prototypePrompts ?? []);
  const systemPromptSignature = JSON.stringify(systemPrompt ?? null);
  useEffect(() => {
    const target = reader.current;
    if (!target) return;
    let cancelled = false;
    const renderer = new marked.Renderer();
    const assetUrl = (href: string) => documentAssetUrl(href, { documentPath, assetBase });
    renderer.html = ({ text }) => escapeHtml(text);
    renderer.code = ({ text, lang }) =>
      lang === "mermaid"
        ? `<pre class="mermaid">${escapeHtml(text)}</pre>`
        : `<pre><code>${escapeHtml(text)}</code></pre>`;
    renderer.image = ({ href, text }) => {
      const source = assetUrl(href);
      return source?.startsWith("/files")
        ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(text)}" loading="lazy" />`
        : escapeHtml(text);
    };
    target.innerHTML = DOMPurify.sanitize(
      marked.parse(content, { gfm: true, renderer }) as string,
    );
    target.querySelectorAll("a").forEach((a) => {
      const source = assetUrl(a.getAttribute("href") ?? "");
      if (!source) { a.removeAttribute("href"); return; }
      a.setAttribute("href", source);
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (
        isArchiveImage(source)
        && !a.querySelector("img")
        && archiveImageLinks === "all"
      ) {
        const img = document.createElement("img");
        img.src = source;
        img.alt = a.textContent || "归档截图";
        img.loading = "lazy";
        a.append(img);
      }
    });
    if (renderLegacyEdgeEvidenceTables)
      upgradeLegacyEdgeEvidenceTables(target);
    if (assetBase)
      target.querySelectorAll("td").forEach((cell) => {
        let directory = "";
        const plain = cell.cloneNode(true) as HTMLElement;
        plain.querySelectorAll("a,img").forEach((element) => element.remove());
        const files = (
          plain.textContent?.match(
            /(?:screenshots\/)?[^\s、`|]+?\.(?:gif|jpe?g|png|svg|webp)/gi,
          ) || []
        ).flatMap((value) => {
          if (value.startsWith("screenshots/"))
            directory = value.slice(0, value.lastIndexOf("/"));
          const relative = value.startsWith("screenshots/")
            ? value
            : directory
              ? `${directory}/${value}`
              : "";
          return relative && !relative.split("/").includes("..")
            ? [relative]
            : [];
        });
        [...new Set(files)].forEach((file) => {
          const img = document.createElement("img");
          img.src = fileUrl(`${assetBase}/${file}`);
          img.alt = file;
          img.loading = "lazy";
          cell.append(img);
        });
      });
    setHeadings(
      [...target.querySelectorAll("h1,h2,h3,h4")].map((h, i) => {
        h.id = `document-heading-${i}`;
        return {
          id: h.id,
          text: h.textContent || "",
          level: Number(h.tagName.slice(1)),
        };
      }),
    );
    const groupPrompts: PrototypeDocumentPrompt[] = JSON.parse(promptSignature);
    const byGroup = new Map(groupPrompts.map((group) => [group.groupId, group]));
    const slots: typeof promptSlots = [];
    let group: PrototypeDocumentPrompt | undefined;
    for (const element of target.children) {
      // Bind only explicit stable IDs from the canonical document. Never infer
      // ownership from a repeated heading/title or add actions to other docs.
      if (element.tagName === "H1") group = undefined;
      if (element.tagName === "UL") {
        const identity = [...element.querySelectorAll("li")].find((item) =>
          item.textContent?.trim().startsWith("分组 ID："),
        );
        if (identity) group = byGroup.get(identity.querySelector("code")?.textContent || "");
      }
      if (!group) continue;
      const title = element.textContent?.trim() || "";
      const kind = element.tagName === "H2" && /^待确认问题(?:[（(].*[）)])?$/.test(title)
        ? "answer"
        : element.tagName === "H3" && title === "信息补充" ? "supplement" : null;
      if (!kind) continue;
      const slot = document.createElement("span");
      slot.className = "document-prompt-action";
      slot.dataset.groupId = group.groupId;
      slot.dataset.promptKind = kind;
      element.classList.add("document-action-heading");
      element.append(slot);
      slots.push({
        key: `${group.groupId}:${kind}`, target: slot,
        label: `${kind === "answer" ? "问题回答" : "信息补充"} · ${group.groupTitle}`,
        prompt: group[kind],
      });
    }
    const system: SystemDocumentPrompt | null = JSON.parse(systemPromptSignature);
    // Only the explicitly selected system card may own this action. Historical
    // documents and other Markdown with the same heading get no controls.
    const identity = [...target.querySelectorAll("blockquote")].find((element) =>
      element.textContent?.trim().startsWith("系统卡片 ID："),
    )?.querySelector("code")?.textContent;
    if (system && identity === system.cardId) {
      const heading = [...target.children].find((element) =>
        element.tagName === "H2" && element.textContent?.trim() === "待确认问题",
      );
      if (heading) {
        const slot = document.createElement("span");
        slot.className = "document-prompt-action";
        slot.dataset.cardId = system.cardId;
        slot.dataset.promptKind = "system-answer";
        heading.classList.add("document-action-heading");
        heading.append(slot);
        slots.push({
          key: `system:${system.cardId}:answer`, target: slot,
          label: `统一回答系统问题 · ${system.cardTitle}`,
          prompt: system.answer,
        });
      }
    }
    setPromptSlots(slots);
    const diagrams = target.querySelectorAll<HTMLElement>("pre.mermaid");
    if (diagrams.length)
      void import("mermaid")
        .then(async ({ default: mermaid }) => {
          if (cancelled) return;
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: "neutral",
          });
          await mermaid.run({ nodes: diagrams, suppressErrors: true });
        })
        .catch(() => {
          /* Preserve source if rendering fails. */
        });
    return () => {
      cancelled = true;
    };
  }, [content, assetBase, documentPath, promptSignature, systemPromptSignature, archiveImageLinks, renderLegacyEdgeEvidenceTables]);
  return (
    <div className="document-layout">
      <div
        ref={reader}
        className="markdown"
        onClick={(event) => {
          const target = event.target;
          if (target instanceof HTMLImageElement && target.src) {
            event.preventDefault();
            setPreview(target.src);
          }
        }}
      />
      {promptSlots.map((slot) => createPortal(
        <PromptButton label={slot.label} prompt={slot.prompt} />,
        slot.target,
        slot.key,
      ))}
      <nav className="document-toc" aria-label="文档目录">
        <strong>文档目录</strong>
        {headings.map((h) => (
          <button
            key={h.id}
            style={{ paddingLeft: (h.level - 1) * 10 }}
            onClick={() =>
              reader.current
                ?.querySelector(`#${h.id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          >
            {h.text}
          </button>
        ))}
      </nav>
      <ImagePreview source={preview} close={() => setPreview(null)} />
    </div>
  );
}
