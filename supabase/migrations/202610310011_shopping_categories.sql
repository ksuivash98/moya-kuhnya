-- Категории продуктов и открытых покупок; финансовая история не пересчитывается.
alter table public.products add column category_manual boolean not null default false;
-- Сохраняем существующие категории, отличные от прежнего значения по умолчанию.
update public.products set category_manual=true where category<>'Другое';

create function public.suggest_product_category(p_name text) returns text
language sql immutable set search_path='' as $$
 select case
 when n ~ '^(соль|соли|соль морская|соль поваренная|перец черный( молотый)?|черный( молотый)? перец|молотый черный перец|перец молотый|паприка|корица|куркума|лавровый лист|кориандр|ванилин)$' then 'Специи'
 when n ~ '^(лук( репчатый| зеленый)?|репчатый лук|картофель|картофеля|морковь|моркови|чеснок|чеснока|помидор|помидоры|томаты|огурец|огурцы|капуста|кабачок|кабачки|свекла|болгарский перец|перец болгарский|сладкий перец)$' then 'Овощи'
 when n ~ '^(лимон|лимоны|лимона|яблоко|яблоки|яблок|груша|груши|банан|бананы|апельсин|апельсины|мандарин|мандарины|лайм|киви)$' then 'Фрукты'
 when n ~ '^(молоко|молока|кефир|кефира|творог|творога|сметана|сметаны|сливки|сливок|сыр|сыра|йогурт|масло сливочное|сливочное масло)$' then 'Молочные продукты'
 when n ~ '^(говядина|говядины|свинина|свинины|курица|курицы|куриное филе|филе курицы|индейка|индейки|фарш мясной)$' then 'Мясо'
 when n ~ '^(лосось|лосося|семга|треска|трески|минтай|минтая|скумбрия|скумбрии|форель|филе трески)$' then 'Рыба'
 when n ~ '^(рис|риса|гречка|гречки|гречневая крупа|овсяные хлопья|овсянка|пшено|перловка|манная крупа|булгур)$' then 'Крупы'
 when n ~ '^(макароны|макарон|спагетти|вермишель|паста|пенне|фузилли)$' then 'Макароны'
 when n ~ '^(чай|кофе|вода|воды|сок|минеральная вода)$' then 'Напитки'
 when n ~ '^(шоколад|конфеты|печенье|мед|варенье)$' then 'Сладости'
 when n ~ '^(консервированный горошек|горошек консервированный|консервированная кукуруза|кукуруза консервированная|тунец консервированный)$' then 'Консервы'
 else 'Другое' end
 from (select replace(public.product_key(p_name),'ё','е') n) names;
$$;
revoke all on function public.suggest_product_category(text) from public,anon;
grant execute on function public.suggest_product_category(text) to authenticated;

create function public.product_category_on_insert() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not new.category_manual then
  if new.category='Другое' then new.category:=public.suggest_product_category(new.name);
  else new.category_manual:=true;end if;
 end if;
 return new;
end;$$;
create trigger product_category_on_insert before insert on public.products for each row execute function public.product_category_on_insert();

create function public.sync_open_shopping_category() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.shopping_items set category=new.category,version=version+1
 where family_id=new.family_id and product_id=new.id and status='open' and category is distinct from new.category;
 return new;
end;$$;
create trigger sync_open_shopping_category after update of category on public.products for each row when (old.category is distinct from new.category) execute function public.sync_open_shopping_category();
revoke all on function public.product_category_on_insert(),public.sync_open_shopping_category() from public,anon,authenticated;

-- Уточняем только старые категории по умолчанию, не меняя количество и историю.
update public.products set category=public.suggest_product_category(name),version=version+1
 where not category_manual and category is distinct from public.suggest_product_category(name);

-- Открытые позиции могли сохранить старую категорию ещё до обновления продукта.
update public.shopping_items s set category=p.category,version=s.version+1
 from public.products p where s.product_id=p.id and s.family_id=p.family_id and s.status='open' and s.category is distinct from p.category;

