"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { DetailDialog, PromptButton } from "./ui";
import { MarkdownContent } from "./markdown-content";
import type { PrototypeDocumentPrompt } from "../lib/types";

export const fileUrl = (file: string) =>
  `/files/?path=${encodeURIComponent(file)}`;
export function EvidenceGallery({
  files,
}: {
  files: Array<{ path: string; label?: string; action?: string }>;
}) {
  return (
    <div className="evidence-gallery">
      {files.map((file, index) => (
        <DetailDialog
          key={`${file.path}:${index}`}
          title={file.label || file.path.split("/").pop() || "归档截图"}
          trigger={
            <button className="evidence-thumb">
              <img
                src={fileUrl(file.path)}
                alt={file.label || file.action || "归档截图"}
                loading="lazy"
              />
              <span>
                {file.label || file.action || file.path.split("/").pop()}
              </span>
            </button>
          }
        >
          <img
            className="full-image"
            src={fileUrl(file.path)}
            alt={file.label || file.path}
          />
        </DetailDialog>
      ))}
    </div>
  );
}
export function QuestionList({
  questions = [],
}: {
  questions?: Array<Record<string, any>>;
}) {
  if (!questions.length) return null;
  return (
    <section className="questions">
      <h2>待确认问题（{questions.length}）</h2>
      {questions.map((q) => (
        <article key={q.id} className="question-card">
          <h3>{q.title}</h3>
          <code>
            {q.id} · {q.location?.heading}
          </code>
          <p>问题：{q.question}</p>
          <p>影响：{q.impact}</p>
          <p>默认建议：{q.defaultDecision}</p>
          <p>需要确认：{q.owner}</p>
          <EvidenceGallery files={q.evidence || []} />
          <PromptButton
            label="复制定位提示词"
            prompt={
              q.agentPrompt ||
              `使用 mf-dev-flow 处理原型待确认问题：${q.id}。\nAgent 回答：<请在此填写>。`
            }
          />
          <p className="muted">
            复制后在“Agent 回答：”后补充回答。
          </p>
        </article>
      ))}
    </section>
  );
}
export function DocumentButton({
  title,
  content,
  label = "查看完整文档",
  assetBase,
  documentPath,
  questions,
  prototypePrompts,
}: {
  title: string;
  content?: string;
  label?: string;
  assetBase?: string;
  documentPath?: string;
  questions?: Array<Record<string, any>>;
  prototypePrompts?: PrototypeDocumentPrompt[];
}) {
  return (
    <DetailDialog
      title={title}
      trigger={<button className="button">{label}</button>}
    >
      <QuestionList questions={questions} />
      <MarkdownContent content={content} assetBase={assetBase} documentPath={documentPath} prototypePrompts={prototypePrompts} />
    </DetailDialog>
  );
}
export function ImagePreview({
  source,
  close,
}: {
  source: string | null;
  close: () => void;
}) {
  return (
    <Dialog.Root
      open={!!source}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay image-overlay" />
        <Dialog.Content className="dialog-content image-dialog">
          <header>
            <Dialog.Title>原型证据截图</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭大图">
              <X size={18} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            归档的原型证据截图
          </Dialog.Description>
          {source && (
            <img className="full-image" src={source} alt="原型证据截图" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
