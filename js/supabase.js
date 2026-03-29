// ─────────────────────────────────────────
// CONFIGURAÇÃO DO SUPABASE
// Condolytics — Inteligência Fiscal Condominial
// ─────────────────────────────────────────

const SUPABASE_URL = 'https://mritzsidaqngexgijoqc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1yaXR6c2lkYXFuZ2V4Z2lqb3FjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1MDIwMDcsImV4cCI6MjA4ODA3ODAwN30.LQraFLGnnNLQQ8hD3cSj47ERkwIja4xlukM-8gLQmHs';

// Inicializa o cliente Supabase
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ─────────────────────────────────────────
// FUNÇÕES DE AUTENTICAÇÃO
// ─────────────────────────────────────────

// Login com e-mail e senha
async function login(email, senha) {
  const { data, error } = await db.auth.signInWithPassword({
    email: email,
    password: senha
  });
  if (error) throw error;
  return data;
}

// Logout
async function logout() {
  const { error } = await db.auth.signOut();
  if (error) throw error;
  window.location.href = 'index.html';
}

async function trocarUsuario() {
  // Não faz logout — mantém a sessão e volta para a seleção de condomínio
  window.location.href = 'index.html?trocar=1';
}

// Retorna o usuário logado
// Usa getSession() com retry exponencial para dar tempo ao SDK
// de restaurar a sessão do localStorage após um redirect
async function getUsuarioLogado() {
  let session = null;

  for (let i = 0; i < 5; i++) {
    const { data } = await db.auth.getSession();
    if (data?.session?.user) {
      session = data.session;
      break;
    }
    // Espera crescente: 50ms, 100ms, 200ms, 400ms, 800ms
    await new Promise(r => setTimeout(r, 50 * Math.pow(2, i)));
  }

  if (!session?.user) return null;

  // CORRIGIDO: removido condominios(*) que causava HTTP 300 (ambiguidade de FK)
  // O PostgREST não sabia qual caminho usar: usuarios.condominio_id ou usuario_condominios
  const { data, error } = await db
    .from('usuarios')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (error) return null;
  return data;
}

// Redireciona para a área correta conforme o perfil
async function redirecionarPorPerfil() {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    window.location.href = 'index.html';
    return;
  }

  const rotas = {
    admin: 'admin.html',
    sindico: 'sindico.html',
    conselho: 'conselho.html',
    condomino: 'condomino.html'
  };

  const destino = rotas[usuario.perfil];
  if (destino && !window.location.href.includes(destino)) {
    window.location.href = destino;
  }
  return usuario;
}

// ─────────────────────────────────────────
// SCORE DE SAÚDE FINANCEIRA
// Cálculo determinístico — fonte única de verdade
// ─────────────────────────────────────────

const SCORE_META_FUNDO = 380000;

/**
 * Calcula o score (0–100) a partir de parâmetros normalizados.
 * @param {object} p
 *   inadimplenciaPct  – % de inadimplência (ex: 9.0)
 *   receitaRealizada  – receita do mês
 *   despesaRealizada  – despesa do mês
 *   fundoReserva      – saldo do fundo de reserva
 *   saldoConta        – saldo em conta corrente
 *   despesas          – array de { categoria, valor }
 */
function calcularScore({ inadimplenciaPct, receitaRealizada, despesaRealizada, fundoReserva, saldoConta, despesas }) {
  // 1. Inadimplência (0–30)
  const i = inadimplenciaPct ?? 0;
  const ptInad = i === 0 ? 30 : i <= 3 ? 26 : i <= 6 ? 22 : i <= 10 ? 20 : i <= 15 ? 12 : 0;

  // 2. Equilíbrio orçamentário (0–25)
  const rec  = receitaRealizada ?? 0;
  const desp = despesaRealizada ?? 0;
  const superavitPct = rec > 0 ? (rec - desp) / rec * 100 : 0;
  const ptEquil = superavitPct >= 5 ? 25 : superavitPct >= 0 ? 18 : superavitPct >= -5 ? 10 : 0;

  // 3. Fundo de Reserva (0–20)
  const fundoPct = ((fundoReserva ?? 0) / SCORE_META_FUNDO) * 100;
  const ptFundo = fundoPct >= 100 ? 20 : fundoPct >= 80 ? 16 : fundoPct >= 60 ? 16 : fundoPct >= 40 ? 10 : 0;

  // 4. Concentração de despesas — excluindo AMALPES (0–15)
  const despSem = (despesas || []).filter(d => d.categoria !== 'taxa_amalpes');
  const totSem  = despSem.reduce((s, d) => s + (d.valor || 0), 0);
  const maxDesp = despSem.length ? Math.max(...despSem.map(d => d.valor || 0)) : 0;
  const concPct = totSem > 0 ? (maxDesp / totSem) * 100 : 0;
  const ptConc  = concPct <= 35 ? 15 : concPct <= 55 ? 12 : concPct <= 70 ? 8 : 0;

  // 5. Liquidez (0–10)
  const saldo = saldoConta ?? 0;
  const ratio = desp > 0 ? saldo / desp : 0;
  const ptLiq = ratio >= 3 ? 10 : ratio >= 2 ? 7 : ratio >= 1 ? 4 : 0;

  return {
    total: ptInad + ptEquil + ptFundo + ptConc + ptLiq,
    breakdown: [
      { label: 'Inadimplência', pts: ptInad, max: 30 },
      { label: 'Equilíbrio',    pts: ptEquil, max: 25 },
      { label: 'Fundo Reserva', pts: ptFundo, max: 20 },
      { label: 'Concentração',  pts: ptConc,  max: 15 },
      { label: 'Liquidez',      pts: ptLiq,   max: 10 },
    ]
  };
}

// Protege páginas — redireciona para login se não autenticado
async function protegerPagina(perfisPermitidos = []) {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    window.location.href = 'index.html';
    return null;
  }

  if (perfisPermitidos.length > 0 &&
      !perfisPermitidos.includes(usuario.perfil)) {
    window.location.href = 'index.html';
    return null;
  }

  return usuario;
}
