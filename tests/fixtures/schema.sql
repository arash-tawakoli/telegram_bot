create role anon;
create role authenticated;
create role service_role;
create schema pgmq;
create table public.bot_users(id uuid primary key, chat_id bigint, referral_bonus_until timestamptz, referral_bonus_days integer default 0, updated_at timestamptz);
create table public.search_profiles(id uuid primary key default gen_random_uuid(),user_id uuid references public.bot_users);
create table public.referrals(id uuid primary key default gen_random_uuid(),referred_user_id uuid unique references public.bot_users,referrer_user_id uuid references public.bot_users,status text,qualified_at timestamptz,rewarded_at timestamptz,premium_granted_until timestamptz);
create table public.source_jobs(id uuid primary key default gen_random_uuid(),queue_msg_id bigint unique,source_id smallint,status text default 'enqueued',attempts integer default 0,started_at timestamptz,updated_at timestamptz default now(),worker text,error_message text,finished_at timestamptz);
-- A minimal PGMQ interface fixture, not the extension itself.
create table pgmq.messages(msg_id bigint primary key,message jsonb,vt timestamptz default now(),archived boolean default false);
create function pgmq.read(q text, seconds integer, qty integer, headers jsonb) returns table(msg_id bigint,message jsonb) language sql as $$
 update pgmq.messages set vt=now()+make_interval(secs=>seconds) where messages.msg_id in (select m.msg_id from pgmq.messages m where not archived and vt<=now() order by m.msg_id limit qty) returning messages.msg_id,messages.message;
$$;
create function pgmq.archive(q text,id bigint) returns boolean language sql as $$update pgmq.messages set archived=true where msg_id=id returning true$$;
create function pgmq.set_vt(q text,id bigint,seconds integer) returns boolean language sql as $$update pgmq.messages set vt=now()+make_interval(secs=>seconds) where msg_id=id returning true$$;
