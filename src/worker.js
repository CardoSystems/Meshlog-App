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

    if (url.pathname === "/api/community_maps") {
      const list = await kv.get("community_maps");
      return new Response(list || "[]", {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=30"
        }
      });
    }

    if (url.pathname === "/api/cache" && request.method === "POST") {
      try {
        const payload = await request.json();
        
        // --- TURNSTILE VERIFICATION ---
        const token = payload.token;
        const secret = env.TURNSTILE_SECRET || env.TURNSTILE_SECRET_KEY;
        const expectedAction = "turnstile-spin-v1";
        const expectedHostnames = new Set([
          "meshlog.camal.eu",
          "localhost",
          "127.0.0.1",
          "mesh-log-mapper.xperia.workers.dev"
        ]);

        if (
          typeof token !== "string" ||
          token.length === 0 ||
          token.length > 2048 ||
          !secret
        ) {
          return new Response("Forbidden: Missing or invalid Turnstile token", {
            status: 403,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

        let outcome;
        try {
          const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For");
          const verifyParams = new URLSearchParams({
            secret: secret,
            response: token
          });
          if (clientIp) verifyParams.append("remoteip", clientIp);

          const siteverifyResult = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            signal: AbortSignal.timeout(10000),
            body: verifyParams
          });

          if (!siteverifyResult.ok) {
            return new Response("Forbidden: Turnstile upstream failure", {
              status: 403,
              headers: { "Access-Control-Allow-Origin": "*" }
            });
          }
          outcome = await siteverifyResult.json();
        } catch {
          return new Response("Forbidden: Turnstile verification error", {
            status: 403,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

        // ponytail: validate action and hostname
        if (
          !outcome.success ||
          (outcome.action && outcome.action !== expectedAction) ||
          (outcome.hostname && !expectedHostnames.has(outcome.hostname))
        ) {
          return new Response("Forbidden: Turnstile verification failed", {
            status: 403,
            headers: { "Access-Control-Allow-Origin": "*" }
          });
        }

        
        // --- SIZE LIMIT CHECK (Max 25 MiB for KV) ---
        const graphStr = JSON.stringify(payload.graph || {});
        if (graphStr.length > 26214400) {
            return new Response("Payload too large (Max 25 MiB)", { status: 413, headers: { "Access-Control-Allow-Origin": "*" } });
        }
        
        if (payload.isDemo) {
            await kv.put("parsed_graph", graphStr);
            if (ctx && ctx.waitUntil) {
                ctx.waitUntil((async () => {
                    try {
                        const list = JSON.parse((await kv.get("community_maps")) || "[]");
                        const nodesCount = Array.isArray(payload.graph?.nodes) ? payload.graph.nodes.length : 0;
                        const entry = { id: "demo", name: "Demo Network", time: Date.now(), nodesCount };
                        const filtered = list.filter(m => m.id !== "demo");
                        await kv.put("community_maps", JSON.stringify([entry, ...filtered].slice(0, 10)));
                    } catch (e) {}
                })());
            }
            return new Response(JSON.stringify({ id: "demo" }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
        } else {
            const id = payload.fileHash || Math.random().toString(36).substring(2, 10);
            
            // ponytail: skip KV write if duplicate
            if (!(await kv.get(`map_${id}`))) {
                await kv.put(`map_${id}`, graphStr);
            }
            
            // Record latest community map non-blockingly
            if (ctx && ctx.waitUntil) {
                ctx.waitUntil((async () => {
                    try {
                        const list = JSON.parse((await kv.get("community_maps")) || "[]");
                        const nodesCount = Array.isArray(payload.graph?.nodes) ? payload.graph.nodes.length : 0;
                        const entry = { id, name: payload.customName || `Map ${id}`, time: Date.now(), nodesCount };
                        const filtered = list.filter(m => m.id !== id);
                        await kv.put("community_maps", JSON.stringify([entry, ...filtered].slice(0, 10)));
                    } catch (e) {}
                })());
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
