export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);



    const kv = env.mesh_logger;

    if (url.pathname === "/api/data") {
      const id = url.searchParams.get("id");
      const key = id ? `map_${id}` : "parsed_graph";
      const data = await kv.get(key);
      if (data) return new Response(data, { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" } });
      return new Response(null, { status: 404, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache" } });
    }
    if (url.pathname === "/api/clear_cache" && !env.TURNSTILE_SECRET_KEY) {
      await kv.delete("parsed_graph");
      return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    if (url.pathname === "/api/cache" && request.method === "POST") {
      try {
        const payload = await request.json();
        
        // --- TURNSTILE VERIFICATION ---
        const token = payload.token;
        if (!token) return new Response("Missing Turnstile token", { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
        
        if (!env.TURNSTILE_SECRET_KEY) {
            return new Response("Server configuration error", { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        
        let formData = new FormData();
        formData.append("secret", env.TURNSTILE_SECRET_KEY);
        formData.append("response", token);
        const ip = request.headers.get("CF-Connecting-IP");
        if (ip) formData.append("remoteip", ip);
        
        const siteverifyResult = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            body: formData,
            method: "POST"
        });
        const outcome = await siteverifyResult.json();
        if (!outcome.success) {
            return new Response("Forbidden: Turnstile verification failed", { status: 403, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        
        // --- SIZE LIMIT CHECK (Max 25 MiB for KV) ---
        const graphStr = JSON.stringify(payload.graph || {});
        if (graphStr.length > 26214400) {
            return new Response("Payload too large (Max 25 MiB)", { status: 413, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        
        if (payload.isDemo) {
            await kv.put("parsed_graph", graphStr);
            return new Response(JSON.stringify({ id: "demo" }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        } else {
            const id = payload.fileHash || Math.random().toString(36).substring(2, 10);
            
            // ponytail: skip KV write if duplicate
            if (!(await kv.get(`map_${id}`))) {
                await kv.put(`map_${id}`, graphStr);
            }
            
            const shortUrl = `https://meshlog.camal.eu/?map=${id}`;
            
            return new Response(JSON.stringify({ id, shortUrl }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        }
      } catch (err) {
         return new Response("Invalid request", { status: 400 });
      }
    }



    // Serve static assets natively and inject analytics
    const response = await env.ASSETS.fetch(request);
    
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.includes("text/html")) {
      return new HTMLRewriter()
        .on("body", {
          element(element) {
            element.append(`<!-- Cloudflare Web Analytics --><script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "4c77aeb4a657403ca8c0edca4fb2ed42"}'></script><!-- End Cloudflare Web Analytics -->`, { html: true });
          }
        })
        .transform(response);
    }

    return response;
  }
};
