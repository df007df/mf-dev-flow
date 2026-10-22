"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Sparkles, X } from "lucide-react";
import { useLayoutEffect, useState, type ReactNode } from "react";
import { copyText } from "../lib/format";

export function Badge({ status, label }: { status?: string; label?: string }) {
  const tone = ["done", "completed", "confirmed", "passed", "covered"].includes(
    String(status).toLowerCase(),
  )
    ? "done"
    : status === "blocked" || status === "failed"
      ? "blocked"
      : status === "in_progress"
        ? "progress"
        : "pending";
  return <span className={`badge ${tone}`}>{label || status || "未验证"}</span>;
}

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section-card">
      <header className="section-head">
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function PromptButton({
  label = "复制提示词",
  prompt,
  primary = false,
}: {
  label?: string;
  prompt: string;
  primary?: boolean;
}) {
  return (
    <DetailDialog
      title={label}
      variant="prompt"
      trigger={
        <button
          type="button"
          className={`button ai-prompt-button${primary ? " primary" : ""}`}
          aria-label={label}
          title={`${label}（查看提示词）`}
        >
          <Sparkles size={18} aria-hidden="true" />
        </button>
      }
    >
      <p className="muted">确认提示词内容后复制，再交给 Agent 执行。</p>
      <pre className="prompt-preview" tabIndex={0}>{prompt}</pre>
      <div className="actions">
        <CopyButton label="复制提示词" text={prompt} />
      </div>
    </DetailDialog>
  );
}

export function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="button"
      aria-label={label}
      title={copied ? `已复制 · ${label}` : label}
      onClick={async () => {
        await copyText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      <span aria-hidden="true">{copied ? <Check size={15} /> : <Copy size={15} />}</span>
      <span>{copied ? "已复制" : label}</span>
      <span className="sr-only" role="status">{copied ? "已复制" : ""}</span>
    </button>
  );
}

export function DetailDialog({
  title,
  trigger,
  children,
  variant = "default",
}: {
  title: string;
  trigger: ReactNode;
  children: ReactNode;
  variant?: "default" | "prompt";
}) {
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    if (!open || variant !== "prompt") return;
    // Own Escape before document-level Radix listeners: during rapid nested
    // opening the underlying dialog's layer listener may still be active.
    const dismissPrompt = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", dismissPrompt, true);
    return () => window.removeEventListener("keydown", dismissPrompt, true);
  }, [open, variant]);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={`dialog-overlay${variant === "prompt" ? " prompt-overlay" : ""}`} />
        <Dialog.Content
          className={`dialog-content${variant === "prompt" ? " prompt-dialog" : ""}`}
        >
          <header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="关闭">
              <X size={18} />
            </Dialog.Close>
          </header>
          <Dialog.Description className="sr-only">
            {title}的完整内容与证据
          </Dialog.Description>
          <div className="dialog-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
