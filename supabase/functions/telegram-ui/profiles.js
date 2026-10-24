import { home, premium, settings } from "./navigation.js";
import { db, PROPERTY_TYPES, RENT_PRESETS, ROOM_PRESETS, AREA_PRESETS, NEIGHBORHOODS_PER_PAGE, finiteOrNull, esc, money, button, cancelRow, backRow, send, edit, saveState, geography } from "./runtime.js";
export function emptyDraft(profileSlot = 1) {
    return {
        profile_slot: Math.max(1, Math.min(4, Number(profileSlot) || 1)),
        property_types: [],
        location_mode: null,
        borough_ids: [],
        neighborhood_ids: [],
        location_area_codes: [],
        area_page: 0,
        sh_area_level: "counties",
        neighborhood_page: 0,
        max_warm_rent: null,
        min_rooms: null,
        min_area_sqm: null,
        min_room_area_sqm: null,
        wbs_only: false,
        furnished_preference: "any",
        require_known_warm_rent: false,
        max_deposit: null,
        _flow: crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        _revision: 0,
    };
}

export function normalizeDraft(raw) {
    const propertyTypes = Array.isArray(raw?.property_types)
        ? raw.property_types.filter((value) => PROPERTY_TYPES.includes(String(value)))
        : raw?.type && PROPERTY_TYPES.includes(String(raw.type))
            ? [String(raw.type)]
            : [];
    const legacyMode = raw?.mode === "all_hamburg"
        ? "all_hamburg"
        : raw?.mode === "neighborhoods"
            ? "neighborhoods"
            : null;
    return {
        profile_slot: Math.max(1, Math.min(4, Number(raw?.profile_slot) || 1)),
        property_types: Array.from(new Set(propertyTypes)).slice(0, 1),
        location_mode: ["all_hamburg", "boroughs", "neighborhoods", "all_schleswig_holstein", "schleswig_holstein_areas"].includes(String(raw?.location_mode || ""))
            ? raw.location_mode
            : legacyMode,
        borough_ids: Array.isArray(raw?.borough_ids)
            ? raw.borough_ids.map(Number).filter(Number.isFinite)
            : [],
        neighborhood_ids: Array.isArray(raw?.neighborhood_ids)
            ? raw.neighborhood_ids.map(Number).filter(Number.isFinite)
            : [],
        neighborhood_page: Number.isFinite(Number(raw?.neighborhood_page))
            ? Math.max(0, Number(raw.neighborhood_page))
            : 0,
        location_area_codes: Array.isArray(raw?.location_area_codes)
            ? Array.from(new Set(raw.location_area_codes.map(String).filter((value) => /^[A-Z0-9]{2,12}$/.test(value))))
            : [],
        area_page: Number.isFinite(Number(raw?.area_page))
            ? Math.max(0, Number(raw.area_page))
            : 0,
        sh_area_level: ["counties", "municipalities", "mixed"].includes(String(raw?.sh_area_level || ""))
            ? String(raw.sh_area_level)
            : "counties",
        max_warm_rent: finiteOrNull(raw?.max_warm_rent ?? raw?.rent),
        min_rooms: finiteOrNull(raw?.min_rooms ?? raw?.rooms),
        min_area_sqm: finiteOrNull(raw?.min_area_sqm ?? raw?.area),
        min_room_area_sqm: finiteOrNull(raw?.min_room_area_sqm),
        wbs_only: raw?.wbs_only === true,
        furnished_preference: (() => {
            const value = String(raw?.furnished_preference || "any");
            if (value === "furnished") return "yes";
            if (value === "unfurnished") return "no";
            return ["any", "yes", "no"].includes(value) ? value : "any";
        })(),
        require_known_warm_rent: raw?.require_known_warm_rent === true,
        max_deposit: finiteOrNull(raw?.max_deposit),
        _flow: /^[a-f0-9]{12}$/.test(String(raw?._flow || "")) ? raw._flow : crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        _revision: Number.isInteger(Number(raw?._revision)) ? Number(raw._revision) : 0,
        edit_return: raw?.edit_return === true,
        profile_edit: raw?.profile_edit === true,
    };
}

