-- Импорт по фото/тексту. Исходник не хранится: только SHA-256, тип и результат.
create table public.recipe_import_requests (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_kind text not null check(source_kind in ('photo','text')),
  input_hash text not null check(input_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check(status in ('pending','ready','failed')),
  result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=250000)),
  consent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index recipe_import_quota_idx on public.recipe_import_requests(user_id,created_at);
alter table public.recipe_import_requests enable row level security;
create policy recipe_import_own on public.recipe_import_requests for select to authenticated
  using(user_id=auth.uid() and public.is_family_member(family_id));
revoke all on public.recipe_import_requests from public,anon,authenticated;
grant select on public.recipe_import_requests to authenticated;
grant all on public.recipe_import_requests to service_role;
create function public.reserve_recipe_import(p_family uuid,p_id uuid,p_kind text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.recipe_import_requests;
begin
  -- Блокировка профиля сериализует квоту одного пользователя во всех семьях.
  perform 1 from public.profiles where id=auth.uid() for update;
  if not exists(select 1 from public.family_members where family_id=p_family and user_id=auth.uid() and role in ('owner','adult')) then
    raise exception 'Распознавание доступно владельцу и взрослым участникам';
  end if;
  if p_id is null or p_kind is null or p_kind not in ('text','photo') or p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'Некорректный запрос';end if;
  select * into prior from public.recipe_import_requests where id=p_id;
  if found then
    if prior.user_id<>auth.uid() or prior.family_id<>p_family or prior.source_kind<>p_kind or prior.input_hash<>p_hash then raise exception 'Идентификатор уже использован';end if;
    return jsonb_build_object('fresh',false,'status',prior.status,'result',prior.result);
  end if;
  if (select count(*) from public.recipe_import_requests where user_id=auth.uid() and created_at>=(date_trunc('day',timezone('Asia/Yekaterinburg',now())) at time zone 'Asia/Yekaterinburg'))>=5 then
    raise exception 'Лимит — 5 распознаваний в сутки, включая неудачные';
  end if;
  insert into public.recipe_import_requests(id,family_id,user_id,source_kind,input_hash)values(p_id,p_family,auth.uid(),p_kind,p_hash);
  return jsonb_build_object('fresh',true,'status','pending');
end$$;
revoke all on function public.reserve_recipe_import(uuid,uuid,text,text) from public,anon;
grant execute on function public.reserve_recipe_import(uuid,uuid,text,text) to authenticated;
