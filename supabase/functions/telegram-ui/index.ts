import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { isAdmin } from "./admin.js";
import { handleMessage, handleCallback } from "./handlers.js";
import { premium } from "./navigation.js";
import { SUPABASE_URL, db, secretCache, chatLanguages, secret, telegram, withPlan, finishUpdate } from "./runtime.js";
Deno.serve(async (request) => {
    let updateId=null,attempt=null;
    try {
        if (request.method === "GET" || request.method === "HEAD") {
            const url = new URL(request.url);
            if (url.searchParams.get("asset") === "premium") {
                return fetch(`${SUPABASE_URL}/functions/v1/telegram-premium-image?v=20260903hd4`, { method: request.method });
            }
        }
        if (request.method !== "POST") {
            return new Response("method not allowed", { status: 405 });
        }
        let expectedSecret = await secret("telegram_webhook_secret");
        const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
        if (suppliedSecret !== expectedSecret) {
            secretCache.delete("telegram_webhook_secret");
            expectedSecret = await secret("telegram_webhook_secret", true);
            if (suppliedSecret !== expectedSecret) {
                return new Response("unauthorized", { status: 401 });
            }
        }
        const payload = await request.json().catch(() => ({}));
        const from = payload.callback_query?.from || payload.message?.from;
        const chatId = payload.callback_query?.message?.chat?.id || payload.message?.chat?.id;
        if (!from?.id || !chatId)
            return Response.json({ ok: true, ignored: true });
        const {data:prepared,error:claimError}=await db.rpc('prepare_telegram_update',{p_payload:payload});
        const claim=prepared?.claim;
        if(claimError) throw claimError;
        if(claim===0) return Response.json({ok:true,duplicate:true});
        if(claim<0) return Response.json({ok:false,busy:true},{status:503});
        updateId=payload.update_id;attempt=claim;
        const user = await withPlan({...prepared.user, __is_new_user:prepared.is_new_user === true}, prepared.subscription ?? null);
        user.request_update_id=updateId;
        if (!user.is_active && !isAdmin(user)) {
            await finishUpdate(updateId,attempt,true);
            return Response.json({ ok: true, blocked: true });
        }
        chatLanguages.set(Number(chatId), String(user.ui_language || "de"));
        if (payload.callback_query) {
            await handleCallback(payload.callback_query, user);
        }
        else if (payload.message?.chat?.type === "private" &&
            (payload.message?.text || payload.message?.document || payload.message?.photo)) {
            await handleMessage(payload.message, user);
        }
        await finishUpdate(updateId,attempt,true);
        return Response.json({ ok: true });
    }
    catch (error) {
        if(updateId!==null && attempt!==null) {
          try {await finishUpdate(updateId,attempt,false,String(error));} catch(ackError){console.error('inbox_finish',String(ackError));}
        }
        console.error("telegram_command_runtime", error);
        return Response.json({ ok: false, error: "command_runtime_failed" }, { status: 500 });
    }
});