export function draftFor(user) {
    return normalizeDraft(user?.onboarding_state || {});
}

export function includesWG(draft) {
    return draft.property_types.includes("WG");
}

export function includesWholeHome(draft) {
    return draft.property_types.some((type) => ["Wohnung", "Haus", "Tauschwohnung"].includes(type));
}

export function nextSizeStep(draft) {
    return draft.property_types.length === 1 ? "rooms" : "review";
}

async function saveDraft(user, step, draft) {
    return saveState(user.id, step, draft, user.request_update_id, user.request_attempt);
}

export function validateDraft(draft) {
    if (draft.property_types.length !== 1)
        return "types";
    if (!draft.location_mode)
        return "location";
    if (draft.location_mode === "boroughs" && !draft.borough_ids.length) {
        return "boroughs";
    }
    if (draft.location_mode === "neighborhoods" &&
        !draft.neighborhood_ids.length) {
        return "neighborhoods";
    }
    if (draft.location_mode === "schleswig_holstein_areas" &&
        !draft.location_area_codes.length) {
        return "shareas";
    }
    if (draft.max_warm_rent == null ||
        draft.max_warm_rent < 100 ||
        draft.max_warm_rent > 5000) {
        return "rent";
    }
    if (draft.min_rooms == null || !ROOM_PRESETS.has(draft.min_rooms)) {
        return "rooms";
    }
    if (draft.min_area_sqm == null ||
        (draft.min_area_sqm !== 0 && !AREA_PRESETS.has(draft.min_area_sqm))) {
        return "area";
    }
    return null;
}

export async function renderTypes(user, chatId, messageId, draft) {
    await saveDraft(user, "types", draft);
    const selected = draft.property_types[0] || "";
    const mark = (value, label) => `${selected === value ? "✅ " : ""}${label}`;
    const rows = [
        [button(mark("Wohnung", "🏢 Wohnung"), "type:Wohnung"), button(mark("Haus", "🏡 Haus"), "type:Haus")],
        [button(mark("WG", "🛏 WG-Zimmer"), "type:WG"), button(mark("Tauschwohnung", "🔁 Tauschwohnung"), "type:Tauschwohnung")],
        [button("← Start", draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "home")],
        cancelRow(),
    ];
    const text = "🏠 <b>Was möchtest du mieten?</b>\n\nWähle genau eine Wohnform. Gebiet, Warmmiete, Zimmer und Fläche bleiben für alle Wohnformen gleich.";
    return messageId
        ? edit(chatId, messageId, text, { inline_keyboard: rows })
        : send(chatId, text, { inline_keyboard: rows });
}

export async function renderLocation(user, chatId, messageId, draft) {
    await saveDraft(user, "location", draft);
    return edit(chatId, messageId, "📍 <b>Wo möchtest du suchen?</b>", {
        inline_keyboard: [
            [button(`${draft.location_mode === "all_hamburg" ? "✅ " : ""}🌐 Ganz Hamburg`, "loc:all")],
            [button(`${draft.location_mode === "boroughs" ? "✅ " : ""}🏙 Bezirke auswählen`, "loc:boroughs")],
            [button(`${draft.location_mode === "neighborhoods" ? "✅ " : ""}📍 Stadtteile auswählen`, "loc:neighborhoods")],
            [button(`${draft.location_mode === "all_schleswig_holstein" ? "✅ " : ""}🌐 Ganz Schleswig-Holstein`, "loc:all_sh")],
            [button(`${draft.location_mode === "schleswig_holstein_areas" && draft.sh_area_level === "counties" ? "✅ " : ""}🏙 Kreise / kreisfreie Städte`, "loc:counties_sh")],
            [button(`${draft.location_mode === "schleswig_holstein_areas" && draft.sh_area_level === "municipalities" ? "✅ " : ""}📍 Städte / Gemeinden`, "loc:municipalities_sh")],
            backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "types"),
            cancelRow(),
        ],
    });
}

