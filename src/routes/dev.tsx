import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PipelineTest } from "@/components/pipeline/PipelineTest";
import { JudyTurnTest } from "@/components/pipeline/JudyTurnTest";

export const Route = createFileRoute("/dev")({
  head: () => ({
    meta: [
      { title: "Developer tests · Hey Judy" },
      { name: "description", content: "Developer tools for the Judy conversation and three-agent pipeline." },
      { property: "og:title", content: "Developer tests · Hey Judy" },
      { property: "og:description", content: "Developer tools for the Judy conversation and three-agent pipeline." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

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
        <h1 className="font-mono text-sm font-semibold">Judy · Agent developer tools</h1>
        {session && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {session.user.email}
            <Button size="sm" variant="outline" onClick={() => supabase.auth.signOut()}>Sign out</Button>
          </div>
        )}
      </header>
      {session ? <><JudyTurnTest key={"judy-" + session.user.id} /><PipelineTest key={session.user.id} /></> : <Login />}
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
