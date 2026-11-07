-- Один общий список блюд на период, без копирования по дням.
-- Применяется после 017. Существующие записи без периода не меняются.
do $$begin
 if not exists(select 1 from public.kitchen_modules where version=17) then
  raise exception 'Сначала примените миграцию 017 (preparation_broth)';
 end if;
end;$$;
alter table public.menu_items add column period_start date, add column period_end date;
alter table public.menu_items add constraint menu_period_valid check (
 (period_start is null and period_end is null) or
 (period_start is not null and period_end is not null and period_end between period_start and period_start+30
  and date is null and month=date_trunc('month',period_start)::date)
);
create index menu_items_period_idx on public.menu_items(family_id,period_start,period_end) where period_start is not null;

create function public._menu_period_action(f uuid,k uuid,a text,d jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.menu_items; result jsonb; start_on date; end_on date; n integer; gap integer; i integer; rid uuid;
begin
 rid:=nullif(d->>'id','')::uuid;
 select * into old from public.menu_items where id=rid for update;
 if old.id is not null and (old.family_id<>f or old.version is distinct from (d->>'version')::integer) then
  raise exception 'План изменён на другом устройстве. Обновите данные';
 end if;
 if a='menu_repeat' and old.period_start is not null then
  n:=(d->>'count')::integer; gap:=(d->>'interval')::integer;
  if n is null or n not between 1 and 31 then raise exception 'Количество повторов — от 1 до 31';end if;
  if gap is null or gap not between 1 and 365 then raise exception 'Интервал — от 1 до 365 дней';end if;
  for i in 1..n loop
   start_on:=old.period_start+i*gap;end_on:=old.period_end+i*gap;
   insert into public.menu_items(family_id,recipe_id,title,recipe_snapshot,month,date,period_start,period_end,meal,servings,planned_count,status,notes)
   values(f,old.recipe_id,old.title,old.recipe_snapshot,date_trunc('month',start_on)::date,null,start_on,end_on,old.meal,old.servings,old.planned_count,'Запланировано',old.notes);
  end loop;
  return jsonb_build_object('count',n);
 elsif a='menu_save' then
  if d?'period_start' or d?'period_end' then
   start_on:=nullif(d->>'period_start','')::date;end_on:=nullif(d->>'period_end','')::date;
  else
   start_on:=old.period_start;end_on:=old.period_end;
  end if;
  if (start_on is null)<>(end_on is null) or end_on<start_on or end_on>start_on+30 then
   raise exception 'Выберите период от 1 до 31 дня';
  end if;
  if start_on is not null then
   if nullif(d->>'date','') is not null then raise exception 'Для общего списка укажите период вместо даты';end if;
   d:=d||jsonb_build_object('date',null,'month',date_trunc('month',start_on)::date);
  end if;
  -- Обновление проходит существующие проверки истории, снимка и версий.
  -- Снятие старого диапазона и новая запись атомарны внутри kitchen_mutate.
  if old.id is not null then update public.menu_items set period_start=null,period_end=null where id=old.id;end if;
  result:=public._planning_action(f,k,a,d);
  update public.menu_items set period_start=start_on,period_end=end_on where id=(result->>'id')::uuid and family_id=f;
  return result;
 end if;
 return public._planning_action(f,k,a,d);
end;$$;
revoke all on function public._menu_period_action(uuid,uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.kitchen_mutate(p_family uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare previous public.kitchen_operations;result jsonb;begin
 perform 1 from public.families where id=p_family for update;
 if not public.can_edit_family(p_family) then raise exception 'Нет права изменять данные этой семьи';end if;
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2000000 then raise exception 'Некорректная операция';end if;
 select * into previous from public.kitchen_operations where family_id=p_family and id=p_key;
 if found then if previous.action<>p_action or previous.payload_hash<>md5(p_data::text) then raise exception 'Этот идентификатор уже использован для другой операции';end if;return previous.result;end if;
 if p_action in ('menu_save','task_save') and p_data?'recipe_version' and not exists(select 1 from public.recipes where id=(p_data->>'recipe_id')::uuid and family_id=p_family and version=(p_data->>'recipe_version')::integer) then raise exception 'Рецепт изменён с момента офлайн-копии. Обновите данные';end if;
 if p_action='cook_confirm_sources' then result:=public._cooking_confirm_sources(p_family,p_key,p_data);
 elsif p_action in ('menu_clear','cooking_clear') then result:=public._planning_clear(p_family,p_action,p_data);
 elsif p_action='shopping_clear' then result:=public._shopping_clear(p_family,p_data);
 elsif p_action='shopping_recipe' then result:=public._shopping_recipe(p_family,p_key,p_data);
 elsif p_action in ('menu_save','menu_repeat') then result:=public._menu_period_action(p_family,p_key,p_action,p_data);
 elsif p_action in ('task_save','cook_confirm') then result:=public._planning_action(p_family,p_key,p_action,p_data);
 elsif p_action in ('product_save','batch_save','prep_save','prep_use','place_save') and to_regprocedure('public._inventory_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._inventory_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 elsif p_action in ('shopping_save','shopping_save_categorized','shopping_generate','purchase_confirm','purchase_reverse','expense_save','budget_save') and to_regprocedure('public._finance_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._finance_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 else raise exception 'Действие недоступно. Проверьте применение миграций';end if;
 insert into public.kitchen_operations(id,family_id,action,payload_hash,result,actor_id)values(p_key,p_family,p_action,md5(p_data::text),result,auth.uid());return result;end$$;


insert into public.kitchen_modules values(18);
