
create or replace function app_private.matches_property_filters(
  p public.search_profiles,
  l public.listings
)
returns boolean
language sql
stable
set search_path=''
as $fn$
  select
    (
      case
        when coalesce(l.raw ? 'category_stream', false) then
          app_private.matches_property_category(
            p.property_types,
            coalesce(
              l.property_kind,
              case l.property_type
                when 'Wohnung' then 'apartment'
                when 'Haus' then 'house'
                when 'WG' then 'room'
                when 'Tauschwohnung' then 'apartment'
                else 'unknown'
              end
            ),
            coalesce(
              l.offer_mode,
              case
                when l.source_id in (21,22)
                  or l.property_type='Tauschwohnung'
                  or (
                    coalesce(l.title,'') ~* '(tauschwohnung|tauschangebot|wohnungstausch|\mtausche\M)'
                    and coalesce(l.title,'') !~* '(kein(e|en)?|ohne) +(tauschwohnung|wohnungstausch|tausch)'
                  )
                then 'swap'
                else 'rent'
              end
            )
          )
        else
          (
            coalesce(cardinality(p.property_types),0)=0
            or (
              lower(concat_ws(' ',l.property_type,l.title,l.district,l.address,l.raw::text))
                ~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
              and 'Tauschwohnung'=any(p.property_types)
            )
            or (
              lower(concat_ws(' ',l.property_type,l.title,l.district,l.address,l.raw::text))
                !~ '(tauschwohnung|tauschangebot|wohnungstausch|wohnung[[:space:]-]*tausch|tausche)'
              and coalesce(l.property_type,'Wohnung')=any(p.property_types)
            )
          )
      end
    )
    and
    (
      case
        when coalesce(l.raw->>'category_stream','')='room' then
          (p.min_room_area_sqm<=0 or l.area_sqm is null or l.area_sqm>=p.min_room_area_sqm)
        else
          (coalesce(p.min_rooms,0)<=0 or l.rooms is null or l.rooms>=p.min_rooms)
          and (coalesce(p.min_area_sqm,0)<=0 or l.area_sqm is null or l.area_sqm>=p.min_area_sqm)
      end
    );
$fn$;
