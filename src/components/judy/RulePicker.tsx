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

  const customRule = rules.find((r) => r.code === "custom" && r.active);

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
        <h3 className="text-lg font-bold">My own rule</h3>
        {customRule ? (
          <div className="mt-2 flex items-start gap-3">
            <p className="flex-1 text-lg">{customRule.text}</p>
            <button
              type="button"
              aria-label="Remove my own rule"
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-[#5E6272] hover:bg-judy-canvas"
              onClick={() => void setRule("custom", customRule.text, false)}
            >
              <Trash2 size={22} />
            </button>
          </div>
        ) : (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const text = custom.trim();
              if (!text) return;
              void setRule("custom", text.slice(0, 200), true).then(() => setCustom(""));
            }}
          >
            <label className="sr-only" htmlFor="custom-rule">
              Write your own rule
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
              className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-full bg-judy-primary text-white"
            >
              <Plus size={24} />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
