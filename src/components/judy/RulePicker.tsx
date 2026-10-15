import { useEffect, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { db, errorText, type Rule, type RuleTemplate } from "@/lib/judy-db";
import { inputCls } from "./ui";

// The person's own rules (boundaries). Judy's Analyzer reads the active ones on
// every check. Changes save straight away.
export function RulePicker({
  userId,
  seedDefaults = false,
}: {
  userId: string;
  seedDefaults?: boolean;
}) {
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [custom, setCustom] = useState("");

  const load = async () => {
    const [t, r] = await Promise.all([
      db.from("rule_templates").select("code, text, default_on, sort").order("sort"),
      db.from("rules").select("id, code, text, active").eq("user_id", userId),
    ]);
    if (t.error) throw t.error;
    if (r.error) throw r.error;
    let mine = (r.data ?? []) as Rule[];
    const tpl = (t.data ?? []) as RuleTemplate[];
    if (seedDefaults && mine.length === 0) {
      const rows = tpl
        .filter((x) => x.default_on)
        .map((x) => ({ user_id: userId, code: x.code, text: x.text, active: true }));
      if (rows.length) {
        const ins = await db
          .from("rules")
          .upsert(rows, { onConflict: "user_id,code" })
          .select("id, code, text, active");
        if (ins.error) throw ins.error;
        mine = (ins.data ?? []) as Rule[];
      }
    }
    setTemplates(tpl);
    setRules(mine);
  };

  useEffect(() => {
    load()
      .catch((e) => toast.error("Could not load your rules: " + errorText(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const isOn = (code: string) => rules.some((r) => r.code === code && r.active);

  const setRule = async (code: string, text: string, active: boolean) => {
    const prev = rules;
    const existing = rules.find((r) => r.code === code);
    setRules(
      existing
        ? rules.map((r) => (r.code === code ? { ...r, active, text } : r))
        : [...rules, { id: "tmp-" + code, code, text, active }],
    );
    const { data, error } = await db
      .from("rules")
      .upsert({ user_id: userId, code, text, active }, { onConflict: "user_id,code" })
      .select("id, code, text, active")
      .single();
    if (error) {
      setRules(prev);
      toast.error("Could not save that rule: " + error.message);
      return;
    }
    setRules((rs) => rs.map((r) => (r.code === code ? (data as Rule) : r)));
  };

  // Your own rules: as many as you like. Each gets its own code (custom_…).
  const ownRules = rules.filter((r) => r.code.startsWith("custom") && r.active);
  const addOwn = async (text: string) => {
    const code = "custom_" + Date.now().toString(36);
    await setRule(code, text, true);
  };
  const removeOwn = async (r: Rule) => {
    const prev = rules;
    setRules((rs) => rs.filter((x) => x.id !== r.id));
    const { error } = await db.from("rules").delete().eq("id", r.id);
    if (error) {
      setRules(prev);
      toast.error("Could not remove that rule: " + error.message);
    }
  };

  if (loading) return <p className="px-1 text-lg text-[#5E6272]">Loading your rules…</p>;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {templates.map((t) => {
          const on = isOn(t.code);
          return (
            <li key={t.code}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => void setRule(t.code, t.text, !on)}
                className={
                  "flex min-h-14 w-full items-center gap-4 rounded-2xl border-2 px-4 py-3 text-left text-lg transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-judy-primary/30 " +
                  (on ? "border-judy-primary bg-white" : "border-transparent bg-white/70")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 " +
                    (on
                      ? "border-judy-primary bg-judy-primary text-white"
                      : "border-[#9A9AA6] bg-white")
                  }
                >
                  {on && <Check size={20} strokeWidth={3} />}
                </span>
                <span className="text-judy-ink">{t.text}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="rounded-2xl bg-white p-4">
        <h3 className="text-lg font-bold">My own rules</h3>
        {ownRules.length > 0 && (
          <ul className="mt-2 space-y-2">
            {ownRules.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-xl bg-judy-canvas px-3 py-2">
                <Check size={20} className="mt-1 shrink-0 text-judy-primary" aria-hidden="true" />
                <p className="flex-1 text-lg">{r.text}</p>
                <button
                  type="button"
                  aria-label={`Remove rule: ${r.text}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[#5E6272] hover:bg-white"
                  onClick={() => void removeOwn(r)}
                >
                  <Trash2 size={22} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const text = custom.trim();
            if (!text) return;
            setCustom("");
            void addOwn(text.slice(0, 200));
          }}
        >
          <label className="sr-only" htmlFor="custom-rule">
            Write a new rule of your own
          </label>
          <input
            id="custom-rule"
            className={inputCls}
            placeholder="For example: I don't lend my phone"
            value={custom}
            maxLength={200}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button
            type="submit"
            aria-label="Add rule"
            disabled={!custom.trim()}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-judy-primary text-white disabled:opacity-40"
          >
            <Plus size={24} />
          </button>
        </form>
      </div>
    </div>
  );
}
