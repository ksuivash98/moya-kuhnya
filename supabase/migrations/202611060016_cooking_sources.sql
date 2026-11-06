-- Заготовки и подтверждённые соответствия списываются вместе с приготовлением.
-- Старый cook_confirm сохраняет контракт для ранее опубликованных клиентов.
create function public._cooking_confirm_sources(f uuid,k uuid,d jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u jsonb;s jsonb;verified jsonb;history jsonb:='[]';stock_usage jsonb:='[]';prep_usage jsonb:='[]';
 p public.products;pr public.preparations;g record;result jsonb;needed numeric;covered numeric;quantity numeric;ratio numeric;tolerance numeric;unit text;source_unit text;source_name text;
begin
 if jsonb_typeof(d->'usage') is distinct from 'array' or coalesce((d->>'usage_confirmed')::boolean,false)=false then raise exception 'Подтвердите фактический расход ингредиентов';end if;
 for u in select value from jsonb_array_elements(d->'usage') loop
  if nullif(trim(u->>'name'),'') is null then raise exception 'Укажите название ингредиента';end if;
  needed:=public.kitchen_number(u->>'amount')*public.unit_factor(u->>'unit');unit:=public.base_unit(u->>'unit');
  if unit is null or unit='' then raise exception 'Укажите единицу ингредиента';end if;
  if jsonb_typeof(u->'sources') is distinct from 'array' then raise exception 'Подтвердите источники ингредиента «%»',u->>'name';end if;
  covered:=0;tolerance:=0.00000001;verified:='[]';
  for s in select value from jsonb_array_elements(u->'sources') loop
   quantity:=public.kitchen_number(s->>'quantity');
   if quantity<=0 or needed=0 then raise exception 'Некорректный расход источника';end if;
   source_unit:=s->>'unit';
   if s->>'kind'='product' then
    select * into p from public.products where id=(s->>'id')::uuid and family_id=f and not archived for update;
    if not found then raise exception 'Выбранный продукт недоступен';end if;
    source_name:=p.name;
    stock_usage:=stock_usage||jsonb_build_array(jsonb_build_object('name',p.name,'amount',s->>'quantity','unit',source_unit));
   elsif s->>'kind'='preparation' then
    select * into pr from public.preparations where id=(s->>'id')::uuid and family_id=f for update;
    if not found then raise exception 'Выбранная заготовка недоступна';end if;
    if pr.version is distinct from (s->>'version')::integer then raise exception 'Заготовка изменена. Обновите данные и подтвердите расход заново';end if;
    if pr.expires_on<timezone('Asia/Yekaterinburg',now())::date then raise exception 'Срок годности заготовки «%» истёк',pr.title;end if;
    if source_unit<>pr.unit then raise exception 'Единица заготовки изменилась';end if;
    source_name:=pr.title;
    prep_usage:=prep_usage||jsonb_build_array(s);
   else raise exception 'Неизвестный источник ингредиента';end if;
   if source_unit is null or source_unit<>public.base_unit(source_unit) then raise exception 'Укажите базовую единицу источника';end if;
   if source_unit=unit then ratio:=1;
   else ratio:=public.kitchen_number(s->>'ratio');if ratio<=0 then raise exception 'Укажите положительный коэффициент пересчёта';end if;end if;
   covered:=covered+quantity*ratio;
   -- Остатки хранятся с точностью 4 знака, в том числе доли порций.
   tolerance:=tolerance+ratio*0.00005;
   verified:=verified||jsonb_build_array(jsonb_build_object('kind',s->>'kind','id',s->>'id','name',source_name,'quantity',quantity,'unit',source_unit,'ratio',ratio));
  end loop;
  if (needed>0 and covered<=0) or abs(covered-needed)>tolerance then raise exception 'Источники не покрывают расход ингредиента «%»',u->>'name';end if;
  history:=history||jsonb_build_array(jsonb_build_object('name',u->>'name','amount',u->>'amount','unit',u->>'unit','sources',verified));
 end loop;
 -- Проверяем суммарный расход: один источник может встречаться в нескольких строках.
 for g in select (x->>'id')::uuid id,sum((x->>'quantity')::numeric) quantity from jsonb_array_elements(prep_usage)x group by (x->>'id')::uuid loop
  select * into pr from public.preparations where id=g.id and family_id=f for update;
  if pr.quantity<g.quantity then raise exception 'Недостаточно заготовки «%»: есть %, нужно % %',pr.title,pr.quantity,g.quantity,pr.unit;end if;
 end loop;
 -- Проверка плана, распределение порций и складское списание остаются серверными.
 -- Любая ошибка откатывает ВСЮ операцию, включая продукты, заготовки и журналы.
 result:=public._planning_action(f,k,'cook_confirm',jsonb_set(d,'{usage}',stock_usage));
 for g in select (x->>'id')::uuid id,sum((x->>'quantity')::numeric) quantity from jsonb_array_elements(prep_usage)x group by (x->>'id')::uuid loop
  update public.preparations target set quantity=target.quantity-g.quantity,version=target.version+1 where target.id=g.id and target.family_id=f;
  insert into public.preparation_movements(family_id,preparation_id,quantity,reason,operation_id)values(f,g.id,-g.quantity,'Ингредиент блюда',k);
 end loop;
 update public.cooking_events set usage=history where id=(result->>'id')::uuid and family_id=f;
 return result;
end;$$;
revoke all on function public._cooking_confirm_sources(uuid,uuid,jsonb) from public,anon,authenticated;

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
 elsif p_action in ('menu_save','menu_repeat','task_save','cook_confirm') then result:=public._planning_action(p_family,p_key,p_action,p_data);
 elsif p_action in ('product_save','batch_save','prep_save','prep_use','place_save') and to_regprocedure('public._inventory_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._inventory_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 elsif p_action in ('shopping_save','shopping_save_categorized','shopping_generate','purchase_confirm','purchase_reverse','expense_save','budget_save') and to_regprocedure('public._finance_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._finance_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 else raise exception 'Действие недоступно. Проверьте применение миграций';end if;
 insert into public.kitchen_operations(id,family_id,action,payload_hash,result,actor_id)values(p_key,p_family,p_action,md5(p_data::text),result,auth.uid());return result;end$$;

-- Возможность объявляется после установки обеих серверных функций.
insert into public.kitchen_modules values(16);