export async function renderSchleswigHolsteinAreas(user, chatId, messageId, draft) {
    const geo = await geography();
    const allAreas = (geo.schleswigHolsteinAreas || []).filter((entry) => entry.area_type !== "state");
    const level = ["counties", "municipalities", "mixed"].includes(String(draft.sh_area_level || ""))
        ? String(draft.sh_area_level)
        : "counties";
    draft.sh_area_level = level;
    const areas = level === "counties"
        ? allAreas.filter((entry) => ["county", "independent_city"].includes(entry.area_type))
        : level === "municipalities"
            ? allAreas.filter((entry) => entry.area_type === "municipality")
            : allAreas;
    const areaByCode = new Map(allAreas.map((entry) => [String(entry.area_code), entry]));
    const pageSize = 20;
    const pages = Math.max(1, Math.ceil(areas.length / pageSize));
    const page = Math.max(0, Math.min(Number(draft.area_page || 0), pages - 1));
    draft.area_page = page;
    await saveDraft(user, "shareas", draft);
    const selected = new Set((draft.location_area_codes || []).map(String));
    const entries = areas.slice(page * pageSize, (page + 1) * pageSize);
    const rows = [];
    for (let index = 0; index < entries.length; index += 2) {
        rows.push(entries.slice(index, index + 2).map((area) => {
            const parent = area.area_type === "municipality" ? areaByCode.get(String(area.parent_code)) : null;
            const areaCode = String(area.area_code);
            const isSelected = selected.has(areaCode) ||
                (area.area_type === "municipality" && selected.has(String(area.parent_code)));
            const label = `${isSelected ? "✅ " : ""}${area.name}${parent ? ` · ${parent.name}` : ""}`;
            return button(label, `sharea:${area.area_code}`);
        }));
    }
    const allLabel = level === "counties" ? "Alle Kreise" : level === "municipalities" ? "Alle Gemeinden" : "Alle Gebiete";
    rows.push([
        button(allLabel, "sharea:all"),
        button("Auswahl löschen", "sharea:clear"),
    ], [
        button("←", "sharea:prev"),
        button(`${page + 1}/${pages}`, "noop"),
        button("→", "sharea:next"),
    ], [button("Auswahl bestätigen", "sharea:done")], backRow("location"), cancelRow());
    const heading = level === "counties"
        ? "Kreise und kreisfreie Städte"
        : level === "municipalities"
            ? "Städte und Gemeinden"
            : "Kreise und Gemeinden";
    const instructions = level === "counties"
        ? "Wähle einen oder mehrere Kreise bzw. kreisfreie Städte."
        : level === "municipalities"
            ? "Wähle einzelne Städte oder Gemeinden. Der Kreis steht zur Orientierung hinter dem Namen."
            : "Wähle Kreise oder einzelne Gemeinden. Bereits ausgewählte Kreise bleiben als gesamte Region markiert.";
    const text = `📍 <b>${heading}</b>\n\n${instructions}\n\n<b>${selected.size} Gebiete ausgewählt</b>`;
    return edit(chatId, messageId, text, { inline_keyboard: rows });
}

export async function renderBoroughs(user, chatId, messageId, draft) {
    const geo = await geography();
    await saveDraft(user, "boroughs", draft);
    const rows = [];
    for (let index = 0; index < geo.boroughs.length; index += 2) {
        rows.push(geo.boroughs.slice(index, index + 2).map((borough) => button(`${draft.borough_ids.includes(borough.id) ? "✅ " : ""}${borough.name}`, `borough:${borough.id}`)));
    }
    rows.push([
        button("Alle auswählen", "borough:all"),
        button("Auswahl löschen", "borough:clear"),
    ], backRow("location", "borough:done"), cancelRow());
    return edit(chatId, messageId, "📍 <b>Hamburger Bezirke</b>\n\nWähle einen oder mehrere der 7 Bezirke.", { inline_keyboard: rows });
}

