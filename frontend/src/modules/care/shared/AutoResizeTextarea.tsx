import { forwardRef, useCallback, useLayoutEffect, useRef } from "react";
import type { TextareaHTMLAttributes } from "react";

type AutoResizeTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const AutoResizeTextarea = forwardRef<HTMLTextAreaElement, AutoResizeTextareaProps>(
  function AutoResizeTextarea({ onInput, style, ...props }, forwardedRef) {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

    return (
      <textarea
        {...props}
        ref={setRef}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        style={{ ...style, overflowY: "hidden", resize: "none" }}
      />
    );
  },
);
