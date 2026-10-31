-- Инструкция автора рецепта: без автоматического заполнения сроков и способов.
alter table public.recipes add column freeze_instructions text not null default ''
  check (length(freeze_instructions) <= 10000);

-- Существующий save_recipe сохраняет свои проверки ролей, версии и фотографий.
-- Обе записи выполняются в одной транзакции; старые клиенты не стирают новое поле.
create function public.save_recipe_with_freezing(p_id uuid,p_family uuid,p_data jsonb,p_version integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if p_data ? 'freezeInstructions' and jsonb_typeof(p_data->'freezeInstructions') not in ('string','null') then
  raise exception 'Инструкция по заморозке должна быть текстом';
 end if;
 if length(coalesce(p_data->>'freezeInstructions','')) > 10000 then
  raise exception 'Инструкция по заморозке: максимум 10000 символов';
 end if;
 saved := public.save_recipe(p_id,p_family,p_data,p_version);
 if p_data ? 'freezeInstructions' then
  update public.recipes set freeze_instructions=coalesce(p_data->>'freezeInstructions','') where id=saved;
 end if;
 return saved;
end;
$$;
revoke all on function public.save_recipe_with_freezing(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.save_recipe_with_freezing(uuid,uuid,jsonb,integer) to authenticated;
