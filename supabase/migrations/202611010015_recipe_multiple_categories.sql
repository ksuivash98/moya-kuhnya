-- Применять после 014. Старое поле category остаётся совместимым с прежними клиентами.
begin;
alter table public.recipes add column categories text[] not null default '{}';
update public.recipes set categories = array[category];

create function public.recipe_category_labels_guard() returns trigger
language plpgsql set search_path='' as $$
begin
 if coalesce(cardinality(new.categories),0)=0 then
  new.categories := array[new.category];
 elsif tg_op='UPDATE' and new.category is distinct from old.category and new.categories is not distinct from old.categories then
  -- Старый клиент может изменить основную категорию, сохранив дополнительные.
  new.categories := array[new.category] || array_remove(array_remove(old.categories,old.category),new.category);
 end if;
 if array_ndims(new.categories) is distinct from 1 or cardinality(new.categories)>100
  or array_position(new.categories,null) is not null
  or cardinality(new.categories)<>(select count(distinct c) from unnest(new.categories) c)
  or exists(select 1 from unnest(new.categories) c where not exists(select 1 from public.recipe_categories known where known.name=c))
  or new.category is distinct from new.categories[1] then
  raise exception 'Выберите существующие категории рецепта без повторов';
 end if;
 return new;
end;
$$;
revoke all on function public.recipe_category_labels_guard() from public,anon,authenticated;
create trigger recipe_category_labels before insert or update of category,categories on public.recipes
for each row execute function public.recipe_category_labels_guard();

-- Все прежние проверки доступа, версии, фото и инструкции по заморозке сохраняются.
create function public.save_recipe_with_categories(p_id uuid,p_family uuid,p_data jsonb,p_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid; labels text[];
begin
 if not public.can_edit_family(p_family) then raise exception 'Нет права редактировать рецепты этой семьи';end if;
 if jsonb_typeof(p_data->'categories') is distinct from 'array' then raise exception 'Выберите хотя бы одну категорию рецепта';end if;
 if jsonb_array_length(p_data->'categories') not between 1 and 100
  or exists(select 1 from jsonb_array_elements(p_data->'categories') c where jsonb_typeof(c)<>'string') then
  raise exception 'Выберите существующие категории рецепта';
 end if;
 select array_agg(value order by ord) into labels from jsonb_array_elements_text(p_data->'categories') with ordinality as t(value,ord);
 if cardinality(labels)<>(select count(distinct c) from unnest(labels) c)
  or exists(select 1 from unnest(labels) c where not exists(select 1 from public.recipe_categories known where known.name=c)) then
  raise exception 'Выберите существующие категории рецепта без повторов';
 end if;
 saved := public.save_recipe_with_freezing(p_id,p_family,jsonb_set(p_data,'{category}',to_jsonb(labels[1])),p_version);
 update public.recipes set categories=labels where id=saved;
 return saved;
end;
$$;
revoke all on function public.save_recipe_with_categories(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.save_recipe_with_categories(uuid,uuid,jsonb,integer) to authenticated;
commit;
