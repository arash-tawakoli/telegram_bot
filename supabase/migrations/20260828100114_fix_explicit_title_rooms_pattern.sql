-- Production migration mirror: robust explicit room extraction, including decimal room counts.

create or replace function app_private.enrich_listing_rooms_from_text()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  txt text := coalesce(new.title, '') || ' ' || left(coalesce(new.raw::text, ''), 12000);
  m text[];
  w text;
  n numeric;
begin
  if new.rooms is not null then return new; end if;

  m := regexp_match(txt, '(?i)([0-9]+(?:[.,][0-9]+)?)\s*[-– ]\s*Zimmer(?:\b|-Wohnung\b)');
  if m is not null then
    begin n := replace(m[1], ',', '.')::numeric; exception when others then n := null; end;
  end if;

  if n is null then
    m := regexp_match(txt, '(?i)\m(ein|eine|einen|einem|einer|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn)\M\s+(?:[[:alpha:]äöüÄÖÜß]+\s+){0,2}Zimmer(n)?\M');
    if m is not null then
      w := lower(m[1]);
      n := case w
        when 'ein' then 1 when 'eine' then 1 when 'einen' then 1 when 'einem' then 1 when 'einer' then 1
        when 'zwei' then 2 when 'drei' then 3 when 'vier' then 4 when 'fünf' then 5 when 'fuenf' then 5
        when 'sechs' then 6 when 'sieben' then 7 when 'acht' then 8 when 'neun' then 9 when 'zehn' then 10
        else null
      end;
    end if;
  end if;

  if n between 0.5 and 20 then new.rooms := n; end if;
  return new;
end;
$$;

drop trigger if exists listings_enrich_rooms_from_text on public.listings;
create trigger listings_enrich_rooms_from_text
before insert or update of title, raw, rooms
on public.listings
for each row execute function app_private.enrich_listing_rooms_from_text();
