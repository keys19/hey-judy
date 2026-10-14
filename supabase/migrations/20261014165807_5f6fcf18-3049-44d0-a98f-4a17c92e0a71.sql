-- Admin role system
create type public.app_role as enum ('admin');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;

alter table public.user_roles enable row level security;

create policy "Users can read their own roles"
  on public.user_roles for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

-- Bootstrap: grant admin to the single existing registered account
insert into public.user_roles (user_id, role)
select id, 'admin' from auth.users order by created_at limit 1;

-- Agent configurations (versioned)
create table public.agent_configurations (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null check (agent_name in ('reader','analyzer','checker')),
  version integer not null default 1,
  system_prompt text not null,
  skills_manual text not null default '',
  model text not null default 'claude-sonnet-5-5',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (agent_name, version)
);

grant select, insert, update on public.agent_configurations to authenticated;
grant all on public.agent_configurations to service_role;

alter table public.agent_configurations enable row level security;

create policy "Signed-in users can read agent configurations"
  on public.agent_configurations for select to authenticated
  using (true);

create policy "Admins can insert agent configurations"
  on public.agent_configurations for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

create policy "Admins can update agent configurations"
  on public.agent_configurations for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

create policy "Admins can delete agent configurations"
  on public.agent_configurations for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Pipeline runs
create table public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'running' check (status in ('running','completed','needs_review','failed')),
  input_text text not null,
  final_report jsonb,
  validation jsonb,
  error text,
  duration_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.pipeline_runs to authenticated;
grant all on public.pipeline_runs to service_role;

alter table public.pipeline_runs enable row level security;

create policy "Users manage their own pipeline runs"
  on public.pipeline_runs for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index idx_pipeline_runs_user on public.pipeline_runs (user_id, created_at desc);

-- Pipeline stages
create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.pipeline_runs(id) on delete cascade,
  stage text not null,
  attempt integer not null default 1,
  status text not null,
  model text,
  output jsonb,
  trace jsonb,
  validation jsonb,
  tokens_in integer,
  tokens_out integer,
  tool_calls integer,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);

grant select, insert on public.pipeline_stages to authenticated;
grant all on public.pipeline_stages to service_role;

alter table public.pipeline_stages enable row level security;

create policy "Users can view stage records of their own runs"
  on public.pipeline_stages for select to authenticated
  using (exists (
    select 1 from public.pipeline_runs r
    where r.id = run_id and r.user_id = auth.uid()
  ));

create policy "Users can insert stage records for their own runs"
  on public.pipeline_stages for insert to authenticated
  with check (exists (
    select 1 from public.pipeline_runs r
    where r.id = run_id and r.user_id = auth.uid()
  ));

create index idx_pipeline_stages_run on public.pipeline_stages (run_id, created_at);

-- updated_at trigger
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

create trigger trg_pipeline_runs_updated_at
  before update on public.pipeline_runs
  for each row execute function public.update_updated_at_column();