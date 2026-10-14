import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { judyTurnFn } from "@/lib/judy.functions";
import { getThreadsFn } from "@/lib/pipeline.functions";
import type { ImageInput } from "@/lib/pipeline/judy";

// Developer panel to try judyTurn end to end before the real screens exist.
// Not part of the final app.
async function shrink(file: File): Promise<ImageInput> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const el = new Image();
      el.onload = () => ok(el);
      el.onerror = () => bad(new Error("not an image"));
      el.src = url;
    });
    const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = c.toDataURL("image/jpeg", 0.85);
    return { media_type: "image/jpeg", data: d.slice(d.indexOf(",") + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function JudyTurnTest() {
  const turn = useServerFn(judyTurnFn);
  const listThreads = useServerFn(getThreadsFn);
  const [threads, setThreads] = useState<{ id: string; nickname: string }[]>([]);
  const [threadId, setThreadId] = useState("");
  const [text, setText] = useState("");
  const [image, setImage] = useState<ImageInput | null>(null);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState("");
  useEffect(() => {
    Promise.resolve()
      .then(() => listThreads())
      .then((rows) => setThreads(Array.isArray(rows) ? rows : []))
      .catch(() => setThreads([]));
  }, [listThreads]);
  const go = async (action: "start" | "answer" | "share") => {
    setBusy(true);
    setOut("Working… (a check takes about 20–40 seconds)");
    try {
      const result = await turn({
        data: {
          threadId,
          runId: crypto.randomUUID(),
          action,
          ...(text.trim() ? { text } : {}),
          ...(action === "share" && image ? { image } : {}),
        },
      });
      setOut(JSON.stringify(result, null, 2));
      setText("");
    } catch (e) {
      setOut("Error: " + String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="m-4 space-y-3 rounded-lg border p-4" aria-label="Judy chat test">
      <h2 className="text-lg font-semibold">Judy chat test (judyTurn)</h2>
      <p className="text-sm text-muted-foreground">
        Start → answer the 3 questions → share. Results are saved to messages, checks and threads.
      </p>
      <select
        aria-label="Friend"
        className="block rounded border p-2 text-sm"
        value={threadId}
        onChange={(e) => setThreadId(e.target.value)}
      >
        <option value="">Choose a friend…</option>
        {threads.map((t) => (
          <option key={t.id} value={t.id}>
            {t.nickname}
          </option>
        ))}
      </select>
      <Textarea
        aria-label="Message or answer"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Your answer, or a message to check"
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Screenshot"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return setImage(null);
          shrink(f)
            .then(setImage)
            .catch((err) => setOut("Could not read image: " + String(err)));
        }}
      />
      <div className="flex gap-2">
        <Button disabled={busy || !threadId} onClick={() => void go("start")}>
          Start
        </Button>
        <Button disabled={busy || !threadId || !text.trim()} onClick={() => void go("answer")}>
          Answer
        </Button>
        <Button
          disabled={busy || !threadId || (!text.trim() && !image)}
          onClick={() => void go("share")}
        >
          Share to check
        </Button>
      </div>
      {out && <pre className="max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{out}</pre>}
    </section>
  );
}
