-- Этап 2. Выполняется после foundation; существующая семейная модель используется без дублирования.
create table public.recipe_categories(name text primary key,position integer not null unique);
insert into public.recipe_categories(name,position) values
 ('Супы',1),('Основные блюда',2),('Гарниры',3),('Салаты',4),('Закуски',5),('Выпечка',6),('Десерты',7),('Завтраки',8),('Соусы',9),('Напитки',10),('Заготовки',11),('Другие',12);
create table public.recipes(
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id) on delete cascade,
 title text not null check(length(trim(title)) between 1 and 200),
 description text not null default '' check(length(description)<=20000),
 category text not null references public.recipe_categories(name),
 cover_path text not null default '',
 prep_minutes integer not null check(prep_minutes between 0 and 10080),
 cook_minutes integer not null check(cook_minutes between 0 and 10080),
 servings integer not null check(servings between 1 and 1000),
 difficulty text not null check(difficulty in ('Легко','Средне','Сложно')),
 can_freeze boolean not null default false,
 shelf_life text not null default '' check(length(shelf_life)<=1000),
 storage_conditions text not null default '' check(length(storage_conditions)<=10000),
 thaw_instructions text not null default '' check(length(thaw_instructions)<=10000),
 notes text not null default '' check(length(notes)<=20000),
 source_url text not null default '' check(length(source_url)<=2000 and (source_url='' or source_url ~ '^https?://[^[:space:]]+$')),
 views bigint not null default 0 check(views>=0),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 unique(id,family_id)
);
create index recipes_family_active_idx on public.recipes(family_id,created_at desc) where deleted_at is null;
create index recipes_category_idx on public.recipes(family_id,category) where deleted_at is null;
create table public.recipe_ingredients(
 id uuid primary key,recipe_id uuid not null references public.recipes(id) on delete restrict,
 name text not null check(length(trim(name)) between 1 and 200),
 amount numeric(14,4),
 unit text not null check(unit in ('г','кг','мл','л','шт.','ч. л.','ст. л.','стакан','упаковка','по вкусу')),
 note text not null default '' check(length(note)<=2000),position integer not null check(position>=0),
 check((unit='по вкусу' and amount is null) or (unit<>'по вкусу' and amount is not null and amount>0 and amount<=1000000000)),
 unique(recipe_id,position)
);
create index recipe_ingredients_name_idx on public.recipe_ingredients(lower(name));
create table public.recipe_steps(
 id uuid primary key,recipe_id uuid not null references public.recipes(id) on delete restrict,
 description text not null check(length(trim(description)) between 1 and 20000),photo_path text not null default '',position integer not null check(position>=0),unique(recipe_id,position)
);
create table public.recipe_favorites(
 recipe_id uuid not null references public.recipes(id) on delete restrict,
 user_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(recipe_id,user_id)
);
create index recipe_favorites_user_idx on public.recipe_favorites(user_id);
create table public.recipe_photos(
 id uuid primary key default gen_random_uuid(),
 recipe_id uuid not null,
 family_id uuid not null,
 path text not null unique,
 created_at timestamptz not null default now(),
 foreign key(recipe_id,family_id) references public.recipes(id,family_id) on delete restrict,
 check(path ~ ('^'||family_id::text||'/'||recipe_id::text||'/[0-9a-f-]{36}\.jpg$'))
);
create index recipe_photos_recipe_idx on public.recipe_photos(recipe_id);

alter table public.recipe_categories enable row level security;
alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_steps enable row level security;
alter table public.recipe_favorites enable row level security;
alter table public.recipe_photos enable row level security;
create policy recipe_categories_read on public.recipe_categories for select to authenticated using(true);
-- Архив остаётся читаемым членам семьи для будущей истории; приложение фильтрует deleted_at.
create policy recipes_read on public.recipes for select to authenticated using(public.is_family_member(family_id));
create policy recipe_ingredients_read on public.recipe_ingredients for select to authenticated using(exists(select 1 from public.recipes r where r.id=recipe_id and public.is_family_member(r.family_id)));
create policy recipe_steps_read on public.recipe_steps for select to authenticated using(exists(select 1 from public.recipes r where r.id=recipe_id and public.is_family_member(r.family_id)));
create policy recipe_favorites_read on public.recipe_favorites for select to authenticated using(user_id=auth.uid() and exists(select 1 from public.recipes r where r.id=recipe_id and public.is_family_member(r.family_id)));
create policy recipe_photos_read on public.recipe_photos for select to authenticated using(public.is_family_member(family_id));
revoke all on public.recipe_categories,public.recipes,public.recipe_ingredients,public.recipe_steps,public.recipe_favorites,public.recipe_photos from anon,authenticated;
grant select on public.recipe_categories,public.recipes,public.recipe_ingredients,public.recipe_steps,public.recipe_favorites,public.recipe_photos to authenticated;

