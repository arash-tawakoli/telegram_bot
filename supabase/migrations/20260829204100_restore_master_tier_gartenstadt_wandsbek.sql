-- Keep the source category aligned with the user's 65-source master table.
update public.sources
set tier='K3', poll_interval_minutes=30, updated_at=now()
where id=43 and name='Gartenstadt Wandsbek';