alter function public._finance_action(uuid,uuid,text,jsonb) rename to _finance_action_before_categories;
create function public._finance_action(f uuid,k uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;chosen text:=d->>'category';pid uuid;
begin
 if a='shopping_save_categorized' then
  if chosen is null or chosen not in ('__auto__','Мясо','Рыба','Молочные продукты','Овощи','Фрукты','Крупы','Макароны','Специи','Консервы','Замороженные продукты','Сладости','Напитки','Другое') then raise exception 'Выберите категорию продукта';end if;
  -- Сначала прежние проверки семьи, версии, количества и единиц.
  result:=public._finance_action_before_categories(f,k,'shopping_save',d);
  select product_id into pid from public.shopping_items where id=(result->>'id')::uuid and family_id=f;
  if chosen<>'__auto__' then
   update public.products set category=chosen,category_manual=true,version=version+1 where id=pid and family_id=f and (category is distinct from chosen or not category_manual);
  else
   update public.products set category=public.suggest_product_category(name),version=version+1 where id=pid and family_id=f and not category_manual and category is distinct from public.suggest_product_category(name);
  end if;
  return result;
 end if;
 return public._finance_action_before_categories(f,k,a,d);
end;$$;
revoke all on function public._finance_action(uuid,uuid,text,jsonb) from public,anon,authenticated;

-- Выбор в карточке продукта тоже считается ручным, в том числе «Другое».
alter function public._inventory_action(uuid,uuid,text,jsonb) rename to _inventory_action_before_categories;
create function public._inventory_action(f uuid,k uuid,a text,d jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public._inventory_action_before_categories(f,k,a,d);
 if a='product_save' then
  update public.products set category=coalesce(d->>'category','Другое'),category_manual=true where id=(result->>'id')::uuid and family_id=f;
 end if;
 return result;
end;$$;
revoke all on function public._inventory_action(uuid,uuid,text,jsonb) from public,anon,authenticated;

create or replace function public.kitchen_mutate(p_family uuid,p_key uuid,p_action text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare previous public.kitchen_operations;result jsonb;begin
 perform 1 from public.families where id=p_family for update;
 if not public.can_edit_family(p_family) then raise exception 'Нет права изменять данные этой семьи';end if;
 if p_key is null or p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>2000000 then raise exception 'Некорректная операция';end if;
 select * into previous from public.kitchen_operations where family_id=p_family and id=p_key;
 if found then if previous.action<>p_action or previous.payload_hash<>md5(p_data::text) then raise exception 'Этот идентификатор уже использован для другой операции';end if;return previous.result;end if;
 if p_action in ('menu_save','task_save') and p_data?'recipe_version' and not exists(select 1 from public.recipes where id=(p_data->>'recipe_id')::uuid and family_id=p_family and version=(p_data->>'recipe_version')::integer) then raise exception 'Рецепт изменён с момента офлайн-копии. Обновите данные';end if;
 if p_action='shopping_recipe' then result:=public._shopping_recipe(p_family,p_key,p_data);
 elsif p_action in ('menu_save','menu_repeat','task_save','cook_confirm') then result:=public._planning_action(p_family,p_key,p_action,p_data);
 elsif p_action in ('product_save','batch_save','prep_save','prep_use','place_save') and to_regprocedure('public._inventory_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._inventory_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 elsif p_action in ('shopping_save','shopping_save_categorized','shopping_generate','purchase_confirm','purchase_reverse','expense_save','budget_save') and to_regprocedure('public._finance_action(uuid,uuid,text,jsonb)') is not null then execute 'select public._finance_action($1,$2,$3,$4)' into result using p_family,p_key,p_action,p_data;
 else raise exception 'Действие недоступно. Проверьте применение миграций';end if;
 insert into public.kitchen_operations(id,family_id,action,payload_hash,result,actor_id)values(p_key,p_family,p_action,md5(p_data::text),result,auth.uid());return result;end$$;
