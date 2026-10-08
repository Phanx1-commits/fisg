import Papa from 'papaparse'

export type Trade = {
  ticket: string; accountLogin: string; accountCurrency: string; symbol: string; type: string; volume: number; openTime: string
  closeTime: string; openPrice: number; closePrice: number; profit: number
  swap: number; commission: number; net: number
}

const clean = (v: unknown) => String(v ?? '').trim().replace(/^['"]|['"]$/g, '')
const norm = (v: unknown) => clean(v).toLowerCase().replace(/[\s_().\-]/g, '')
const number = (v: unknown) => {
  const n = Number(clean(v).replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}
const dateValue = (v: unknown) => {
  const raw = clean(v)
  if (!raw) return ''
  const d = new Date(raw.replaceAll('.', '-'))
  return Number.isNaN(d.getTime()) ? raw : d.toISOString()
}

export function parseMT5(file: File): Promise<Trade[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true, dynamicTyping: false,
      complete: ({ data, meta }) => {
        const fields = meta.fields ?? []
        const find = (...aliases: string[]) => fields.find((f) => aliases.includes(norm(f)))
        const ticket = find('ticket', 'deal', 'dealid', 'order', 'position')
        const symbol = find('symbol', 'item', 'instrument')
        const type = find('type', 'direction')
        const volume = find('volume', 'lots', 'size')
        const openTime = find('opentime', 'time', 'datetime', 'date')
        const closeTime = find('closetime', 'closetimeutc', 'time', 'datetime', 'date')
        const openPrice = find('openprice', 'price')
        const closePrice = find('closeprice', 'price')
        const profit = find('profit', 'pnl', 'netprofit')
        const swap = find('swap', 'storage')
        const commission = find('commission', 'fee', 'fees')
        if (!profit || !fields.length) return reject(new Error('ไม่พบคอลัมน์ Profit ในไฟล์ กรุณา export รายงานบัญชีจาก MT5 เป็น CSV แล้วลองอีกครั้ง'))
        const rows = data.filter((row) => {
          const dir = clean(type ? row[type] : '').toLowerCase()
          return Boolean(clean(symbol ? row[symbol] : '') && (dir === '' || dir.includes('buy') || dir.includes('sell') || dir.includes('balance')))
        }).map((row, i) => {
          const p = number(profit ? row[profit] : 0), s = number(swap ? row[swap] : 0), c = number(commission ? row[commission] : 0)
          return {
            ticket: clean(ticket ? row[ticket] : '') || `${file.name}-${i}`, accountLogin: 'manual', accountCurrency: 'USD',
            symbol: clean(symbol ? row[symbol] : '—'), type: clean(type ? row[type] : 'trade'),
            volume: number(volume ? row[volume] : 0), openTime: dateValue(openTime ? row[openTime] : ''),
            closeTime: dateValue(closeTime ? row[closeTime] : (openTime ? row[openTime] : '')),
            openPrice: number(openPrice ? row[openPrice] : 0), closePrice: number(closePrice ? row[closePrice] : 0),
            profit: p, swap: s, commission: c, net: p + s + c,
          }
        }).filter((row) => row.closeTime && row.symbol !== '—')
        if (!rows.length) return reject(new Error('ไฟล์นี้ไม่มีรายการซื้อขายที่ปิดแล้ว'))
        resolve(rows)
      }, error: reject,
    })
  })
}

export function parseMT5Html(html: string): Trade[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const table = [...doc.querySelectorAll('table')].find((t) => /profit/i.test(t.innerText))
  if (!table) throw new Error('ไม่พบตารางประวัติการเทรดในรายงาน HTML')
  const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((td) => td.textContent?.trim() ?? ''))
  const headers = rows.shift()?.map(norm) ?? []
  const index = (...keys: string[]) => headers.findIndex((h) => keys.includes(h))
  const lastIndex = (...keys: string[]) => { for (let i=headers.length-1;i>=0;i--) if(keys.includes(headers[i])) return i; return -1 }
  const col = { ticket:index('ticket','deal','order'), symbol:index('symbol','item'), type:index('type','direction'), volume:index('volume','lots'), open:index('opentime','time','datetime','date'), close:lastIndex('closetime','time','datetime','date'), price:index('openprice','price'), closePrice:lastIndex('closeprice','price'), profit:index('profit','pnl'), swap:index('swap'), commission:index('commission') }
  if (col.profit < 0 || col.symbol < 0) throw new Error('รายงานไม่มีคอลัมน์ Profit/Symbol')
  return rows.map((r,i) => { const p=number(r[col.profit]), s=number(r[col.swap]), c=number(r[col.commission]); return { ticket: clean(r[col.ticket])||`html-${i}`, accountLogin:'manual', accountCurrency:'USD', symbol:clean(r[col.symbol]), type:clean(r[col.type])||'trade', volume:number(r[col.volume]), openTime:dateValue(r[col.open]), closeTime:dateValue(col.close >= 0 ? r[col.close] : r[col.open]), openPrice:number(r[col.price]), closePrice:number(r[col.closePrice]), profit:p, swap:s, commission:c, net:p+s+c } }).filter(r => r.symbol && r.closeTime)
}