export async function renderNeighborhoods(user, chatId, messageId, draft) {
    const geo = await geography();
    const pages = Math.max(1, Math.ceil(geo.neighborhoods.length / NEIGHBORHOODS_PER_PAGE));
    const page = Math.max(0, Math.min(draft.neighborhood_page, pages - 1));
    draft.neighborhood_page = page;
    await saveDraft(user, "neighborhoods", draft);
    const entries = geo.neighborhoods.slice(page * NEIGHBORHOODS_PER_PAGE, (page + 1) * NEIGHBORHOODS_PER_PAGE);
    const rows = [];
    for (let index = 0; index < entries.length; index += 2) {
        rows.push(entries.slice(index, index + 2).map((neighborhood) => button(`${draft.neighborhood_ids.includes(neighborhood.id) ? "✅ " : ""}${neighborhood.name}`, `neighborhood:${neighborhood.id}`)));
    }
    rows.push([
        button("Alle auswählen", "neighborhood:all"),
        button("Auswahl löschen", "neighborhood:clear"),
    ], [
        button("←", "neighborhood:prev"),
        button(`${page + 1}/${pages}`, "noop"),
        button("→", "neighborhood:next"),
    ], backRow("location", "neighborhood:done"), cancelRow());
    return edit(chatId, messageId, `📍 <b>Hamburger Stadtteile</b>\n\nWähle beliebig viele Stadtteile.\n\n<b>${draft.neighborhood_ids.length}/${geo.neighborhoods.length} ausgewählt</b>`, { inline_keyboard: rows });
}

export async function renderRent(user, chatId, messageId, draft) {
    await saveDraft(user, "rent", draft);
    const customSelected = draft.max_warm_rent != null &&
        !RENT_PRESETS.has(draft.max_warm_rent);
    const question = "💶 <b>Wie hoch darf die Warmmiete maximal sein?</b>";
    return edit(chatId, messageId, question, {
        inline_keyboard: [
            [
                button(`${draft.max_warm_rent === 800 ? "✅ " : ""}800 €`, "rent:800"),
                button(`${draft.max_warm_rent === 1000 ? "✅ " : ""}1.000 €`, "rent:1000"),
            ],
            [
                button(`${draft.max_warm_rent === 1250 ? "✅ " : ""}1.250 €`, "rent:1250"),
                button(`${draft.max_warm_rent === 2000 ? "✅ " : ""}2.000 €`, "rent:2000"),
            ],
            [button(customSelected
                    ? `✅ Eigener Betrag · ${money(draft.max_warm_rent)}`
                    : "✏️ Eigener Betrag", "rent:custom")],
            backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "location"),
            cancelRow(),
        ],
    });
}

export async function renderCustomRent(user, chatId, messageId, draft) {
    await saveDraft(user, "rent_custom", draft);
    const current = draft.max_warm_rent != null
        ? `\n\nAktuell gespeichert: <b>${esc(money(draft.max_warm_rent))}</b>`
        : "";
    return edit(chatId, messageId, `Gib die maximale Warmmiete als Zahl ein, z. B. <code>1250</code>.\n\n<b>Erlaubt: 100 bis 5.000 €</b>${current}`, { inline_keyboard: [backRow("rent"), cancelRow()] });
}

export async function renderRooms(user, chatId, messageId, draft) {
    await saveDraft(user, "rooms", draft);
    const question = "🚪 <b>Wie viele Zimmer brauchst du mindestens?</b>";
    return edit(chatId, messageId, question, {
        inline_keyboard: [
            [
                button(`${draft.min_rooms === 1 ? "✅ " : ""}1+`, "rooms:1"),
                button(`${draft.min_rooms === 2 ? "✅ " : ""}2+`, "rooms:2"),
            ],
            [
                button(`${draft.min_rooms === 3 ? "✅ " : ""}3+`, "rooms:3"),
                button(`${draft.min_rooms === 4 ? "✅ " : ""}4+`, "rooms:4"),
            ],
            backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rent"),
            cancelRow(),
        ],
    });
}