create function public.set_recipe_favorite(p_recipe uuid,p_value boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.recipes where id=p_recipe and deleted_at is null and public.is_family_member(family_id)) then raise exception 'Рецепт недоступен'; end if;
 if p_value then insert into public.recipe_favorites(recipe_id,user_id) values(p_recipe,auth.uid()) on conflict do nothing;
 else delete from public.recipe_favorites where recipe_id=p_recipe and user_id=auth.uid();end if;
end;
$$;
create function public.save_recipe(p_id uuid,p_family uuid,p_data jsonb,p_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_old public.recipes;v_path text;v_existing boolean;
begin
 if not public.can_edit_family(p_family) then raise exception 'Нет права редактировать рецепты этой семьи'; end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'ingredients') is distinct from 'array' or jsonb_typeof(p_data->'steps') is distinct from 'array' then raise exception 'Некорректная форма рецепта';end if;
 if jsonb_array_length(p_data->'ingredients')=0 or jsonb_array_length(p_data->'steps')=0 then raise exception 'Добавьте ингредиенты и шаги приготовления'; end if;
 if octet_length(p_data::text)>4000000 then raise exception 'Рецепт слишком большой (максимум 4 МБ текста)';end if;
 if exists(select 1 from jsonb_array_elements(p_data->'ingredients') i where coalesce(i->>'unit','')<>'по вкусу' and coalesce(i->>'amount','') !~ '^[0-9]+([.,][0-9]{1,4})?$') then raise exception 'Количество должно быть положительным числом, до 4 знаков после запятой';end if;
 select * into v_old from public.recipes where id=p_id for update;
 v_existing:=found;
 if v_existing then
  if v_old.family_id<>p_family or v_old.deleted_at is not null then raise exception 'Рецепт недоступен';end if;
  if p_version is distinct from v_old.version then raise exception 'Рецепт изменён на другом устройстве. Сохраните свой текст отдельно и откройте актуальную версию';end if;
 elsif p_version is not null then raise exception 'Рецепт больше не существует';end if;
 -- Проверяем каждый путь до записи; чужой файл и файл другого рецепта прикрепить нельзя.
 for v_path in select distinct path from (select nullif(p_data->>'photo','') as path union all select nullif(s->>'photo','') from jsonb_array_elements(p_data->'steps') s) paths where path is not null loop
  if v_path !~ ('^'||p_family::text||'/'||p_id::text||'/[0-9a-f-]{36}\.jpg$') or not exists(select 1 from storage.objects where bucket_id='recipe-photos' and name=v_path) then raise exception 'Фотография недоступна или принадлежит другому рецепту';end if;
 end loop;
 if not v_existing then
  insert into public.recipes(id,family_id,title,description,category,cover_path,prep_minutes,cook_minutes,servings,difficulty,can_freeze,shelf_life,storage_conditions,thaw_instructions,notes,source_url)
  values(p_id,p_family,trim(p_data->>'title'),coalesce(p_data->>'description',''),p_data->>'category',coalesce(p_data->>'photo',''),(p_data->>'prep')::integer,(p_data->>'cook')::integer,(p_data->>'servings')::integer,p_data->>'difficulty',coalesce((p_data->>'freeze')::boolean,false),coalesce(p_data->>'shelfLife',''),coalesce(p_data->>'storage',''),coalesce(p_data->>'thaw',''),coalesce(p_data->>'notes',''),coalesce(p_data->>'source',''));
 else
  update public.recipes set title=trim(p_data->>'title'),description=coalesce(p_data->>'description',''),category=p_data->>'category',cover_path=coalesce(p_data->>'photo',''),prep_minutes=(p_data->>'prep')::integer,cook_minutes=(p_data->>'cook')::integer,servings=(p_data->>'servings')::integer,difficulty=p_data->>'difficulty',can_freeze=coalesce((p_data->>'freeze')::boolean,false),shelf_life=coalesce(p_data->>'shelfLife',''),storage_conditions=coalesce(p_data->>'storage',''),thaw_instructions=coalesce(p_data->>'thaw',''),notes=coalesce(p_data->>'notes',''),source_url=coalesce(p_data->>'source',''),version=version+1,updated_at=now() where id=p_id;
 end if;
 delete from public.recipe_ingredients where recipe_id=p_id;
 insert into public.recipe_ingredients(id,recipe_id,name,amount,unit,note,position)
 select (i->>'id')::uuid,p_id,trim(i->>'name'),case when i->>'unit'='по вкусу' then null else replace(i->>'amount',',','.')::numeric end,i->>'unit',coalesce(i->>'note',''),ord-1 from jsonb_array_elements(p_data->'ingredients') with ordinality as t(i,ord);
 delete from public.recipe_steps where recipe_id=p_id;
 insert into public.recipe_steps(id,recipe_id,description,photo_path,position)
 select (s->>'id')::uuid,p_id,trim(s->>'text'),coalesce(s->>'photo',''),ord-1 from jsonb_array_elements(p_data->'steps') with ordinality as t(s,ord);
 delete from public.recipe_photos where recipe_id=p_id;
 insert into public.recipe_photos(recipe_id,family_id,path)
 select p_id,p_family,path from (select nullif(p_data->>'photo','') as path union select nullif(s->>'photo','') from jsonb_array_elements(p_data->'steps') s) paths where path is not null;
 perform public.set_recipe_favorite(p_id,coalesce((p_data->>'favorite')::boolean,false));
 insert into public.family_activity(family_id,actor_id,action) values(p_family,auth.uid(),case when v_existing then 'Обновлён семейный рецепт' else 'Добавлен семейный рецепт' end);
 return p_id;
