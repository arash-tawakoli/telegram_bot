Deno.serve(() => Response.json({error:"retired",message:"This legacy endpoint has been retired. Use the Telegram bot."},{status:410}));
