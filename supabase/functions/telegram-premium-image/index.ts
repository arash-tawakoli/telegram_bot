import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const IMAGE_URL = `${SUPABASE_URL}/storage/v1/object/public/telegram-assets/premium/50-off-hd.jpg?v=20260903hd4`;
Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  try {
    const upstream = await fetch(IMAGE_URL, { method: req.method });
    if (!upstream.ok) return new Response("image unavailable", { status: 502 });
    return new Response(req.method === "HEAD" ? null : upstream.body, {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "x-image-size": "1200x1200",
      },
    });
  } catch (error) {
    console.error("premium_image", error);
    return new Response("premium image failure", { status: 500 });
  }
});