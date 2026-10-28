-- Этап 1. Применяется в Supabase SQL Editor или через supabase db push.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (length(display_name) <= 100),
  created_at timestamptz not null default now()
);
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','adult','child')),
  child_can_edit boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key(family_id,user_id)
);
create index family_members_user_idx on public.family_members(user_id);
create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  token_hash text not null unique,
  role text not null check (role in ('adult','child')),
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index family_invitations_family_idx on public.family_invitations(family_id);
create table public.family_preferences (
  family_id uuid not null,
  user_id uuid not null,
  preferences jsonb not null default '{}'::jsonb check(jsonb_typeof(preferences)='object'),
  updated_at timestamptz not null default now(),
  primary key(family_id,user_id),
  foreign key(family_id,user_id) references public.family_members(family_id,user_id) on delete cascade
);
create table public.family_activity (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  created_at timestamptz not null default now()
);
create index family_activity_family_created_idx on public.family_activity(family_id,created_at desc);

create function public.is_family_member(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.family_members where family_id=p_family and user_id=auth.uid());
$$;
create function public.is_family_owner(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.family_members where family_id=p_family and user_id=auth.uid() and role='owner');
$$;
create function public.can_edit_family(p_family uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.family_members where family_id=p_family and user_id=auth.uid() and (role in ('owner','adult') or child_can_edit));
$$;
alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invitations enable row level security;
alter table public.family_preferences enable row level security;
alter table public.family_activity enable row level security;
create policy profiles_read on public.profiles for select to authenticated using (
 id=auth.uid() or exists(select 1 from public.family_members m where m.user_id=profiles.id and public.is_family_member(m.family_id))
);
create policy profiles_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy families_read on public.families for select to authenticated using(public.is_family_member(id));
create policy members_read on public.family_members for select to authenticated using(public.is_family_member(family_id));
create policy preferences_read on public.family_preferences for select to authenticated using(user_id=auth.uid() and public.is_family_member(family_id));
create policy preferences_insert on public.family_preferences for insert to authenticated with check(user_id=auth.uid() and public.is_family_member(family_id));
create policy preferences_update on public.family_preferences for update to authenticated using(user_id=auth.uid() and public.is_family_member(family_id)) with check(user_id=auth.uid() and public.is_family_member(family_id));
create policy activity_read on public.family_activity for select to authenticated using(public.is_family_member(family_id));
-- Токены приглашений никогда не выдаются через таблицу. Изменения состава семьи — только RPC.
revoke all on public.profiles, public.families, public.family_members, public.family_invitations, public.family_preferences, public.family_activity from anon, authenticated;
grant select on public.profiles, public.families, public.family_members, public.family_activity to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select,insert,update on public.family_preferences to authenticated;

create function public.create_family(p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Требуется вход в аккаунт'; end if;
 insert into public.profiles(id) values(auth.uid()) on conflict do nothing;
 insert into public.families(name) values(trim(p_name)) returning id into v_id;
 insert into public.family_members(family_id,user_id,role) values(v_id,auth.uid(),'owner');
 insert into public.family_activity(family_id,actor_id,action) values(v_id,auth.uid(),'Создано семейное пространство');
 return v_id;
end;
$$;
create function public.create_invitation(p_family uuid,p_role text default 'adult') returns text
language plpgsql security definer set search_path='' as $$
declare v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');
begin
 if not public.is_family_owner(p_family) then raise exception 'Только владелец может приглашать участников'; end if;
 if p_role not in ('adult','child') then raise exception 'Недопустимая роль'; end if;
 insert into public.family_invitations(family_id,token_hash,role,created_by)
 values(p_family,encode(sha256(convert_to(v_token,'UTF8')),'hex'),p_role,auth.uid());
 return v_token;
end;
$$;
create function public.join_family(p_token text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_inv public.family_invitations;
begin
 if auth.uid() is null then raise exception 'Требуется вход в аккаунт'; end if;
 select * into v_inv from public.family_invitations where token_hash=encode(sha256(convert_to(trim(p_token),'UTF8')),'hex') for update;
 if not found or v_inv.used_at is not null or v_inv.expires_at<=now() then raise exception 'Приглашение недействительно или срок истёк'; end if;
 if public.is_family_member(v_inv.family_id) then raise exception 'Вы уже состоите в этой семье'; end if;
 insert into public.profiles(id) values(auth.uid()) on conflict do nothing;
 insert into public.family_members(family_id,user_id,role) values(v_inv.family_id,auth.uid(),v_inv.role);
 update public.family_invitations set used_at=now() where id=v_inv.id;
 insert into public.family_activity(family_id,actor_id,action) values(v_inv.family_id,auth.uid(),'К семье присоединился участник');
 return v_inv.family_id;
end;
$$;
create function public.manage_member(p_family uuid,p_user uuid,p_role text,p_can_edit boolean default false,p_remove boolean default false) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Сериализация управления участниками и запрет изменения владельца.
 perform 1 from public.families where id=p_family for update;
 if not public.is_family_owner(p_family) then raise exception 'Недостаточно прав'; end if;
 if exists(select 1 from public.family_members where family_id=p_family and user_id=p_user and role='owner') then raise exception 'Нельзя изменить или удалить владельца'; end if;
 if not exists(select 1 from public.family_members where family_id=p_family and user_id=p_user) then raise exception 'Участник не найден'; end if;
 if p_remove then delete from public.family_members where family_id=p_family and user_id=p_user;
 else
  if p_role not in ('adult','child') then raise exception 'Недопустимая роль'; end if;
  update public.family_members set role=p_role,child_can_edit=(p_role='child' and p_can_edit) where family_id=p_family and user_id=p_user;
 end if;
 insert into public.family_activity(family_id,actor_id,action) values(p_family,auth.uid(),case when p_remove then 'Участник удалён из семьи' else 'Изменены права участника' end);
end;
$$;
create function public.revoke_invitations(p_family uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_family_owner(p_family) then raise exception 'Недостаточно прав'; end if;
 update public.family_invitations set expires_at=now() where family_id=p_family and used_at is null;
end;
$$;
revoke all on function public.is_family_member(uuid),public.is_family_owner(uuid),public.can_edit_family(uuid),public.create_family(text),public.create_invitation(uuid,text),public.join_family(text),public.manage_member(uuid,uuid,text,boolean,boolean),public.revoke_invitations(uuid) from public,anon;
grant execute on function public.is_family_member(uuid),public.is_family_owner(uuid),public.can_edit_family(uuid),public.create_family(text),public.create_invitation(uuid,text),public.join_family(text),public.manage_member(uuid,uuid,text,boolean,boolean),public.revoke_invitations(uuid) to authenticated;
-- Realtime доставляет только строки, доступные по RLS. Дублирующий запуск блока безопасен.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.family_members,public.family_activity;
 end if;
end $$;

-- Профиль создаётся при регистрации; существующие аккаунты также поддерживаются.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,display_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',''),100)) on conflict do nothing;
 return new;
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.profiles(id,display_name) select id,left(coalesce(raw_user_meta_data->>'display_name',''),100) from auth.users on conflict do nothing;