export async function renderArea(user, chatId, messageId, draft) {
    await saveDraft(user, "area", draft);
    const question = "📐 <b>Wie groß soll die Fläche mindestens sein?</b>";
    return edit(chatId, messageId, question, {
        inline_keyboard: [
            [
                button(`${draft.min_area_sqm === 20 ? "✅ " : ""}20 m²`, "area:20"),
                button(`${draft.min_area_sqm === 50 ? "✅ " : ""}50 m²`, "area:50"),
            ],
            [
                button(`${draft.min_area_sqm === 70 ? "✅ " : ""}70 m²`, "area:70"),
                button(`${draft.min_area_sqm === 90 ? "✅ " : ""}90 m²`, "area:90"),
            ],
            backRow(draft.profile_edit ? `profile:edit:${draft.profile_slot}` : "rooms"),
            cancelRow(),
        ],
    });
}

export async function selectedPlaces(draft) {
    const geo = await geography();
    if (draft.location_mode === "all_schleswig_holstein") {
        return {
            location: "Ganz Schleswig-Holstein",
            districts: ["Ganz Schleswig-Holstein"],
            boroughs: [],
            neighborhoods: [],
            location_area_codes: [],
        };
    }
    if (draft.location_mode === "schleswig_holstein_areas") {
        const codes = new Set((draft.location_area_codes || []).map(String));
        const selected = (geo.schleswigHolsteinAreas || []).filter((area) => area.area_type !== "state" && codes.has(String(area.area_code)));
        const names = selected.map((area) => area.name);
        const location = names.length > 5 ? `${names.slice(0, 5).join(", ")} … (+${names.length - 5})` : names.join(", ");
        return {
            location: location || "Schleswig-Holstein",
            districts: names,
            boroughs: [],
            neighborhoods: [],
            location_area_codes: [...codes],
        };
    }
    if (draft.location_mode === "boroughs") {
        const selectedIds = new Set(draft.borough_ids);
        const boroughs = geo.boroughs
            .filter((value) => selectedIds.has(value.id))
            .map((value) => value.name);
        const districts = geo.neighborhoods
            .filter((value) => selectedIds.has(value.borough_id))
            .map((value) => value.name);
        return {
            location: boroughs.join(", "),
            districts,
            boroughs,
            neighborhoods: [],
        };
    }
    if (draft.location_mode === "neighborhoods") {
        const selectedIds = new Set(draft.neighborhood_ids);
        const selected = geo.neighborhoods.filter((value) => selectedIds.has(value.id));
        const neighborhoods = selected.map((value) => value.name);
        const boroughIdSet = new Set(selected.map((value) => value.borough_id));
        const boroughs = geo.boroughs
            .filter((value) => boroughIdSet.has(value.id))
            .map((value) => value.name);
        const location = neighborhoods.length > 12
            ? `${neighborhoods.slice(0, 12).join(", ")} … (+${neighborhoods.length - 12})`
            : neighborhoods.join(", ");
        return {
            location,
            districts: neighborhoods,
            boroughs,
            neighborhoods,
        };
    }
    return {
        location: "Ganz Hamburg",
        districts: ["Ganz Hamburg"],
        boroughs: [],
        neighborhoods: [],
    };
}

export async function renderReview(user, chatId, messageId, draft) {
    const issue = validateDraft(draft);
    if (issue)
        return renderStep(user, chatId, messageId, draft, issue);
    const places = await selectedPlaces(draft);
    await saveDraft(user, "review", draft);
    const text = "✅ <b>Suchprofil prüfen</b>\n\n" +
        `🏠 <b>Typ:</b> ${esc(draft.property_types[0] || "–")}\n` +
        `📍 <b>Gebiet:</b> ${esc(places.location)}\n` +
        `💶 <b>Warmmiete:</b> bis ${esc(money(draft.max_warm_rent))}\n` +
        `🚪 <b>Zimmer:</b> ${esc(draft.min_rooms)}+\n` +
        `📐 <b>Fläche:</b> ${Number(draft.min_area_sqm || 0) > 0 ? `${esc(draft.min_area_sqm)} m²+` : "egal"}`;
    return edit(chatId, messageId, text, {
        inline_keyboard: [
            [button("✅ Suche aktivieren", "profile:save")],
            [button("🏠 Typ", "edit:types"), button("📍 Gebiet", "edit:location")],
            [button("💶 Miete", "edit:rent")],
            [button("🚪 Zimmer", "edit:rooms"), button("📐 Fläche", "edit:area")],
            backRow("area"),
            cancelRow(),
        ],
    });
}

