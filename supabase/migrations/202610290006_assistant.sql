insert into public.kitchen_modules values(7);
create table public.ai_requests(id uuid primary key,family_id uuid not null references public.families(id),user_id uuid not null references public.profiles(id),input jsonb not null,status text not null default 'pending'check(status in ('pending','ready','failed','applied')),result jsonb,created_at timestamptz not null default now());
create index ai_requests_quota_idx on public.ai_requests(user_id,created_at);
alter table public.ai_requests enable row level security;create policy ai_own on public.ai_requests for select to authenticated using(user_id=auth.uid()and public.is_family_member(family_id));revoke all on public.ai_requests from anon,authenticated;grant select on public.ai_requests to authenticated;
create function public.reserve_ai_request(p_family uuid,p_id uuid,p_input jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare old public.ai_requests;begin
 perform 1 from public.families where id=p_family for update;
 if not exists(select 1 from public.family_members where family_id=p_family and user_id=auth.uid()and role in ('owner','adult'))then raise exception 'ИИ-запросы доступны владельцу и взрослым участникам';end if;
 if p_input->>'mode'not in ('recommend','menu','preparations','savings')or octet_length(p_input::text)>20000 then raise exception 'Некорректный запрос';end if;
 select * into old from public.ai_requests where id=p_id;
 if found then if old.user_id<>auth.uid()or old.family_id<>p_family or old.input<>p_input then raise exception 'Идентификатор уже использован';end if;return to_jsonb(old)||jsonb_build_object('fresh',false);end if;
 if(select count(*)from public.ai_requests where user_id=auth.uid()and created_at>=date_trunc('day',timezone('Asia/Yekaterinburg',now()))at time zone 'Asia/Yekaterinburg')>=10 then raise exception 'Лимит — 10 запросов в сутки, включая неудачные';end if;
 insert into public.ai_requests(id,family_id,user_id,input)values(p_id,p_family,auth.uid(),p_input)returning * into old;return to_jsonb(old)||jsonb_build_object('fresh',true);
end$$;
create function public.apply_ai_menu(p_family uuid,p_id uuid,p_key uuid,p_items jsonb)returns jsonb language plpgsql security definer set search_path='' as $$declare r public.ai_requests;i jsonb;result jsonb:='[]';prior public.kitchen_operations;begin
 perform 1 from public.families where id=p_family for update;if not public.can_edit_family(p_family)then raise exception 'Недостаточно прав';end if;
 select * into prior from public.kitchen_operations where family_id=p_family and id=p_key;if found then if prior.action<>'ai_apply' or prior.payload_hash<>md5(p_items::text)then raise exception 'Идентификатор уже использован';end if;return prior.result;end if;
 select * into r from public.ai_requests where id=p_id and family_id=p_family and user_id=auth.uid()for update;
 if not found or r.status<>'ready' or r.input->>'mode'<>'menu' or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then raise exception 'Предложение недоступно или уже принято';end if;
 for i in select * from jsonb_array_elements(p_items)loop
  if (i->>'date')::date<(r.input->>'from')::date or(i->>'date')::date>(r.input->>'to')::date then raise exception 'Дата вне запрошенного периода';end if;
  result:=result||jsonb_build_array(public._planning_action(p_family,p_key,'menu_save',i||jsonb_build_object('id',gen_random_uuid(),'month',date_trunc('month',(i->>'date')::date)::date,'planned_count',1,'status','Запланировано')));
 end loop;
 update public.ai_requests set status='applied'where id=p_id;
 insert into public.kitchen_operations(id,family_id,action,payload_hash,result,actor_id)values(p_key,p_family,'ai_apply',md5(p_items::text),result,auth.uid());return result;
end$$;
revoke all on function public.reserve_ai_request(uuid,uuid,jsonb),public.apply_ai_menu(uuid,uuid,uuid,jsonb)from public,anon;grant execute on function public.reserve_ai_request(uuid,uuid,jsonb),public.apply_ai_menu(uuid,uuid,uuid,jsonb)to authenticated;
