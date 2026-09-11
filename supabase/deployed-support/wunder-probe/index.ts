import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(() => new Response("diagnostic endpoint retired", {
  status: 410,
  headers: { "content-type": "text/plain; charset=utf-8" },
}));
