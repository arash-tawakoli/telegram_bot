-- RECONSTRUCTED EQUIVALENT from the live catalog captured 2026-10-21.
-- Original historical SQL bytes were not recoverable; this migration restores the observed contract.

-- Add indexes for foreign-key columns only when no valid index has the FK columns as its leading key columns.
do $$
declare
  fk record;
  v_columns text;
  v_suffix text;
  v_index_name text;
begin
  for fk in
    select con.conrelid, con.conkey, ns.nspname as schema_name, rel.relname as table_name
    from pg_constraint con
    join pg_class rel on rel.oid=con.conrelid
    join pg_namespace ns on ns.oid=rel.relnamespace
    where con.contype='f' and ns.nspname in ('public','app_private')
      and not exists (
        select 1 from pg_index i
        where i.indrelid=con.conrelid and i.indisvalid and i.indnkeyatts>=cardinality(con.conkey)
          and not exists (
            select 1
            from unnest(con.conkey) with ordinality fkcol(attnum,ord)
            join unnest(i.indkey) with ordinality ixcol(attnum,ord) on ixcol.ord=fkcol.ord
            where fkcol.attnum<>ixcol.attnum
          )
      )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord),
           string_agg(a.attname, '_' order by k.ord)
      into v_columns,v_suffix
    from unnest(fk.conkey) with ordinality k(attnum,ord)
    join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.attnum;
    v_index_name:=left('idx_'||fk.table_name||'_'||v_suffix||'_fk',63);
    execute format('create index if not exists %I on %I.%I (%s)',v_index_name,fk.schema_name,fk.table_name,v_columns);
  end loop;
end $$;
