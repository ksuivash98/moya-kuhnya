insert into public.kitchen_modules values(6);
create table public.shopping_items(id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),product_id uuid not null references public.products(id),quantity numeric(18,4) not null check(quantity>0),unit text not null,month date not null,source text not null default 'manual' check(source in ('manual','generated')),status text not null default 'open' check(status in ('open','purchased','cancelled')),category text not null default 'Другое',version integer not null default 1,created_at timestamptz not null default now());
create unique index shopping_generated_open_idx on public.shopping_items(family_id,month,product_id,unit)where source='generated' and status='open';
create table public.purchases(id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),shopping_item_id uuid not null references public.shopping_items(id),batch_id uuid not null references public.stock_batches(id),quantity numeric(18,4) not null check(quantity>0),unit text not null,amount numeric(18,2)not null check(amount>=0),date date not null,status text not null default 'confirmed' check(status in ('confirmed','reversed')),expense_id uuid,created_at timestamptz not null default now());
create unique index purchase_once_idx on public.purchases(shopping_item_id)where status='confirmed';
create table public.expenses(id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),purchase_id uuid unique references public.purchases(id),title text not null,category text not null,amount numeric(18,2)not null check(amount>=0),date date not null,notes text not null default '',version integer not null default 1,created_at timestamptz not null default now());
alter table public.purchases add constraint purchase_expense_fk foreign key(expense_id)references public.expenses(id);
create table public.financial_movements(id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),expense_id uuid not null references public.expenses(id),amount numeric(18,2)not null,date date not null,category text not null,reason text not null,operation_id uuid not null,created_at timestamptz not null default now());
create table public.monthly_budgets(id uuid primary key default gen_random_uuid(),family_id uuid not null references public.families(id),month date not null,amount numeric(18,2)not null check(amount>=0),version integer not null default 1,unique(family_id,month),check(month=date_trunc('month',month)::date));
do $$declare t text;begin foreach t in array array['shopping_items','purchases','expenses','financial_movements','monthly_budgets']loop execute format('alter table public.%I enable row level security',t);execute format('create policy family_read on public.%I for select to authenticated using(public.is_family_member(family_id))',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('create index %I on public.%I(family_id)',t||'_family_idx',t);end loop;end$$;
create function public.kitchen_requirements(p_family uuid,p_month date)returns table(name text,unit text,required numeric,available numeric,missing numeric) language sql stable security invoker set search_path='' as $$
 with plans as (
 select m.recipe_snapshot snapshot,m.servings*greatest(0,m.planned_count-public.kitchen_menu_done(m.id)-(select count(*)from public.cooking_tasks t where t.menu_id=m.id and t.status not in ('Приготовлено','Отменено'))) servings from public.menu_items m where m.family_id=p_family and m.month=p_month and m.status not in ('Отменено','Приготовлено','Сделана заготовка','Приготовлено из заготовки')
 union all select t.recipe_snapshot,t.servings from public.cooking_tasks t where t.family_id=p_family and date_trunc('month',t.date)::date=p_month and t.status not in ('Приготовлено','Отменено')
 ), required as(select public.product_key(i->>'name') name,public.base_unit(i->>'unit') unit,sum((i->>'amount')::numeric*p.servings/(p.snapshot->>'servings')::numeric*public.unit_factor(i->>'unit'))qty from plans p cross join lateral jsonb_array_elements(p.snapshot->'ingredients')i where i->>'unit'<>'по вкусу' group by 1,2), amounts as(select r.name,r.unit,r.qty,coalesce((select sum(b.quantity)from public.stock_batches b join public.products p on p.id=b.product_id where b.family_id=p_family and p.name_key=r.name and b.unit=r.unit and (b.expires_on is null or b.expires_on>=timezone('Asia/Yekaterinburg',now())::date)),0)stock from required r) select name,unit,qty,stock,greatest(0,qty-stock)from amounts where qty>0;
$$;
create function public._finance_action(f uuid,k uuid,a text,d jsonb)returns jsonb language plpgsql security definer set search_path='' as $$
declare rid uuid:=coalesce((d->>'id')::uuid,gen_random_uuid());item public.shopping_items;buy public.purchases;expense public.expenses;budget public.monthly_budgets;b public.stock_batches;p public.products;need record;qty numeric;price numeric;u text;pl uuid;eid uuid;bid uuid;total numeric;period date;begin
 if a='shopping_generate' then
  period:=date_trunc('month',(d->>'month')::date)::date;
  update public.shopping_items set status='cancelled',version=version+1 where family_id=f and month=period and source='generated' and status='open';
  for need in select * from public.kitchen_requirements(f,period)where missing>0 loop
   select * into p from public.products where family_id=f and name_key=need.name;
   if not found then insert into public.products(family_id,name,name_key,unit)values(f,need.name,need.name,need.unit)returning * into p;end if;
   insert into public.shopping_items(family_id,product_id,quantity,unit,month,source,category)values(f,p.id,need.missing,need.unit,period,'generated',p.category);
  end loop;return jsonb_build_object('generated',true);
 elsif a='shopping_save' then
  select * into item from public.shopping_items where id=rid;
  if found and (item.family_id<>f or item.version is distinct from(d->>'version')::integer or item.status='purchased')then raise exception 'Позиция изменена или уже куплена';end if;
  select * into p from public.products where id=(d->>'product_id')::uuid and family_id=f and not archived;if not found then raise exception 'Сначала добавьте продукт в каталог';end if;
  qty:=public.kitchen_number(d->>'quantity')*public.unit_factor(d->>'unit');if d->>'status'not in ('open','cancelled')then raise exception 'Покупка подтверждается отдельно';end if;
  insert into public.shopping_items(id,family_id,product_id,quantity,unit,month,category,status)values(rid,f,p.id,qty,public.base_unit(d->>'unit'),date_trunc('month',(d->>'month')::date)::date,p.category,d->>'status')on conflict(id)do update set quantity=excluded.quantity,unit=excluded.unit,month=excluded.month,status=excluded.status,product_id=excluded.product_id,category=excluded.category,version=public.shopping_items.version+1;return jsonb_build_object('id',rid);
 elsif a='purchase_confirm' then
  select * into item from public.shopping_items where id=(d->>'id')::uuid and family_id=f;
  if not found or item.status<>'open' or item.version is distinct from(d->>'version')::integer then raise exception 'Позиция уже куплена или изменена';end if;
  u:=public.base_unit(d->>'unit');if u<>item.unit then raise exception 'Несовместимые единицы. Измените список или выберите совместимую единицу';end if;
  qty:=public.kitchen_number(d->>'quantity')*public.unit_factor(d->>'unit');price:=round(public.kitchen_number(d->>'amount'),2);if qty<=0 then raise exception 'Укажите фактически купленное количество';end if;
  pl:=nullif(d->>'place_id','')::uuid;if pl is not null and not exists(select 1 from public.storage_places where id=pl and family_id=f)then raise exception 'Место недоступно';end if;
  bid:=gen_random_uuid();insert into public.stock_batches(id,family_id,product_id,quantity,unit,purchased_on,expires_on,place_id,notes)values(bid,f,item.product_id,qty,u,(d->>'date')::date,nullif(d->>'expires_on','')::date,pl,'Покупка');
  insert into public.stock_movements(family_id,batch_id,quantity,reason,operation_id)values(f,bid,qty,'Покупка',k);
  rid:=gen_random_uuid();eid:=gen_random_uuid();insert into public.purchases(id,family_id,shopping_item_id,batch_id,quantity,unit,amount,date)values(rid,f,item.id,bid,qty,u,price,(d->>'date')::date);
  select * into p from public.products where id=item.product_id;
  insert into public.expenses(id,family_id,purchase_id,title,category,amount,date)values(eid,f,rid,p.name,item.category,price,(d->>'date')::date);insert into public.financial_movements(family_id,expense_id,amount,date,category,reason,operation_id)values(f,eid,price,(d->>'date')::date,item.category,'Покупка',k);
  update public.purchases set expense_id=eid where id=rid;update public.shopping_items set status='purchased',version=version+1 where id=item.id;return jsonb_build_object('id',rid);
 elsif a='purchase_reverse' then
  select * into buy from public.purchases where id=rid and family_id=f;if not found or buy.status<>'confirmed' then raise exception 'Покупка уже отменена или недоступна';end if;
  select * into b from public.stock_batches where id=buy.batch_id;
  if b.quantity<buy.quantity then raise exception 'Часть покупки уже использована. Автоматическая отмена создаст отрицательный остаток';end if;
  select * into expense from public.expenses where id=buy.expense_id;
  update public.stock_batches set quantity=quantity-buy.quantity,version=version+1 where id=b.id;insert into public.stock_movements(family_id,batch_id,quantity,reason,operation_id)values(f,b.id,-buy.quantity,'Отмена покупки',k);
  insert into public.financial_movements(family_id,expense_id,amount,date,category,reason,operation_id)values(f,expense.id,-expense.amount,expense.date,expense.category,'Отмена покупки',k);update public.expenses set amount=0,version=version+1 where id=expense.id;
  update public.purchases set status='reversed' where id=buy.id;update public.shopping_items set status='cancelled',version=version+1 where id=buy.shopping_item_id;return jsonb_build_object('id',rid);
 elsif a='expense_save' then
  select * into expense from public.expenses where id=rid;if found and(expense.family_id<>f or expense.version is distinct from(d->>'version')::integer)then raise exception 'Расход изменён на другом устройстве';end if;
  price:=round(public.kitchen_number(d->>'amount'),2);
  if expense.id is not null then insert into public.financial_movements(family_id,expense_id,amount,date,category,reason,operation_id)values(f,rid,-expense.amount,expense.date,expense.category,'Корректировка: отмена прежней суммы',k);end if;
  insert into public.expenses(id,family_id,title,category,amount,date,notes)values(rid,f,d->>'title',d->>'category',price,(d->>'date')::date,coalesce(d->>'notes',''))on conflict(id)do update set title=excluded.title,category=excluded.category,amount=excluded.amount,date=excluded.date,notes=excluded.notes,version=public.expenses.version+1;
  insert into public.financial_movements(family_id,expense_id,amount,date,category,reason,operation_id)values(f,rid,price,(d->>'date')::date,d->>'category','Расход / новая сумма',k);return jsonb_build_object('id',rid);
 elsif a='budget_save' then
  period:=date_trunc('month',(d->>'month')::date)::date;select * into budget from public.monthly_budgets where family_id=f and month=period;if found and budget.version is distinct from(d->>'version')::integer then raise exception 'Бюджет изменён на другом устройстве';end if;
  insert into public.monthly_budgets(family_id,month,amount)values(f,period,round(public.kitchen_number(d->>'amount'),2))on conflict(family_id,month)do update set amount=excluded.amount,version=public.monthly_budgets.version+1;return jsonb_build_object('saved',true);
 end if;raise exception 'Неизвестная финансовая операция';end$$;
create function public.kitchen_finance_summary(p_family uuid,p_from date,p_to date)returns jsonb language sql stable security invoker set search_path='' as $$
 with totals as(select coalesce(sum(amount),0)spent from public.financial_movements where family_id=p_family and date between p_from and p_to),budget as(select coalesce(sum(amount),0)amount from public.monthly_budgets where family_id=p_family and month=date_trunc('month',p_from)::date)
 select jsonb_build_object('spent',t.spent,'budget',b.amount,'remaining',b.amount-t.spent,'forecast',case when date_trunc('month',p_from)=date_trunc('month',timezone('Asia/Yekaterinburg',now()))then round(t.spent/greatest(1,extract(day from timezone('Asia/Yekaterinburg',now())))*extract(day from p_to),2)else t.spent end,
 'by_category',coalesce((select jsonb_agg(x)from(select category,sum(amount)amount from public.financial_movements where family_id=p_family and date between p_from and p_to group by category order by sum(amount)desc)x),'[]'::jsonb),
 'by_month',coalesce((select jsonb_agg(x)from(select date_trunc('month',date)::date as month,sum(amount)amount from public.financial_movements where family_id=p_family and date between (p_from-interval '5 month')::date and p_to group by 1 order by 1)x),'[]'::jsonb))from totals t,budget b;
$$;
revoke all on function public._finance_action(uuid,uuid,text,jsonb)from public,anon,authenticated;
revoke all on function public.kitchen_menu_done(uuid),public.kitchen_requirements(uuid,date),public.kitchen_finance_summary(uuid,date,date)from public,anon;grant execute on function public.kitchen_menu_done(uuid),public.kitchen_requirements(uuid,date),public.kitchen_finance_summary(uuid,date,date)to authenticated;
