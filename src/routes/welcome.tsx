import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppFrame, Orb, PrimaryButton, SecondaryButton, inputCls } from "@/components/judy/ui";

export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ title: "Welcome · Hey Judy" }] }),
  component: Welcome,
});

function Welcome() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"intro" | "in" | "up">("intro");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        void navigate({ to: "/" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) void navigate({ to: "/" });
        else setMsg("Account made. Check your email to confirm it, then sign in.");
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppFrame className="px-6 py-10">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Orb mood="neutral" size={mode === "intro" ? 130 : 96} />
        <h1 className="mt-4 text-3xl font-bold">Hi, I'm Judy</h1>
        <p className="mt-3 text-xl text-[#3F4454]">
          Not sure about a message from someone? Ask me. I'll help you spot warning signs.
        </p>
        {mode === "intro" ? (
          <ol className="mt-6 w-full space-y-3 text-left">
            {[
              "Judy helps you check people you talk to online.",
              "You can ask Judy before you decide what to do.",
              "Judy is an AI helper, not a person. It can make mistakes.",
            ].map((t, i) => (
              <li
                key={i}
                className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-lg shadow-sm"
              >
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-judy-primary font-bold text-judy-primary"
                >
                  {i + 1}
                </span>
                {t}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-lg">
            I'm an <strong>AI helper, not a person</strong>. You always decide what to do.
          </p>
        )}
      </div>

      {mode === "intro" ? (
        <div className="mt-8 space-y-3">
          <PrimaryButton onClick={() => setMode("up")}>Get started</PrimaryButton>
          <SecondaryButton onClick={() => setMode("in")}>I already have an account</SecondaryButton>
          <p className="pt-2 text-center text-base text-[#5E6272]">
            Are you someone's trusted person? Make an account too, then tap “I'm here as someone's
            trusted person”.
          </p>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="mt-8 space-y-3"
          aria-label={mode === "in" ? "Sign in" : "Create account"}
        >
          <h2 className="text-2xl font-bold">{mode === "in" ? "Sign in" : "Make your account"}</h2>
          <label className="block">
            <span className="mb-1 block text-lg font-bold">Email</span>
            <input
              className={inputCls}
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-lg font-bold">Password</span>
            <input
              className={inputCls}
              type="password"
              autoComplete={mode === "in" ? "current-password" : "new-password"}
              minLength={6}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {msg && (
            <p role="status" className="rounded-2xl bg-white px-4 py-3 text-lg">
              {msg}
            </p>
          )}
          <PrimaryButton type="submit" disabled={busy}>
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Make account"}
          </PrimaryButton>
          <SecondaryButton onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "I need a new account" : "I already have an account"}
          </SecondaryButton>
        </form>
      )}
    </AppFrame>
  );
}
