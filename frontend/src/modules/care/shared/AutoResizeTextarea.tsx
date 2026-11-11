import { ChevronDown, List, ListOrdered } from "lucide-react";
import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, MouseEvent, TextareaHTMLAttributes } from "react";
import { BTN_GHOST, INPUT } from "./styles";
import { continueListOnEnter, formatSelectedLines, type ListKind } from "./textLists";

/** The one text-area look, taken from the intake: square, full width up to 4xl. */
export const TEXTAREA = `${INPUT} !rounded-none w-full`;

type AutoResizeTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** A bare growing field with the caller's own styling and no list toolbar —
   * only for a message bar like the psychotherapy chat composer. */
  plain?: boolean;
};

/** Writes a value the way typing does, so the caller's onChange sees it. */
function typeValue(textarea: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
    textarea,
    value,
  );
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function placeCaret(textarea: HTMLTextAreaElement, start: number, end: number) {
  requestAnimationFrame(() => {
    textarea.focus();
    textarea.setSelectionRange(start, end);
  });
}

/**
 * Every text area in the system: grows with its content, the intake's look, and
 * on focus a bulleted / numbered list toolbar (Enter continues a list).
 */
export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  function AutoResizeTextarea(
    { onInput, onKeyDown, style, className = "", plain = false, ...props },
    forwardedRef,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [active, setActive] = useState(false);

    const resize = useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = "auto";
      const styles = window.getComputedStyle(textarea);
      const borders =
        (Number.parseFloat(styles.borderTopWidth) || 0) +
        (Number.parseFloat(styles.borderBottomWidth) || 0);
      textarea.style.height = `${textarea.scrollHeight + borders}px`;
    }, []);

    const setRef = useCallback(
      (textarea: HTMLTextAreaElement | null) => {
        textareaRef.current = textarea;
        if (typeof forwardedRef === "function") forwardedRef(textarea);
        else if (forwardedRef) forwardedRef.current = textarea;
      },
      [forwardedRef],
    );

    useLayoutEffect(() => {
      resize();
    });

    useLayoutEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea || typeof ResizeObserver === "undefined") return;

      let width = textarea.getBoundingClientRect().width;
      const observer = new ResizeObserver(([entry]) => {
        if (entry && entry.contentRect.width !== width) {
          width = entry.contentRect.width;
          resize();
        }
      });
      observer.observe(textarea);
      return () => observer.disconnect();
    }, [resize]);

    const editable = !props.disabled && !props.readOnly;

    const applyList = (kind: ListKind) => {
      const textarea = textareaRef.current;
      if (!textarea || !editable) return;
      const result = formatSelectedLines(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
        kind,
      );
      typeValue(textarea, result.value);
      placeCaret(textarea, result.selectionStart, result.selectionEnd);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event);
      if (plain || event.defaultPrevented || event.key !== "Enter") return;
      if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const textarea = event.currentTarget;
      const result = continueListOnEnter(
        textarea.value,
        textarea.selectionStart,
        textarea.selectionEnd,
      );
      if (!result) return;
      event.preventDefault();
      typeValue(textarea, result.value);
      placeCaret(textarea, result.selectionStart, result.selectionEnd);
    };

    const field = (
      <textarea
        {...props}
        ref={setRef}
        className={plain ? className : `${TEXTAREA} ${className}`}
        onKeyDown={handleKeyDown}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        style={{ ...style, overflowY: "hidden", resize: "none" }}
      />
    );
    if (plain) return field;

    const keepSelection = (event: MouseEvent<HTMLButtonElement>) => event.preventDefault();
    const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      setActive(false);
    };

    return (
      <div
        className="flex w-full max-w-4xl flex-col items-start gap-1"
        onFocusCapture={() => setActive(true)}
        onBlurCapture={handleBlur}
      >
        {active && editable && (
          <div role="toolbar" aria-label="Text list formatting" className="flex items-center gap-1">
            <button
              type="button"
              className={`${BTN_GHOST} !min-h-8 !gap-1 !px-2 !py-1`}
              aria-label="Toggle bulleted list"
              title="Toggle bulleted list"
              onMouseDown={keepSelection}
              onClick={() => applyList("bullet")}
            >
              <List aria-hidden="true" className="h-4 w-4" />
              <ChevronDown aria-hidden="true" className="h-3 w-3" />
            </button>
            <button
              type="button"
              className={`${BTN_GHOST} !min-h-8 !gap-1 !px-2 !py-1`}
              aria-label="Toggle numbered list"
              title="Toggle numbered list"
              onMouseDown={keepSelection}
              onClick={() => applyList("numbered")}
            >
              <ListOrdered aria-hidden="true" className="h-4 w-4" />
              <ChevronDown aria-hidden="true" className="h-3 w-3" />
            </button>
          </div>
        )}
        {field}
      </div>
    );
  },
);
