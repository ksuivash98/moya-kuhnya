-- Очистка незавершённых планов с сохранением истории и связанных записей.
create function public._planning_clear(f uuid,a text,d jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare period date;expected integer;changed integer;
begin
 if a not in ('menu_clear','cooking_clear') or coalesce(d->>'month','') !~ '^[0-9]{4}-[0-9]{2}-01$' or jsonb_typeof(d->'items') is distinct from 'array' then raise exception 'Некорректный список плана';end if;
 period:=(d->>'month')::date;expected:=jsonb_array_length(d->'items');
 if expected=0 then raise exception 'Нет незавершённых записей для очистки';end if;
 if (select count(distinct x.id) from jsonb_to_recordset(d->'items') as x(id uuid,version integer))<>expected then raise exception 'Некорректный список плана';end if;
 if a='menu_clear' then
  if exists(select 1 from jsonb_to_recordset(d->'items') as x(id uuid,version integer)
   left join public.menu_items m on m.id=x.id and m.family_id=f and m.month=period and m.version=x.version and m.status not in ('Отменено','Приготовлено','Сделана заготовка','Приготовлено из заготовки')
   where m.id is null) then raise exception 'План изменён на другом устройстве. Обновите страницу и подтвердите очистку заново';end if;
  update public.menu_items m set status='Отменено',version=m.version+1
  from jsonb_to_recordset(d->'items') as x(id uuid,version integer)
  where m.id=x.id and m.family_id=f and m.month=period and m.version=x.version and m.status not in ('Отменено','Приготовлено','Сделана заготовка','Приготовлено из заготовки');
 else
  if exists(select 1 from jsonb_to_recordset(d->'items') as x(id uuid,version integer)
   left join public.cooking_tasks t on t.id=x.id and t.family_id=f and t.date>=period and t.date<period+interval '1 month' and t.version=x.version and t.status not in ('Отменено','Приготовлено')
   where t.id is null) then raise exception 'План изменён на другом устройстве. Обновите страницу и подтвердите очистку заново';end if;
  update public.cooking_tasks t set status='Отменено',version=t.version+1
  from jsonb_to_recordset(d->'items') as x(id uuid,version integer)
  where t.id=x.id and t.family_id=f and t.date>=period and t.date<period+interval '1 month' and t.version=x.version and t.status not in ('Отменено','Приготовлено');
 end if;
 get diagnostics changed=row_count;
 if changed<>expected then raise exception 'План изменён. Обновите страницу';end if;
 return jsonb_build_object('cleared',changed);
end;$$;
revoke all on function public._planning_clear(uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.kitchen_mutate(p_family uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare previous public.kitchen_operations;result jsonb;begin
 perform 1 from public.families where id=p_family for update;
 if not public.can_edit_family(p_family) then raise exception 'Нет права изменять данные этой семьи';end if;
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2000000 then raise exception 'Некорректная операция';end if;
 select * into previous from public.kitchen_operations where family_id=p_family and id=p_key;
 if found then if previous.action<>p_action or previous.payload_hash<>md5(p_data::text) then raise exception 'Этот идентификатор уже использован для другой операции';end if;return previous.result;end if;
 if p_action in ('menu_save','task_save') and p_data?'recipe_version' and not exists(select 1 from public.recipes where id=(p_data->>'recipe_id')::uuid and family_id=p_family and version=(p_data->>'recipe_version')::integer) then raise exception 'Рецепт изменён с момента офлайн-копии. Обновите данные';end if;
 if p_action in ('menu_clear','cooking_clear') then result:=public._planning_clear(p_family,p_action,p_data);
 elsif p_action='shopping_clear' then result:=public._shopping_clear(p_family,p_data);
 elsif p_action='shopping_recipe' then result:=public._shopping_recipe(p_family,p_key,p_data);
 elsif p_action in ('menu_save','menu_repeat','task_save','cook_confirm') then result:=public._planning_action(p_family,p_key,p_action,p_data);
 elsif p_action in ('product_save','batch_save','prep_save','prep_use','place_save') and to_regprocedure('public._inventory_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._inventory_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 elsif p_action in ('shopping_save','shopping_save_categorized','shopping_generate','purchase_confirm','purchase_reverse','expense_save','budget_save') and to_regprocedure('public._finance_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._finance_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 else raise exception 'Действие недоступно. Проверьте применение миграций';end if;
 insert into public.kitchen_operations(id,family_id,action,payload_hash,result,actor_id)values(p_key,p_family,p_action,md5(p_data::text),result,auth.uid());return result;end$$;
