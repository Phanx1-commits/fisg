import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return respond({ error: 'POST required' }, 405)
  try {
    const { token, login, server, currency, balance, equity, trades, cashflows = [] } = await req.json()
    if (typeof token !== 'string' || token.length < 32 || !Array.isArray(trades) || trades.length > 5000 || !Array.isArray(cashflows) || cashflows.length > 5000) return respond({ error: 'Invalid sync payload' }, 400)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
    const tokenHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: link, error: lookupError } = await db.from('mt5_sync_links').select('user_id,mt5_login,account_currency').eq('token_hash', tokenHash).maybeSingle()
    if (lookupError) throw lookupError
    if (!link || String(login) !== link.mt5_login) return respond({ error: 'Invalid sync token or account' }, 401)
    const accountCurrency = typeof currency === 'string' ? currency.toUpperCase().slice(0, 3) : link.account_currency ?? 'USD'
    const rows = trades.map((t: Record<string, unknown>) => ({
      user_id: link.user_id, account_login: link.mt5_login, account_currency: accountCurrency, ticket: String(t.ticket), symbol: String(t.symbol), type: String(t.type),
      volume: Number(t.volume) || 0, open_time: t.open_time || null, close_time: t.close_time,
      open_price: Number(t.open_price) || 0, close_price: Number(t.close_price) || 0,
      profit: Number(t.profit) || 0, swap: Number(t.swap) || 0, commission: Number(t.commission) || 0,
      net: Number(t.net) || 0,
    }))
    if (rows.some((r) => !r.ticket || !r.symbol || !r.close_time || !Number.isFinite(Date.parse(String(r.close_time))))) return respond({ error: 'Invalid trade row' }, 400)
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db.from('mt5_trades').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,account_login,ticket' })
      if (error) throw error
    }
    const flowRows = cashflows.map((f: Record<string, unknown>) => ({
      user_id: link.user_id, account_login: link.mt5_login, account_currency: accountCurrency,
      ticket: String(f.ticket), flow_type: f.flow_type === 'deposit' ? 'deposit' : 'withdrawal',
      amount: Number(f.amount) || 0, occurred_at: f.occurred_at,
    }))
    if (flowRows.some((f) => !f.ticket || !Number.isFinite(Date.parse(String(f.occurred_at))) || !Number.isFinite(f.amount))) return respond({ error: 'Invalid cashflow row' }, 400)
    for (let i = 0; i < flowRows.length; i += 500) {
      const { error } = await db.from('mt5_cashflows').upsert(flowRows.slice(i, i + 500), { onConflict: 'user_id,account_login,ticket' })
      if (error) throw error
    }
    const linkUpdate:Record<string,unknown>={mt5_server:typeof server==='string'?server.slice(0,120):null,account_currency:accountCurrency,last_seen_at:new Date().toISOString()}
    if(Number.isFinite(Number(balance))) linkUpdate.account_balance=Number(balance)
    if(Number.isFinite(Number(equity))) linkUpdate.account_equity=Number(equity)
    await db.from('mt5_sync_links').update(linkUpdate).eq('token_hash', tokenHash)
    return respond({ ok: true, synced: rows.length, cashflows: flowRows.length })
  } catch (error) {
    console.error('MT5 sync failed:', error instanceof Error ? error.message : 'unknown error')
    return respond({ error: 'Sync failed' }, 500)
  }
})
