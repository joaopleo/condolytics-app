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

// Retorna o usuário logado
async function getUsuarioLogado() {
  // getSession() lê do localStorage sem chamada de rede — evita falha por timing
  const { data: { session } } = await db.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await db
    .from('usuarios')
    .select('*, condominios(*)')
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
    admin:     'admin.html',
    sindico:   'sindico.html',
    conselho:  'conselho.html',
    condomino: 'condomino.html'
  };
  const destino = rotas[usuario.perfil];
  if (destino && !window.location.href.includes(destino)) {
    window.location.href = destino;
  }
  return usuario;
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