export function renderStep(user, chatId, messageId, draft, step) {
    if (step === "types")
        return renderTypes(user, chatId, messageId, draft);
    if (step === "location")
        return renderLocation(user, chatId, messageId, draft);
    if (step === "boroughs")
        return renderBoroughs(user, chatId, messageId, draft);
    if (step === "neighborhoods") {
        return renderNeighborhoods(user, chatId, messageId, draft);
    }
    if (step === "shareas")
        return renderSchleswigHolsteinAreas(user, chatId, messageId, draft);
    if (step === "rent")
        return renderRent(user, chatId, messageId, draft);
    if (step === "rent_custom") {
        return renderCustomRent(user, chatId, messageId, draft);
    }
    if (step === "roomarea")
        return renderRooms(user, chatId, messageId, draft);
    if (step === "rooms")
        return renderRooms(user, chatId, messageId, draft);
    if (step === "area")
        return renderArea(user, chatId, messageId, draft);
    return renderReview(user, chatId, messageId, draft);
}

export async function afterSelection(user, chatId, messageId, draft, next) {
    if (draft.profile_edit) {
        const slot = draft.profile_slot;
        delete draft.profile_edit;
        delete draft.edit_return;
        await persistProfile(user, draft);
        return profile(user, chatId, messageId, slot);
    }
    if (draft.edit_return) {
        delete draft.edit_return;
        return renderReview(user, chatId, messageId, draft);
    }
    return renderStep(user, chatId, messageId, draft, next);
}

export async function persistProfile(user, draft) {
    const issue = validateDraft(draft);
    if (issue)
        throw new Error(`incomplete profile: ${issue}`);
    const places = await selectedPlaces(draft);
    const values = {
        ...draft,
        // The database derives SH district labels from canonical area codes.
        // Avoid duplicating 1,100+ municipality names in the RPC payload.
        districts: draft.location_mode === "schleswig_holstein_areas" ? [] : places.districts,
        boroughs: places.boroughs,
        neighborhoods: places.neighborhoods,
        min_rooms: draft.min_rooms,
        min_area_sqm: draft.min_area_sqm,
        min_room_area_sqm: 0,
    };
    const { data, error } = await db.rpc("save_search_profile_ui", {
        p_user: user.id,
        p_update_id: user.request_update_id,
        p_attempt: user.request_attempt,
        p_values: values,
    });
    if (error)
        throw error;
    return data || null;
}

export function profileLimit(user) { return user.is_premium ? 4 : 1; }

export function profileLocation(current) {
    if (current.location_mode === "all_schleswig_holstein")
        return "Ganz Schleswig-Holstein";
    if (current.location_mode === "schleswig_holstein_areas")
        return (current.districts || []).join(", ") || "Schleswig-Holstein";
    return current.location_mode === "all_hamburg"
        ? "Ganz Hamburg"
        : current.location_mode === "boroughs"
            ? (current.boroughs || []).join(", ") || "Hamburg"
            : (current.neighborhoods || []).join(", ") ||
                (current.districts || []).join(", ") ||
                "Hamburg";
}

