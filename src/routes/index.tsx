import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { runAgent, type AgentResult } from "@/lib/agent.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Claude SDK Agent Test" },
      { name: "description", content: "Test bench for Claude Tool Runner agents with Supabase memory." },
      { property: "og:title", content: "Claude SDK Agent Test" },
      { property: "og:description", content: "Test bench for Claude Tool Runner agents with Supabase memory." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

const TESTS = [
  { label: "Test 1 — Write", prompt: "Remember my safety rule: Never transfer money to an unfamiliar account.", expect: ["save_user_memory"] },
  { label: "Test 2 — Read", prompt: "What safety rules have I saved?", expect: ["get_user_memories"] },
  {
    label: "Test 3 — Multi-step",
    prompt: "Remember that I will never share verification codes. Then retrieve all my saved safety rules and explain how they could help protect me from scams.",
    expect: ["save_user_memory", "get_user_memories"],
  },
];

function Index() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!ready) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <h1 className="font-mono text-sm font-semibold">Claude Client SDK · Agent Capability Test</h1>
        {session && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {session.user.email}
            <Button size="sm" variant="outline" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          </div>
        )}
      </header>
      {session ? <Dashboard userId={session.user.id} /> : <Login />}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const go = async (mode: "in" | "up") => {
    setMsg(null);
    const { error } = mode === "in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setMsg(error ? error.message : mode === "up" ? "Account created. Confirm via email if required, then sign in." : null);
  };
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-3 px-6">
      <h2 className="text-lg font-semibold">Sign in to run the test</h2>
      <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div className="flex gap-2">
        <Button onClick={() => go("in")}>Sign in</Button>
        <Button variant="outline" onClick={() => go("up")}>Sign up</Button>
      </div>
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
    </div>
  );
}

type Chat = { role: "user" | "assistant" | "error"; text: string };
type Mem = { id: string; content: string; created_at: string };

function Dashboard({ userId }: { userId: string }) {
  const run = useServerFn(runAgent);
  const [prompt, setPrompt] = useState("");
  const [chat, setChat] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [expected, setExpected] = useState<string[] | null>(null);
  const [mems, setMems] = useState<Mem[]>([]);

  const loadMems = useCallback(async () => {
    const { data } = await supabase.from("agent_sdk_test_memories").select("id, content, created_at").eq("user_id", userId).order("created_at");
    setMems(data ?? []);
  }, [userId]);
  useEffect(() => { loadMems(); }, [loadMems]);

  const send = async (text: string, expect: string[] | null = null) => {
    if (!text.trim() || loading) return;
    setChat((c) => [...c, { role: "user", text }]);
    setPrompt(""); setLoading(true); setExpected(expect); setResult(null);
    try {
      const r = (await run({ data: { prompt: text } })) as AgentResult;
      setResult(r);
      setChat((c) => [...c, r.error ? { role: "error", text: r.error } : { role: "assistant", text: r.finalText || "(no text)" }]);
      if (r.stats.toolExecutions) loadMems();
    } catch (e) {
      setChat((c) => [...c, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally { setLoading(false); }
  };

  const called = result?.trace.filter((e) => e.kind === "tool_call").map((e) => String(e.data["tool"])) ?? [];
  const missing = expected?.filter((t) => !called.includes(t)) ?? [];

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-4">
        <section className="rounded-lg border p-4">
          <h2 className="mb-3 text-sm font-semibold">A. Agent Chat</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {TESTS.map((t) => (
              <Button key={t.label} size="sm" variant="secondary" disabled={loading} onClick={() => send(t.prompt, t.expect)}>{t.label}</Button>
            ))}
          </div>
          <div className="mb-3 max-h-96 space-y-2 overflow-auto">
            {chat.map((m, i) => (
              <div key={i} className={`whitespace-pre-wrap rounded-md p-2 text-sm ${m.role === "user" ? "bg-muted" : m.role === "error" ? "bg-destructive/10 text-destructive" : "border"}`}>
                <span className="mr-2 font-mono text-xs uppercase text-muted-foreground">{m.role}</span>{m.text}
              </div>
            ))}
            {loading && <p className="text-sm text-muted-foreground">Agent running…</p>}
          </div>
          <div className="flex gap-2">
            <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask the agent…" />
            <Button disabled={loading} onClick={() => send(prompt)}>Send</Button>
          </div>
        </section>
        <section className="rounded-lg border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">B. Saved Memories (Supabase)</h2>
            <Button size="sm" variant="ghost" onClick={loadMems}>Refresh</Button>
          </div>
          {mems.length === 0 ? <p className="text-sm text-muted-foreground">No rules saved yet.</p> : (
            <ul className="space-y-1 text-sm">
              {mems.map((m) => <li key={m.id} className="rounded border px-2 py-1">{m.content}<span className="ml-2 font-mono text-xs text-muted-foreground">{new Date(m.created_at).toLocaleString()}</span></li>)}
            </ul>
          )}
        </section>
      </div>
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-sm font-semibold">C. Agent Execution Trace</h2>
        {!result ? <p className="text-sm text-muted-foreground">Run a prompt to see the real SDK trace.</p> : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-4">
              <Stat k="Model turns" v={result.stats.modelTurns} />
              <Stat k="Tool runs" v={result.stats.toolExecutions} />
              <Stat k="Tokens in/out" v={`${result.stats.inputTokens}/${result.stats.outputTokens}`} />
              <Stat k="Duration" v={`${result.stats.durationMs}ms`} />
              <Stat k="Stop reason" v={result.stats.stopReason ?? "—"} />
              <Stat k="Finished" v={result.error ? "error" : result.stats.finishedNormally ? "normally" : result.stats.hitIterationLimit ? "iteration limit" : "other"} />
            </div>
            {expected && (
              <p className={`mb-3 rounded p-2 text-xs ${missing.length ? "bg-destructive/10 text-destructive" : "bg-muted"}`}>
                Expected tools: {expected.join(", ")} · Called: {called.join(", ") || "none"}
                {missing.length ? ` · NOT called: ${missing.join(", ")}` : " · ✓ all expected tools called"}
              </p>
            )}
            <ol className="space-y-2">
              {result.trace.map((e, i) => (
                <li key={i} className="rounded border p-2 font-mono text-xs">
                  <div className="mb-1 flex justify-between"><span className="font-semibold">{e.kind}</span><span className="text-muted-foreground">+{e.t}ms</span></div>
                  <pre className="whitespace-pre-wrap break-all text-muted-foreground">{JSON.stringify(e.data, null, 2)}</pre>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string | number }) {
  return <div className="rounded bg-muted p-2"><div className="text-muted-foreground">{k}</div><div>{v}</div></div>;
}
