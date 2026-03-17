import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'

const ASANA_PAT     = Deno.env.get('ASANA_PAT') ?? ''
const PROJECT_GID   = '1213716080339729'
const ASANA_BASE    = 'https://app.asana.com/api/1.0'

const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const url = `${ASANA_BASE}/projects/${PROJECT_GID}/tasks` +
      `?opt_fields=gid,name,completed,due_on,memberships.section.name,custom_fields.name,custom_fields.display_value,permalink_url` +
      `&limit=100`

    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${ASANA_PAT}` }
    })

    if (!r.ok) {
      const msg = await r.text()
      return new Response(JSON.stringify({ error: `Asana ${r.status}: ${msg}` }), { status: 502, headers: cors })
    }

    const json = await r.json()

    const tasks = (json.data ?? []).map((t: any) => ({
      gid:       t.gid,
      name:      t.name,
      completed: t.completed,
      due_on:    t.due_on,
      section:   t.memberships?.[0]?.section?.name ?? 'Sem seção',
      priority:  t.custom_fields?.find((f: any) => f.name === 'Priority')?.display_value ?? null,
      url:       t.permalink_url,
    }))

    const total = tasks.length
    const done  = tasks.filter((t: any) => t.completed).length

    return new Response(JSON.stringify({ tasks, total, done }), { headers: cors })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors })
  }
})
