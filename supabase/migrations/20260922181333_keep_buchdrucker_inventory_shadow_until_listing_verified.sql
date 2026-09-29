update public.sources
set runtime_mode='shadow', delivery_mode='shadow', updated_at=now()
where id=60;