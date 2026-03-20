import Anthropic from "npm:@anthropic-ai/sdk@0.27.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const pdfFile = formData.get("pdf") as File;

    if (!pdfFile) {
      return new Response(
        JSON.stringify({ error: "Nenhum arquivo PDF enviado." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pdfBytes = await pdfFile.arrayBuffer();
    const base64PDF = btoa(
      String.fromCharCode(...new Uint8Array(pdfBytes))
    );

    const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: base64PDF,
              },
            },
            {
              type: "text",
              text: `Você é um auditor especializado em finanças condominiais brasileiras.
Analise esta prestação de contas de condomínio e retorne APENAS um JSON válido, sem texto adicional.

O JSON deve ter exatamente esta estrutura:
{
  "periodo": "Jan/2026",
  "condominio": "nome do condomínio",
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
  "receitas": [
    { "categoria": "string", "valor": 0.00, "percentual": 0.0 }
  ],
  "despesas": [
    { "categoria": "string", "valor": 0.00, "percentual": 0.0 }
  ],
  "contas_bancarias": [
    { "conta": "string", "saldo_anterior": 0.00, "creditos": 0.00, "debitos": 0.00, "saldo_final": 0.00 }
  ],
  "auditoria": {
    "score": 0,
    "alertas": [
      { "nivel": "info", "titulo": "string", "descricao": "string" }
    ],
    "pontos_positivos": ["string"],
    "resumo_auditoria": "string"
  }
}

Regras para preenchimento:
- receitas e despesas: liste todas as categorias encontradas com valor > 0
- percentual: % em relação ao total de receitas ou despesas
- superavit_deficit: receitas_total - despesas_total (positivo = superávit)
- auditoria.score: 0-100 (saúde financeira geral do condomínio)

Regras para alertas (nivel: "info", "aviso" ou "critico"):
- CRÍTICO: inadimplência > 15%, ou déficit no mês, ou soma das contas não fecha com receitas-despesas
- AVISO: inadimplência entre 5-15%, alguma categoria de despesa > 40% do total, fundo de reserva não sendo alimentado
- INFO: observações relevantes sobre o mês, sazonalidades, investimentos realizados
- pontos_positivos: liste aspectos financeiros saudáveis encontrados

Retorne APENAS o JSON, sem texto antes ou depois.`,
            },
          ],
        },
      ],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Remove markdown code blocks if present
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();

    const data = JSON.parse(cleaned);

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
