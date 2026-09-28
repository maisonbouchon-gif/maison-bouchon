// Lit un devis ou une facture (PDF ou photo) avec Claude et renvoie les champs à pré-remplir.
// Secret requis : ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

const SCHEMA = {
  type: "object",
  properties: {
    entreprise: { type: ["string", "null"] },
    objet: { type: ["string", "null"] },
    montant_ttc: { type: ["number", "null"] },
    montant_ht: { type: ["number", "null"] },
    date: { type: ["string", "null"] },
    theme: { type: ["string", "null"] },
  },
  required: ["entreprise", "objet", "montant_ttc", "montant_ht", "date", "theme"],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Seules les personnes de la table « famille » peuvent utiliser la lecture.
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: autorise } = await supabase.rpc("est_famille");
  if (!autorise) return json({ error: "non autorisé" }, 403);

  const { kind, themes, mediaType, data } = await req.json();
  if (typeof data !== "string" || !data) return json({ error: "document manquant" }, 400);

  const doc = mediaType === "application/pdf"
    ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } }
    : { type: "image" as const, source: { type: "base64" as const, media_type: mediaType, data } };

  const consigne =
    `Tu lis ${kind === "devis" ? "un devis d'artisan" : "une facture"} pour la construction de la maison du foyer Bouchon (le client). ` +
    `Donne : entreprise (raison sociale de l'émetteur, jamais le client), objet (description courte des travaux, 60 caractères max), ` +
    `montant_ttc (total TTC à payer, sans acompte déduit), montant_ht, date (AAAA-MM-JJ), ` +
    `theme (le plus proche parmi ${JSON.stringify(themes ?? [])}, recopié exactement). Mets null quand une information est absente.`;

  try {
    const response = await anthropic.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 2000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: [doc, { type: "text", text: consigne }] }],
    } as any);
    if (response.stop_reason === "refusal") return json({ error: "lecture refusée" }, 422);
    const text = response.content.find((b: { type: string }) => b.type === "text") as { text?: string } | undefined;
    return json(JSON.parse(text?.text ?? "{}"));
  } catch (e) {
    console.error(e);
    return json({ error: "lecture impossible" }, 502);
  }
});
