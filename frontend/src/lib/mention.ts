import Mention from "@tiptap/extension-mention";

export interface MItem { id: string; title: string; type: string; }

function positionPopup(el: HTMLElement | null, rect: DOMRect | null | undefined) {
  if (!el || !rect) return;
  el.style.position = "fixed";
  el.style.left = `${rect.left}px`;
  el.style.top = `${rect.bottom + 4}px`;
}

// Extensão de menção "@" que sugere fichas e, ao inserir, chama onLink (linka cards).
export function mentionExtension(getItems: () => MItem[], onLink?: (id: string) => void) {
  return Mention.configure({
    HTMLAttributes: { class: "mention" },
    suggestion: {
      char: "@",
      items: ({ query }: { query: string }) =>
        getItems().filter((i) => i.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      command: ({ editor, range, props }: any) => {
        editor.chain().focus().insertContentAt(range, [
          { type: "mention", attrs: { id: props.id, label: props.label } },
          { type: "text", text: " " },
        ]).run();
        onLink?.(props.id);
      },
      render: () => {
        let el: HTMLDivElement | null = null;
        let items: MItem[] = [];
        let sel = 0;
        let cmd: ((p: { id: string; label: string }) => void) | null = null;
        const paint = () => {
          if (!el) return;
          el.innerHTML = items.length
            ? items.map((it, i) => `<div class="mention-item${i === sel ? " sel" : ""}" data-i="${i}">${it.title}</div>`).join("")
            : `<div class="mention-empty">nenhuma ficha</div>`;
        };
        return {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onStart: (props: any) => {
            items = props.items; cmd = props.command; sel = 0;
            el = document.createElement("div");
            el.className = "mention-popup";
            document.body.appendChild(el);
            el.addEventListener("mousedown", (ev) => {
              const t = (ev.target as HTMLElement).closest("[data-i]") as HTMLElement | null;
              if (t && cmd) { ev.preventDefault(); const it = items[Number(t.dataset.i)]; cmd({ id: it.id, label: it.title }); }
            });
            positionPopup(el, props.clientRect?.()); paint();
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onUpdate: (props: any) => { items = props.items; cmd = props.command; sel = 0; positionPopup(el, props.clientRect?.()); paint(); },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onKeyDown: (props: any) => {
            const k = props.event.key as string;
            if (!items.length) return k === "Escape";
            if (k === "ArrowDown") { sel = (sel + 1) % items.length; paint(); return true; }
            if (k === "ArrowUp") { sel = (sel - 1 + items.length) % items.length; paint(); return true; }
            if (k === "Enter") { if (cmd) cmd({ id: items[sel].id, label: items[sel].title }); return true; }
            if (k === "Escape") return true;
            return false;
          },
          onExit: () => { el?.remove(); el = null; },
        };
      },
    },
  });
}