export async function draftFromProfile(current) {
    const geo = await geography();
    const boroughNames = new Set((Array.isArray(current.boroughs) ? current.boroughs : []).map(String));
    const neighborhoodSource = Array.isArray(current.neighborhoods) &&
        current.neighborhoods.length
        ? current.neighborhoods
        : current.location_mode === "neighborhoods" && Array.isArray(current.districts)
            ? current.districts
            : [];
    const neighborhoodNames = new Set(neighborhoodSource.map(String));
    return normalizeDraft({
        profile_slot: current.profile_slot,
        property_types: current.property_types || [],
        location_mode: current.location_mode,
        borough_ids: geo.boroughs
            .filter((entry) => boroughNames.has(String(entry.name)))
            .map((entry) => entry.id),
        neighborhood_ids: geo.neighborhoods
            .filter((entry) => neighborhoodNames.has(String(entry.name)))
            .map((entry) => entry.id),
        location_area_codes: Array.isArray(current.location_area_codes) ? current.location_area_codes.map(String) : [],
        area_page: 0,
        sh_area_level: (() => {
            const selectedCodes = new Set((current.location_area_codes || []).map(String));
            const selectedTypes = geo.schleswigHolsteinAreas
                .filter((area) => selectedCodes.has(String(area.area_code)))
                .map((area) => area.area_type);
            const hasCounty = selectedTypes.some((type) => ["county", "independent_city"].includes(type));
            const hasMunicipality = selectedTypes.includes("municipality");
            return hasCounty && hasMunicipality ? "mixed" : hasMunicipality ? "municipalities" : "counties";
        })(),
        neighborhood_page: 0,
        max_warm_rent: current.max_warm_rent,
        min_rooms: current.min_rooms,
        min_area_sqm: current.min_area_sqm,
        min_room_area_sqm: current.min_room_area_sqm,
        wbs_only: current.wbs_only,
        furnished_preference: current.furnished_preference,
        require_known_warm_rent: current.require_known_warm_rent,
        max_deposit: current.max_deposit,
        profile_edit: true,
    });
}

export async function startNewProfile(user, chatId, messageId, requestedSlot) {
    const limit = profileLimit(user);
    const { data, error } = await db.from("search_profiles").select("profile_slot").eq("user_id", user.id).order("profile_slot");
    if (error)
        throw error;
    const used = new Set((data || []).map((row) => Number(row.profile_slot)));
    const slot = requestedSlot && requestedSlot >= 1 && requestedSlot <= limit
        ? requestedSlot
        : Array.from({ length: limit }, (_, i) => i + 1).find((value) => !used.has(value));
    if (!slot)
        return profile(user, chatId, messageId);
    const draft = { ...emptyDraft(slot), _revision: Number(user?.onboarding_state?._revision || 0) };
    return renderTypes({ ...user, onboarding_state: draft }, chatId, messageId, draft);
}

export async function profileEditMenu(user, chatId, messageId, selectedSlot) {
    if (!Number.isInteger(selectedSlot) || selectedSlot < 1 || selectedSlot > profileLimit(user)) {
        return profile(user, chatId, messageId);
    }
    const { data: current, error } = await db
        .from("search_profiles")
        .select("*")
        .eq("user_id", user.id)
        .eq("profile_slot", selectedSlot)
        .maybeSingle();
    if (error)
        throw error;
    if (!current)
        return profile(user, chatId, messageId);
    await saveState(user.id, null, user.onboarding_state || {}, user.request_update_id, user.request_attempt);
    const text = "✏️ <b>Suchprofil ändern</b>\n\n" +
        "Wähle, was du ändern möchtest. Deine aktuell gespeicherten Werte bleiben vorausgewählt.\n\n" +
        `🏠 <b>Typ:</b> ${esc((current.property_types || []).join(", "))}\n` +
        `📍 <b>Gebiet:</b> ${esc(profileLocation(current))}\n` +
        `💶 <b>Warmmiete:</b> bis ${esc(money(current.max_warm_rent))}\n` +
        `🚪 <b>Zimmer:</b> ${esc(current.min_rooms ?? "–")}+\n` +
        `📐 <b>Fläche:</b> ${Number(current.min_area_sqm || 0) > 0 ? `${esc(current.min_area_sqm)} m²+` : "egal"}`;
    const markup = { inline_keyboard: [
            [button("🏠 Wohnform", `profile:edit-field:${selectedSlot}:types`)],
            [button("📍 Gebiet", `profile:edit-field:${selectedSlot}:location`)],
            [button("💶 Warmmiete", `profile:edit-field:${selectedSlot}:rent`)],
            [button("🚪 Zimmer", `profile:edit-field:${selectedSlot}:rooms`), button("📐 Fläche", `profile:edit-field:${selectedSlot}:area`)],
            [button("← Suchprofil", `profile:view:${selectedSlot}`)],
        ] };
    return edit(chatId, messageId, text, markup);
}

