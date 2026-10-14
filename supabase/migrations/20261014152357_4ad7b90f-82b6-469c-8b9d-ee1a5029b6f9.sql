CREATE TABLE public.agent_sdk_test_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.agent_sdk_test_memories TO authenticated;
GRANT ALL ON public.agent_sdk_test_memories TO service_role;
ALTER TABLE public.agent_sdk_test_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own select" ON public.agent_sdk_test_memories FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own insert" ON public.agent_sdk_test_memories FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own delete" ON public.agent_sdk_test_memories FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX ON public.agent_sdk_test_memories (user_id, created_at);