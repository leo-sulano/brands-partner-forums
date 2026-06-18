import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Set via: supabase secrets set EC2_STATUS_URL=http://<ec2-ip>:5001
// Update whenever the EC2 public IP changes (or assign an Elastic IP to avoid this).
const EC2_URL = Deno.env.get("EC2_STATUS_URL") ?? "";
const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*";

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, content-type, ngrok-skip-browser-warning",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!EC2_URL) {
    return new Response(JSON.stringify({ error: "EC2_STATUS_URL secret not configured" }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  // /active-checks → GET http://ec2:5001/active-checks
  // everything else  → POST http://ec2:5001/check-status
  const isActiveChecks = url.pathname.endsWith("/active-checks");
  const targetPath = isActiveChecks ? "/active-checks" : "/check-status";

  const authHeader = req.headers.get("Authorization") ?? "";
  const body = req.method === "POST" ? await req.text() : undefined;

  try {
    const ec2Res = await fetch(`${EC2_URL}${targetPath}`, {
      method: req.method,
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      ...(body !== undefined ? { body } : {}),
    });

    const data = await ec2Res.text();
    return new Response(data, {
      status: ec2Res.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
