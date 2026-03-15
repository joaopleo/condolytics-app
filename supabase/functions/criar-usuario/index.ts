import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    // Verificar se quem chama é admin
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Sessão inválida' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { data: usuarioLogado } = await supabaseAdmin
      .from('usuarios')
      .select('perfil')
      .eq('id', user.id)
      .single()

    if (usuarioLogado?.perfil !== 'admin') {
      return new Response(JSON.stringify({ error: 'Acesso negado' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { nome, email, senha, perfil, condominio_id } = await req.json()

    if (!nome || !email || !perfil) {
      return new Response(JSON.stringify({ error: 'Nome, e-mail e perfil são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Verificar se o e-mail já existe em auth.users
    const { data: { users: existingUsers } } = await supabaseAdmin.auth.admin.listUsers()
    const usuarioExistente = existingUsers?.find(u => u.email === email)

    let userId: string

    if (usuarioExistente) {
      // Usuário já existe — apenas adicionar ao novo condomínio
      userId = usuarioExistente.id

      // Atualizar nome/perfil em usuarios se necessário (opcional)
      // Não sobrescreve — o usuário já existe e mantém seus dados

    } else {
      // Usuário novo — criar auth user (trigger cria registro em usuarios automaticamente)
      if (!senha) {
        return new Response(JSON.stringify({ error: 'Senha obrigatória para novo usuário' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: {
          nome_completo: nome,
          perfil,
          condominio_id: condominio_id || null
        }
      })

      if (authError) {
        return new Response(JSON.stringify({ error: authError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      userId = authData.user.id
    }

    // Adicionar/atualizar vínculo com o condomínio (upsert para não duplicar)
    if (condominio_id) {
      const { error: ucError } = await supabaseAdmin
        .from('usuario_condominios')
        .upsert(
          { usuario_id: userId, condominio_id, perfil },
          { onConflict: 'usuario_id,condominio_id' }
        )

      if (ucError) {
        return new Response(JSON.stringify({ error: 'Erro ao vincular condomínio: ' + ucError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    return new Response(JSON.stringify({
      success: true,
      user_id: userId,
      usuario_existente: !!usuarioExistente
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Erro interno: ' + err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