end;
$$;
create function public.archive_recipe(p_recipe uuid,p_version integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_recipe public.recipes;
begin
 select * into v_recipe from public.recipes where id=p_recipe for update;
 if not found or not public.can_edit_family(v_recipe.family_id) or v_recipe.deleted_at is not null then raise exception 'Нет права удалить этот рецепт';end if;
 if p_version is distinct from v_recipe.version then raise exception 'Рецепт изменён на другом устройстве. Обновите страницу';end if;
 update public.recipes set deleted_at=now(),updated_at=now(),version=version+1 where id=p_recipe;
 insert into public.family_activity(family_id,actor_id,action) values(v_recipe.family_id,auth.uid(),'Рецепт перемещён в архив');
 -- Ингредиенты, шаги и фото не удаляются, чтобы сохранить будущие ссылки истории.
end;
$$;
create function public.open_recipe(p_recipe uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 update public.recipes set views=views+1 where id=p_recipe and deleted_at is null and public.is_family_member(family_id);
 if not found then raise exception 'Рецепт недоступен';end if;
end;
$$;
-- Невалидное имя объекта безопасно даёт NULL, а не ошибку приведения UUID.
create function public.recipe_photo_family(p_path text) returns uuid
language sql immutable set search_path='' as $$
 select case when split_part(p_path,'/',1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(p_path,'/',1)::uuid else null end;
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('recipe-photos','recipe-photos',false,5242880,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=array['image/jpeg'];
create policy recipe_photo_select on storage.objects for select to authenticated using(bucket_id='recipe-photos' and public.is_family_member(public.recipe_photo_family(name)));
create policy recipe_photo_insert on storage.objects for insert to authenticated with check(bucket_id='recipe-photos' and public.can_edit_family(public.recipe_photo_family(name)) and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');
create policy recipe_photo_delete on storage.objects for delete to authenticated using(bucket_id='recipe-photos' and public.can_edit_family(public.recipe_photo_family(name)) and not exists(select 1 from public.recipe_photos p where p.path=name));
revoke all on function public.set_recipe_favorite(uuid,boolean),public.save_recipe(uuid,uuid,jsonb,integer),public.archive_recipe(uuid,integer),public.open_recipe(uuid),public.recipe_photo_family(text) from public,anon;
grant execute on function public.set_recipe_favorite(uuid,boolean),public.save_recipe(uuid,uuid,jsonb,integer),public.archive_recipe(uuid,integer),public.open_recipe(uuid),public.recipe_photo_family(text) to authenticated;
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.recipes,public.recipe_favorites;end if;end $$;

-- JSONB-пакет сохраняет все дочерние строки: лимит PostgREST не обрезает ингредиенты/шаги.
-- Родительские записи выдаются страницами по 200, с RLS вызывающего пользователя.
create function public.get_recipe_page(p_family uuid,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
  'recipe_ingredients',coalesce((select jsonb_agg(to_jsonb(i) order by i.position) from public.recipe_ingredients i where i.recipe_id=r.id),'[]'::jsonb),
  'recipe_steps',coalesce((select jsonb_agg(to_jsonb(s) order by s.position) from public.recipe_steps s where s.recipe_id=r.id),'[]'::jsonb)
 ) order by r.created_at desc,r.id),'[]'::jsonb)
 from(select * from public.recipes where family_id=p_family and deleted_at is null order by created_at desc,id limit 200 offset greatest(p_offset,0))r;
$$;
revoke all on function public.get_recipe_page(uuid,integer) from public,anon;
grant execute on function public.get_recipe_page(uuid,integer) to authenticated;
