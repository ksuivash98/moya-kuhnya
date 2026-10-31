-- Отменяем только подтверждённый пользователем снимок открытого списка.
-- Оплаченные покупки, финансовый журнал, запасы и меню не меняются.
create function public._shopping_clear(f uuid,d jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare period date;expected integer;changed integer;
begin
 if coalesce(d->>'month','') !~ '^[0-9]{4}-[0-9]{2}-01$' or jsonb_typeof(d->'items') is distinct from 'array' then raise exception 'Некорректный список покупок';end if;
 period:=(d->>'month')::date;
 expected:=jsonb_array_length(d->'items');
 if expected=0 then raise exception 'Список уже пуст';end if;
 if (select count(distinct x.id) from jsonb_to_recordset(d->'items') as x(id uuid,version integer))<>expected then raise exception 'Некорректный список покупок';end if;
 if exists(select 1 from jsonb_to_recordset(d->'items') as x(id uuid,version integer)
  left join public.shopping_items s on s.id=x.id and s.family_id=f and s.month=period and s.status='open' and s.version=x.version
  where s.id is null) then raise exception 'Список изменён на другом устройстве. Обновите покупки и подтвердите очистку заново';end if;
 update public.shopping_items s set status='cancelled',version=s.version+1
 from jsonb_to_recordset(d->'items') as x(id uuid,version integer)
 where s.id=x.id and s.family_id=f and s.month=period and s.status='open' and s.version=x.version;
 get diagnostics changed=row_count;
 if changed<>expected then raise exception 'Список изменён. Обновите покупки';end if;
 return jsonb_build_object('cleared',changed);
end;
$$;
revoke all on function public._shopping_clear(uuid,jsonb) from public,anon,authenticated;

create or replace function public.kitchen_mutate(p_family uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare previous public.kitchen_operations;result jsonb;begin
 perform 1 from public.families where id=p_family for update;
 if not public.can_edit_family(p_family) then raise exception 'Нет права изменять данные этой семьи';end if;
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2000000 then raise exception 'Некорректная операция';end if;
 select * into previous from public.kitchen_operations where family_id=p_family and id=p_key;
 if found then if previous.action<>p_action or previous.payload_hash<>md5(p_data::text) then raise exception 'Этот идентификатор уже использован для другой операции';end if;return previous.result;end if;
 if p_action in ('menu_save','task_save') and p_data?'recipe_version' and not exists(select 1 from public.recipes where id=(p_data->>'recipe_id')::uuid and family_id=p_family and version=(p_data->>'recipe_version')::integer) then raise exception 'Рецепт изменён с момента офлайн-копии. Обновите данные';end if;
 if p_action='shopping_clear' then result:=public._shopping_clear(p_family,p_data);
 elsif p_action='shopping_recipe' then result:=public._shopping_recipe(p_family,p_key,p_data);
 elsif p_action in ('menu_save','menu_repeat','task_save','cook_confirm') then result:=public._planning_action(p_family,p_key,p_action,p_data);
 elsif p_action in ('product_save','batch_save','prep_save','prep_use','place_save') and to_regprocedure('public._inventory_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._inventory_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 elsif p_action in ('shopping_save','shopping_save_categorized','shopping_generate','purchase_confirm','purchase_reverse','expense_save','budget_save') and to_regprocedure('public._finance_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._finance_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 else raise exception 'Действие недоступно. Проверьте применение миграций';end if;
 insert into public.kitchen_operations(id,family_id,action,payload_hash,result,actor_id)values(p_key,p_family,p_action,md5(p_data::text),result,auth.uid());return result;end$$;