export async function profile(user, chatId, messageId, selectedSlot) {
    const limit = profileLimit(user);
    const { data, error } = await db.from("search_profiles").select("*").eq("user_id", user.id).lte("profile_slot", limit).order("profile_slot");
    if (error)
        throw error;
    const profiles = data || [];
    if (selectedSlot) {
        const current = profiles.find((row) => Number(row.profile_slot) === selectedSlot);
        if (!current)
            return profile(user, chatId, messageId);
        const location = profileLocation(current);
        const text = `🔎 <b>${esc(current.name || `Meine Suche ${selectedSlot}`)}</b>\n\n` +
            `Status: ${current.is_active ? "aktiv" : "pausiert"}\n` +
            `Typ: ${esc((current.property_types || []).join(", "))}\n` +
            `Gebiet: ${esc(location)}\n` +
            `Warmmiete: bis ${esc(money(current.max_warm_rent))}\n` +
            `Zimmer: ${esc(current.min_rooms ?? "–")}+\n` +
            `Fläche: ${Number(current.min_area_sqm || 0) > 0 ? `${esc(current.min_area_sqm)} m²+` : "egal"}`;
        const markup = { inline_keyboard: [
                [button("✏️ Suchprofil ändern", `profile:edit:${selectedSlot}`)],
                [button(current.is_active ? "⏸ Pausieren" : "▶️ Fortsetzen", current.is_active ? `profile:pause:${selectedSlot}` : `profile:resume:${selectedSlot}`)],
                [button("🗑 Profil löschen", `profile:delete:${selectedSlot}`)],
                [button("← Zurück", "profile")],
            ] };
        return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
    }
    const rows = profiles.map((row) => [button(`🔎 ${row.name || `Meine Suche ${row.profile_slot}`} · ${row.is_active ? "aktiv" : "pausiert"}`, `profile:view:${row.profile_slot}`)]);
    if (user.onboarding_step) {
        const draft = draftFor(user);
        const draftName = draft.profile_slot === 1 ? "Meine Suche" : `Meine Suche ${draft.profile_slot}`;
        const draftLocked = draft.profile_slot > limit;
        rows.push([
            button(`${draftLocked ? "🔒 " : ""}🔎 ${draftName} • Entwurf`, draftLocked ? "premium" : "draft"),
        ]);
    }
    if (profiles.length < limit)
        rows.push([button("➕ Suchprofil erstellen", "new")]);
    if (!user.is_premium && profiles.length >= 1) {
        rows.push([button("🔒 ➕ Weiteres Suchprofil · 💎 Premium", "premium")]);
    }
    rows.push([button("← Zurück", "home")]);
    const text = profiles.length
        ? `🔎 <b>Meine Suchprofile</b>\n\n${profiles.length}/${limit} Suchprofile angelegt.`
        : "🔎 <b>Meine Suchprofile</b>\n\nNoch kein Suchprofil angelegt.";
    const markup = { inline_keyboard: rows };
    return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}

export async function renderStatus(user, chatId, messageId) {
    const [profileResult, sourceResult, referralResult] = await Promise.all([
        db.from("search_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_active", true).lte("profile_slot", profileLimit(user)),
        db.from("sources").select("id", { count: "exact", head: true }),
        db.from("referrals").select("id", { count: "exact", head: true }).eq("referrer_user_id", user.id).eq("status", "rewarded"),
    ]);
    if (profileResult.error)
        throw profileResult.error;
    if (sourceResult.error)
        throw sourceResult.error;
    if (referralResult.error)
        throw referralResult.error;
    const text = "📡 <b>Systemstatus</b>\n\n" +
        `🔎 Suchprofile aktiv: ${profileResult.count || 0}/${profileLimit(user)}\n` +
        `🌐 Quellen im System: ${sourceResult.count || 0}\n` +
        `💎 Erfolgreiche Empfehlungen: ${referralResult.count || 0}\n` +
        "✅ System: online";
    const markup = { inline_keyboard: [[button("← Einstellungen", "settings")]] };
    return messageId ? edit(chatId, messageId, text, markup) : send(chatId, text, markup);
}
