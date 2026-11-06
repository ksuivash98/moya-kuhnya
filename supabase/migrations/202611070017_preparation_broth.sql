-- Дополнительный бульон при использовании готовой заготовки: одна транзакция.
do $$begin
 if to_regprocedure('public._cooking_confirm_sources(uuid,uuid,jsonb)') is null or not exists(select 1 from public.kitchen_modules where version=16)then
  raise exception 'Сначала примените миграцию 016 (cooking_sources)';
 end if;
end;$$;
create function public._preparation_use_with_broth(f uuid,k uuid,d jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare soup public.preparations;broth public.preparations;extra jsonb;quantity numeric;result jsonb;
begin
 if d->>'reason' is distinct from 'Использование' or coalesce((d->>'additional_broth_confirmed')::boolean,false)=false then raise exception 'Подтвердите дополнительное использование бульона';end if;
 extra:=d->'additional_broth';if jsonb_typeof(extra) is distinct from 'object' then raise exception 'Выберите бульон и количество';end if;
 if (d->>'id')::uuid=(extra->>'id')::uuid then raise exception 'Суп и дополнительный бульон должны быть разными заготовками';end if;
 select * into soup from public.preparations where id=(d->>'id')::uuid and family_id=f for update;
 if not found or soup.version is distinct from(d->>'version')::integer then raise exception 'Заготовка супа изменилась. Обновите данные';end if;
 select * into broth from public.preparations where id=(extra->>'id')::uuid and family_id=f for update;
 if not found or broth.version is distinct from(extra->>'version')::integer then raise exception 'Заготовка бульона изменилась или недоступна. Обновите данные';end if;
 if extra->>'unit' is null or extra->>'unit'<>broth.unit then raise exception 'Единица бульона изменилась';end if;
 quantity:=public.kitchen_number(extra->>'quantity');
 if quantity<=0 or quantity>broth.quantity then raise exception 'Недостаточно бульона: есть %, нужно % %',broth.quantity,quantity,broth.unit;end if;
 -- Без menu_id: бульон не является ещё одним выполнением блюда в меню.
 perform public._inventory_action_before_categories(f,k,'prep_use',jsonb_build_object('id',broth.id,'version',broth.version,'quantity',extra->>'quantity','reason','Использование','date',d->>'date'));
 result:=public._inventory_action_before_categories(f,k,'prep_use',d-'additional_broth'-'additional_broth_confirmed');
 return result||jsonb_build_object('broth_id',broth.id,'broth_quantity',quantity,'broth_unit',broth.unit);
end;$$;
revoke all on function public._preparation_use_with_broth(uuid,uuid,jsonb) from public,anon,authenticated;

-- Сохраняем существующий контракт категорий и остальных складских действий.
create or replace function public._inventory_action(f uuid,k uuid,a text,d jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if a='prep_use' and d?'additional_broth' then return public._preparation_use_with_broth(f,k,d);end if;
 result:=public._inventory_action_before_categories(f,k,a,d);
 if a='product_save' then
  update public.products set category=coalesce(d->>'category','Другое'),category_manual=true where id=(result->>'id')::uuid and family_id=f;
 end if;
 return result;
end;$$;
revoke all on function public._inventory_action(uuid,uuid,text,jsonb) from public,anon,authenticated;
insert into public.kitchen_modules values(17);
