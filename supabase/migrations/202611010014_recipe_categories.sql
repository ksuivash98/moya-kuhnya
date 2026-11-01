-- Только расширяем справочник: старые рецепты и их категории сохраняются.
begin;
insert into public.recipe_categories(name, position)
select c.name,
  (select coalesce(max(position), 0) from public.recipe_categories)
    + row_number() over (order by c.ord)
from (values
  ('Мясные блюда', 1),
  ('Рыбные блюда', 2),
  ('Блюда с гарниром', 3)
) as c(name, ord)
where not exists (
  select 1 from public.recipe_categories existing where existing.name = c.name
);
commit;
