"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type ComponentPropsWithRef, type CSSProperties } from "react";
import { formatNumericDisplay, numericPaste } from "@/lib/numeric-input";

/** Keep the real number input, native validation, refs and form payload untouched.
 * A non-interactive presentation layer groups numbers only while not editing.
 */
export function NumberInput({ ref, style, className, onChange, onInput, onBlur, onWheel, onPaste, onCopy, onCut, ...props }: ComponentPropsWithRef<"input">) {
  const input = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState(String(props.defaultValue ?? ""));
  const [pasteError, setPasteError] = useState("");
  const display = formatNumericDisplay(props.value ?? raw);
  const { width, minWidth, maxWidth, flex, flexGrow, flexShrink, flexBasis, alignSelf, margin, marginTop, marginBottom, marginLeft, marginRight, display: layoutDisplay, ...controlStyle } = style ?? {};
  const layout: CSSProperties = { width, minWidth, maxWidth, flex, flexGrow, flexShrink, flexBasis, alignSelf, margin, marginTop, marginBottom, marginLeft, marginRight, display: layoutDisplay };

  useEffect(() => {
    const control = input.current;
    const sync = () => setRaw(control?.value ?? "");
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    // A trusted reset-button click can flush microtasks before its default
    // reset action. Read on the next task, after the browser resets values.
    const reset = () => { clearTimeout(resetTimer); resetTimer = setTimeout(sync, 0); };
    sync();
    control?.addEventListener("vetos:numeric-sync", sync);
    control?.form?.addEventListener("reset", reset);
    return () => {
      clearTimeout(resetTimer);
      control?.removeEventListener("vetos:numeric-sync", sync);
      control?.form?.removeEventListener("reset", reset);
    };
  }, []);

  const copyCanonical = (event: ClipboardEvent<HTMLInputElement>, cut = false) => {
    if (event.defaultPrevented) return;
    const selected = window.getSelection()?.toString() ?? "";
    // Preserve partial selections. Browsers without input selection support
    // keep native copy/cut; never guess that the whole value was selected.
    if (selected && event.currentTarget.value.includes(selected) && (!cut || document.queryCommandSupported?.("delete"))) {
      event.clipboardData.setData("text/plain", selected);
      event.clipboardData.setData("application/x-kamo-number", `canonical-v1:${selected}`);
      event.preventDefault();
      if (cut) document.execCommand("delete");
    }
  };

  // A dynamic employee field shares a renderer with text/date/identifier fields.
  if (props.type && props.type !== "number") return <input {...props} ref={ref} style={style} className={className}
    onChange={onChange} onInput={onInput} onBlur={onBlur} onWheel={onWheel} onPaste={onPaste} onCopy={onCopy} onCut={onCut} />;

  return <span className="numeric-field" style={layout} data-has-number={display !== "" || undefined}>
    <input {...props} type="number" inputMode={props.inputMode ?? "decimal"} className={className}
      style={controlStyle} ref={node => {
        input.current = node;
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      }}
      onInput={event => { setRaw(event.currentTarget.value); onInput?.(event); }}
      onChange={event => { setPasteError(""); setRaw(event.currentTarget.value); onChange?.(event); }}
      onBlur={event => { onBlur?.(event); setRaw(event.currentTarget.value); }}
      onWheel={event => { event.currentTarget.blur(); onWheel?.(event); }}
      onCopy={event => { onCopy?.(event); copyCanonical(event); }}
      onCut={event => { onCut?.(event); copyCanonical(event, true); }}
      onPaste={event => {
        onPaste?.(event);
        if (event.defaultPrevented || props.readOnly || props.disabled) return;
        const text = event.clipboardData.getData("text");
        const parsed = numericPaste(text, event.clipboardData.getData("application/x-kamo-number") === `canonical-v1:${text}`);
        if ("error" in parsed) { event.preventDefault(); setPasteError(parsed.error); return; }
        if (parsed.value === text) return; // native editing preserves caret/selection
        event.preventDefault();
        // Insert at the native caret/selection rather than replacing the field.
        if (!document.execCommand?.("insertText", false, parsed.value)) {
          setPasteError("Tempel angka tanpa pemisah ribuan; gunakan titik untuk desimal saat mengedit.");
        } else setPasteError("");
      }} />
    <span aria-hidden="true" className={`${className ?? ""} numeric-display`} style={controlStyle}
      data-number-display={props.name ?? props["aria-label"] ?? ""}>{display}</span>
    {pasteError && <span className="numeric-paste-error" role="alert">{pasteError}</span>}
  </span>;
}
