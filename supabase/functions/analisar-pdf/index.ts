import Anthropic from "npm:@anthropic-ai/sdk@0.27.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function periodoParaKey(periodo: string): string {
  // "Jan/2026" → "2026-01"
  const meses: Record<string, string> = {
    jan:"01",fev:"02",mar:"03",abr:"04",mai:"05",jun:"06",
    jul:"07",ago:"08",set:"09",out:"10",nov:"11",dez:"12"
  };
  const m = periodo.toLowerCase().match(/([a-z]{3})[\/\-](\d{4})/);
  if (!m) return periodo;
  return `${m[2]}-${meses[m[1]] || "00"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const pdfFile  = formData.get("pdf")          as File   | null;
    const condoId  = formData.get("condominio_id") as string | null;
    const userId   = formData.get("user_id")       as string | null;

    if (!pdfFile) {
      return new Response(JSON.stringify({ error: "Nenhum arquivo PDF enviado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Cliente Supabase com service role para leitura/escrita
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Se tiver condominio_id, tenta buscar análise já existente pelo nome do arquivo ──
    if (condoId) {
      const nomeArquivo = pdfFile.name || "";
      const { data: existente } = await supa
        .from("analises_pdf")
        .select("resultado, periodo, created_at, nome_arquivo")
        .eq("condominio_id", condoId)
        .eq("nome_arquivo", nomeArquivo)
        .maybeSingle();

      if (existente) {
        return new Response(
          JSON.stringify({ ...existente.resultado, from_cache: true, cached_at: existente.created_at }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Analisar com Claude ──
    const pdfBytes = await pdfFile.arrayBuffer();
    const base64PDF = btoa(String.fromCharCode(...new Uint8Array(pdfBytes)));

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: base64PDF },
          },
          {
            type: "text",
            text: `Você é um auditor especializado em finanças condominiais brasileiras.
Analise esta prestação de contas e retorne APENAS um JSON válido, sem texto adicional.

{
  "periodo": "Jan/2026",
  "condominio": "nome do condomínio sem números ou parênteses",
  "administradora": "nome da administradora",
  "resumo": {
    "receitas_total": 0.00,
    "despesas_total": 0.00,
    "superavit_deficit": 0.00,
    "saldo_final": 0.00,
    "fundo_reserva": 0.00,
    "inadimplencia_percentual": 0.0,
    "inadimplencia_valor": 0.00,
    "inadimplencia_unidades": 0
  },
  "receitas": [{ "categoria": "string", "valor": 0.00, "percentual": 0.0 }],
  "despesas": [{ "categoria": "string", "valor": 0.00, "percentual": 0.0 }],
  "contas_bancarias": [{ "conta": "string", "saldo_anterior": 0.00, "creditos": 0.00, "debitos": 0.00, "saldo_final": 0.00 }],
  "auditoria": {
    "score": 0,
    "score_explicacao": "Uma frase curta (máx 12 palavras) explicando o principal fator que determinou este score",
    "alertas": [{ "nivel": "info", "titulo": "string", "descricao": "string" }],
    "pontos_positivos": ["string"],
    "resumo_auditoria": "string"
  }
}

Regras:
- condominio: apenas o nome limpo, sem código, número ou parênteses
- score: 0-100 (saúde financeira). 100=excelente, 0=crítico
- score_explicacao: frase objetiva ex: "Inadimplência de 7% reduz o score" ou "Superávit e baixa inadimplência elevam o score"
- CRÍTICO: inadimplência>15%, déficit no mês, ou números inconsistentes
- AVISO: inadimplência 5-15%, categoria de despesa >40% do total, fundo de reserva não alimentado
- INFO: observações relevantes, sazonalidades, investimentos

Retorne APENAS o JSON.`,
          },
        ],
      }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw.replace(/^```json\s*/i,"").replace(/^```\s*/i,"").replace(/\s*```$/i,"").trim();
    const data = JSON.parse(cleaned);

    // ── Salvar no banco ──
    if (condoId) {
      const periodoKey = periodoParaKey(data.periodo || "");
      await supa.from("analises_pdf").upsert({
        condominio_id: condoId,
        periodo:       data.periodo || "",
        periodo_key:   periodoKey,
        nome_arquivo:  pdfFile.name || "",
        resultado:     data,
        criado_por:    userId || null,
      }, { onConflict: "condominio_id,periodo_key" });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Erro ao analisar PDF:", err);
    return new Response(
      JSON.stringify({ error: "Falha ao processar o PDF. Tente novamente.", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
