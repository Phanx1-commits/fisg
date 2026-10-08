import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, ArrowDownRight, ArrowUpRight, BarChart3, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Cloud, CloudOff, Coins, Download, FileUp, LayoutDashboard, LogIn, LogOut, Menu, RefreshCw, Search, Settings2, ShieldCheck, Target, TrendingDown, Wallet, X, type LucideIcon } from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { parseMT5, parseMT5Html, type Trade } from './lib/trades'
import { supabase, supabaseReady, supabaseUrl } from './lib/supabase'

type Period = 'วัน' | 'สัปดาห์' | 'เดือน'
type SyncLink = { id:string; mt5_login:string; mt5_server:string|null; account_currency:string|null; account_balance?:number|null; account_equity?:number|null; last_seen_at:string|null }
type CashFlow = { ticket:string; accountLogin:string; accountCurrency:string; type:'deposit'|'withdrawal'; amount:number; occurredAt:string }
type DisplayCurrency = 'auto' | 'USD' | 'USC'
type SideFilter = 'all'|'buy'|'sell'
const money = (n: number, currency='USD') => currency==='USC' ? `${new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n)} USC` : new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n)
// FISG's USC values arrive 100x above the user's account statement amount:
// 87,299 raw => 872.99 USC => $8.7299. Normalize before rendering or aggregating.
const convertCurrency = (amount:number,source:string,target:string) => {
  if(source==='USC') return target==='USC' ? amount/100 : amount/10000
  if(source==='USD') return target==='USC' ? amount*100 : amount
  return amount
}
const fmtDate = (raw: string) => { const d=new Date(raw); return Number.isNaN(d.getTime()) ? raw : new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short',year:'2-digit'}).format(d) }
const dayKey = (raw: string) => { const d=new Date(raw); return Number.isNaN(d.getTime()) ? raw.slice(0,10) : `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` }
const initials = (name: string) => name.slice(0,1).toUpperCase()

export default function App() {
  const [trades,setTrades]=useState<Trade[]>([])
  const [cashflows,setCashflows]=useState<CashFlow[]>([])
  const [period,setPeriod]=useState<Period>('วัน')
  const [query,setQuery]=useState('')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState('')
  const [email,setEmail]=useState('')
  const [user,setUser]=useState<{id:string;email?:string} | null>(null)
  const [showLogin,setShowLogin]=useState(false)
  const [showConnector,setShowConnector]=useState(false)
  const [mt5Login,setMt5Login]=useState('')
  const [linkedLogin,setLinkedLogin]=useState('')
  const [syncToken,setSyncToken]=useState('')
  const [syncLinks,setSyncLinks]=useState<SyncLink[]>([])
  const [selectedAccount,setSelectedAccount]=useState('all')
  const [displayCurrency,setDisplayCurrency]=useState<DisplayCurrency>('auto')
  const [range,setRange]=useState(0)
  const [mobileNavOpen,setMobileNavOpen]=useState(false)
  const [sideFilter,setSideFilter]=useState<SideFilter>('all')
  const [hourFilter,setHourFilter]=useState('all')
  const [calendarMonth,setCalendarMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1))
  const [selectedCalendarDate,setSelectedCalendarDate]=useState('')
  const [dailyProfitTarget,setDailyProfitTarget]=useState(0)
  const [dailyLossLimit,setDailyLossLimit]=useState(0)
  const notifiedGoalRef=useRef('')
  const fileRef=useRef<HTMLInputElement>(null)
  const storageKey=user?`fisg-trades-v1-user-${user.id}`:'fisg-trades-v1-device'
  const goalStorageKey=user?`tradefolio-daily-goals-${user.id}`:'tradefolio-daily-goals-device'

  useEffect(()=>{
    const saved=localStorage.getItem(goalStorageKey)
    if(saved)try{const value=JSON.parse(saved);setDailyProfitTarget(Number(value.profit)||0);setDailyLossLimit(Number(value.loss)||0)}catch{setDailyProfitTarget(0);setDailyLossLimit(0)}
    else{setDailyProfitTarget(0);setDailyLossLimit(0)}
  },[goalStorageKey])
  useEffect(()=>{localStorage.setItem(goalStorageKey,JSON.stringify({profit:dailyProfitTarget,loss:dailyLossLimit}))},[goalStorageKey,dailyProfitTarget,dailyLossLimit])

  useEffect(()=>{
    const saved=localStorage.getItem('fisg-trades-v1-device')
    if(saved) try { setTrades(JSON.parse(saved) as Trade[]) } catch { /* ignore malformed local cache */ }
    if(!supabase) return
    supabase.auth.getSession().then(({data})=>setUser(data.session?.user ?? null))
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>setUser(session?.user ?? null))
    return ()=>subscription.unsubscribe()
  },[])

  useEffect(()=>{
    if(!user || !supabase) {
      setSyncLinks([]); setCashflows([]); setSelectedAccount('all')
      const saved=localStorage.getItem('fisg-trades-v1-device')
      if(saved) try { setTrades(JSON.parse(saved) as Trade[]) } catch { setTrades([]) }
      else setTrades([])
      return
    }
    const db=supabase
    setTrades([])
    const saved=localStorage.getItem(`fisg-trades-v1-user-${user.id}`)
    if(saved) try { setTrades(JSON.parse(saved) as Trade[]) } catch { /* ignore malformed local cache */ }
    let alive=true
    const refreshCloudTrades=()=>db.from('mt5_trades').select('ticket,account_login,account_currency,symbol,type,volume,open_time,close_time,open_price,close_price,profit,swap,commission,net').order('close_time',{ascending:false}).then(({data,error})=>{
      if(!alive) return
      if(error) { setMessage(`เชื่อมต่อฐานข้อมูลไม่ได้: ${error.message}`); return }
      if(data?.length) {
        const cloud:Trade[]=data.map((r:any)=>({ticket:r.ticket,accountLogin:r.account_login??'manual',accountCurrency:r.account_currency??'USD',symbol:r.symbol,type:r.type,volume:Number(r.volume),openTime:r.open_time,closeTime:r.close_time,openPrice:Number(r.open_price),closePrice:Number(r.close_price),profit:Number(r.profit),swap:Number(r.swap),commission:Number(r.commission),net:Number(r.net)}))
        setTrades(cloud); localStorage.setItem(`fisg-trades-v1-user-${user.id}`,JSON.stringify(cloud))
      }
    })
    refreshCloudTrades()
    const refreshTimer=window.setInterval(refreshCloudTrades,60000)
    db.from('mt5_sync_links').select('id,mt5_login,mt5_server,account_currency,account_balance,account_equity,last_seen_at').order('created_at').then(({data,error})=>{
      if(!alive)return
      if(error){setMessage(`อ่านรายการบัญชี MT5 ไม่สำเร็จ: ${error.message}`);return}
      setSyncLinks((data??[]) as SyncLink[])
    })
    db.from('mt5_cashflows').select('ticket,account_login,account_currency,flow_type,amount,occurred_at').then(({data,error})=>{
      if(!alive)return
      if(error){setMessage(`อ่านรายการฝาก/ถอนจากฐานข้อมูลไม่สำเร็จ: ${error.message}`);return}
      setCashflows((data??[]).map((f:any)=>({ticket:f.ticket,accountLogin:f.account_login,accountCurrency:f.account_currency??'USD',type:f.flow_type,amount:Number(f.amount),occurredAt:f.occurred_at})))
    })
    return ()=>{alive=false;window.clearInterval(refreshTimer)}
  },[user])

  const saveTrades = async (next: Trade[]) => {
    setTrades(next); localStorage.setItem(storageKey,JSON.stringify(next))
    if(user && supabase) {
      const payload=next.map(t=>({user_id:user.id,account_login:t.accountLogin||'manual',account_currency:t.accountCurrency||'USD',ticket:t.ticket,symbol:t.symbol,type:t.type,volume:t.volume,open_time:t.openTime,close_time:t.closeTime,open_price:t.openPrice,close_price:t.closePrice,profit:t.profit,swap:t.swap,commission:t.commission,net:t.net}))
      const {error}=await supabase.from('mt5_trades').upsert(payload,{onConflict:'user_id,account_login,ticket'})
      setMessage(error ? `บันทึกในเครื่องแล้ว แต่ sync ไม่สำเร็จ: ${error.message}` : `ซิงก์ ${next.length.toLocaleString('th-TH')} รายการไป Supabase แล้ว`)
    } else setMessage(`นำเข้า ${next.length.toLocaleString('th-TH')} รายการแล้ว — บันทึกไว้ในเครื่องนี้`)
  }

  const importFile=async(file?:File)=>{
    if(!file)return
    setBusy(true); setMessage('กำลังอ่านรายงาน MT5…')
    try {
      let rows:Trade[]
      if(file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) rows=parseMT5Html(await file.text())
      else rows=await parseMT5(file)
      const map=new Map(trades.map(t=>[`${t.accountLogin}:${t.ticket}`,t])); rows.forEach(t=>map.set(`${t.accountLogin}:${t.ticket}`,t))
      await saveTrades([...map.values()].sort((a,b)=>b.closeTime.localeCompare(a.closeTime)))
    } catch(e) { setMessage(e instanceof Error?e.message:'อ่านไฟล์ไม่สำเร็จ') }
    finally { setBusy(false); if(fileRef.current)fileRef.current.value='' }
  }

  const stats=useMemo(()=>{
    const now=new Date(); const start=new Date(now)
    if(period==='วัน') start.setHours(0,0,0,0)
    if(period==='สัปดาห์') { start.setHours(0,0,0,0); start.setDate(start.getDate()-((start.getDay()+6)%7)) }
    if(period==='เดือน') { start.setHours(0,0,0,0); start.setDate(1) }
    if(period==='เดือน') start.setMonth(start.getMonth()-range)
    else start.setDate(start.getDate()-range*(period==='วัน'?1:7))
    const until=new Date(start)
    if(period==='เดือน') until.setMonth(until.getMonth()+1)
    else until.setDate(until.getDate()+(period==='วัน'?1:7))
    const inWindow=trades.filter(t=>{const d=new Date(t.closeTime);const hour=d.getHours();const side=t.type.toLowerCase();const inHour=hourFilter==='all'||(hour>=Number(hourFilter.split('-')[0])&&hour<Number(hourFilter.split('-')[1]));const inSide=sideFilter==='all'||side.includes(sideFilter);return d>=start&&d<until&&inHour&&inSide})
    const chosen=inWindow.filter(t=>selectedAccount==='all'||t.accountLogin===selectedAccount)
    const sourceCurrency=(login:string)=>syncLinks.find(link=>link.mt5_login===login)?.account_currency??trades.find(t=>t.accountLogin===login)?.accountCurrency??'USD'
    // Auto mode shows USD equivalent; USC raw values are normalized per FISG's account statement scale.
    const currency=displayCurrency==='auto'?'USD':displayCurrency
    const amountInDisplay=(trade:Trade,amount:number)=>convertCurrency(amount,sourceCurrency(trade.accountLogin),currency)
    const net=chosen.reduce((s,t)=>s+amountInDisplay(t,t.net),0), wins=chosen.filter(t=>t.net>0).length
    const bins=new Map<string,number>(); chosen.forEach(t=>{const k=dayKey(t.closeTime);bins.set(k,(bins.get(k)||0)+amountInDisplay(t,t.net))})
    const chartData=[...bins].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date:new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short'}).format(new Date(`${date}T12:00:00`)),value}))
    const label=period==='วัน'?new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'long',year:'numeric'}).format(start):period==='สัปดาห์'?`${fmtDate(start.toISOString())} – ${fmtDate(new Date(until.getTime()-1).toISOString())}`:new Intl.DateTimeFormat('th-TH',{month:'long',year:'numeric'}).format(start)
    return {chosen,inWindow,net,wins,losses:chosen.length-wins,winRate:chosen.length?wins/chosen.length*100:0,chartData,label,currency,amountInDisplay,sourceCurrency}
  },[trades,period,range,selectedAccount,displayCurrency,syncLinks,sideFilter,hourFilter])

  const growthData=useMemo(()=>{
    const relevantTrades=trades.filter(t=>selectedAccount==='all'||t.accountLogin===selectedAccount)
    const relevantFlows=cashflows.filter(f=>selectedAccount==='all'||f.accountLogin===selectedAccount)
    const accounts=[...new Set([...relevantTrades.map(t=>t.accountLogin),...relevantFlows.map(f=>f.accountLogin)])]
    if(!accounts.length)return []
    const snapshotsReady=accounts.every(login=>login==='manual'||Number(syncLinks.find(l=>l.mt5_login===login)?.account_balance)>0)
    if(!snapshotsReady)return []
    const nativeCurrency=(login:string)=>stats.sourceCurrency(login)
    const openingCapital=accounts.reduce((sum,login)=>{
      const accountTrades=relevantTrades.filter(t=>t.accountLogin===login)
      const accountFlows=relevantFlows.filter(f=>f.accountLogin===login)
      const link=syncLinks.find(l=>l.mt5_login===login)
      const balance=Number(link?.account_balance)||0
      const realized=accountTrades.reduce((n,t)=>n+t.net,0)
      const flowTotal=accountFlows.reduce((n,f)=>n+f.amount,0)
      const impliedStart=balance-realized-flowTotal
      const firstDeposit=accountFlows.find(f=>f.amount>0)?.amount??0
      const base=login==='manual'?firstDeposit:impliedStart
      return sum+convertCurrency(base,nativeCurrency(login),stats.currency)
    },0)
    if(openingCapital<=0)return []
    const base=openingCapital
    const pnlByDay=new Map<string,number>(),flowByDay=new Map<string,{deposit:number;withdrawal:number;net:number}>()
    relevantTrades.forEach(t=>{const k=dayKey(t.closeTime);pnlByDay.set(k,(pnlByDay.get(k)||0)+convertCurrency(t.net,nativeCurrency(t.accountLogin),stats.currency))})
    relevantFlows.forEach(f=>{const k=dayKey(f.occurredAt);const row=flowByDay.get(k)||{deposit:0,withdrawal:0,net:0};const value=convertCurrency(f.amount,nativeCurrency(f.accountLogin),stats.currency);if(f.type==='deposit')row.deposit+=Math.abs(value);else row.withdrawal+=Math.abs(value);row.net+=value;flowByDay.set(k,row)})
    const eventDays=[...pnlByDay.keys(),...flowByDay.keys()].sort()
    if(!eventDays.length)return []
    const today=dayKey(new Date().toISOString()), first=new Date(`${eventDays[0]}T12:00:00`), end=new Date(`${today}T12:00:00`)
    if(Number.isNaN(first.getTime()))return []
    const equityGap=accounts.reduce((sum,login)=>{const l=syncLinks.find(x=>x.mt5_login===login);const gap=(Number(l?.account_equity)||0)-(Number(l?.account_balance)||0);return sum+convertCurrency(gap,nativeCurrency(login),stats.currency)},0)
    let cumulativeProfit=0,cumulativeFlows=0
    const all=[] as Array<{date:string;growth:number;equityGrowth:number;deposit:number;withdrawal:number}>
    const cursor=new Date(first);cursor.setDate(cursor.getDate()-1)
    all.push({date:new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short'}).format(cursor),growth:0,equityGrowth:0,deposit:0,withdrawal:0})
    for(let d=new Date(first);d<=end;d.setDate(d.getDate()+1)){
      const key=dayKey(d.toISOString()),flow=flowByDay.get(key)||{deposit:0,withdrawal:0,net:0}
      cumulativeProfit+=pnlByDay.get(key)||0;cumulativeFlows+=flow.net
      const isToday=key===today
      all.push({date:new Intl.DateTimeFormat('th-TH',{day:'numeric',month:'short'}).format(d),growth:cumulativeProfit/base*100,equityGrowth:(cumulativeProfit+cumulativeFlows+(isToday?equityGap:0))/base*100,deposit:flow.deposit,withdrawal:flow.withdrawal})
    }
    return all.slice(-92)
  },[trades,cashflows,syncLinks,selectedAccount,stats.currency,stats.sourceCurrency])

  const calendarData=useMemo(()=>{
    const map=new Map<string,{net:number;count:number}>()
    trades.filter(t=>(selectedAccount==='all'||t.accountLogin===selectedAccount)&&(
      sideFilter==='all'||t.type.toLowerCase().includes(sideFilter)
    )&&(hourFilter==='all'||(()=>{const h=new Date(t.closeTime).getHours();return h>=Number(hourFilter.split('-')[0])&&h<Number(hourFilter.split('-')[1])})()))
      .forEach(t=>{const key=dayKey(t.closeTime),row=map.get(key)||{net:0,count:0};row.net+=stats.amountInDisplay(t,t.net);row.count++;map.set(key,row)})
    return map
  },[trades,selectedAccount,sideFilter,hourFilter,stats.amountInDisplay])
  const calendarCells=useMemo(()=>{
    const first=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1)
    const mondayOffset=(first.getDay()+6)%7
    const start=new Date(first);start.setDate(first.getDate()-mondayOffset)
    return Array.from({length:42},(_,i)=>{const date=new Date(start);date.setDate(start.getDate()+i);return date})
  },[calendarMonth])
  const selectedDayTrades=selectedCalendarDate?trades.filter(t=>dayKey(t.closeTime)===selectedCalendarDate&&(selectedAccount==='all'||t.accountLogin===selectedAccount)&&(sideFilter==='all'||t.type.toLowerCase().includes(sideFilter))&&(hourFilter==='all'||(()=>{const h=new Date(t.closeTime).getHours();return h>=Number(hourFilter.split('-')[0])&&h<Number(hourFilter.split('-')[1])})())):[]
  const selectedDayNet=selectedDayTrades.reduce((sum,t)=>sum+stats.amountInDisplay(t,t.net),0)
  const todayKey=dayKey(new Date().toISOString())
  const todayNet=trades.filter(t=>dayKey(t.closeTime)===todayKey&&(selectedAccount==='all'||t.accountLogin===selectedAccount)).reduce((sum,t)=>sum+stats.amountInDisplay(t,t.net),0)
  const goalReached=dailyProfitTarget>0&&todayNet>=dailyProfitTarget?'profit':dailyLossLimit>0&&todayNet<=-dailyLossLimit?'loss':''
  useEffect(()=>{
    if(!goalReached||typeof Notification==='undefined'||Notification.permission!=='granted'||notifiedGoalRef.current===goalReached)return
    notifiedGoalRef.current=goalReached
    new Notification(goalReached==='profit'?'ถึงเป้ากำไรรายวันแล้ว':'ถึงขีดจำกัดขาดทุนรายวัน',{body:`วันนี้ ${money(todayNet,stats.currency)}`})
  },[goalReached,todayNet,stats.currency])

  const performanceByAccount=useMemo(()=>{
    const grouped=new Map<string,{net:number;count:number;wins:number}>()
    stats.inWindow.forEach(t=>{const row=grouped.get(t.accountLogin)||{net:0,count:0,wins:0};row.net+=stats.amountInDisplay(t,t.net);row.count++;if(t.net>0)row.wins++;grouped.set(t.accountLogin,row)})
    return [...grouped.entries()].map(([login,row])=>({login,...row,winRate:row.count?row.wins/row.count*100:0})).sort((a,b)=>b.net-a.net)
  },[stats.inWindow,stats.amountInDisplay])
  const performanceBySymbol=useMemo(()=>{
    const grouped=new Map<string,{net:number;count:number;wins:number}>()
    stats.inWindow.forEach(t=>{const row=grouped.get(t.symbol)||{net:0,count:0,wins:0};row.net+=stats.amountInDisplay(t,t.net);row.count++;if(t.net>0)row.wins++;grouped.set(t.symbol,row)})
    return [...grouped.entries()].map(([symbol,row])=>({symbol,...row,winRate:row.count?row.wins/row.count*100:0})).sort((a,b)=>b.net-a.net).slice(0,8)
  },[stats.inWindow,stats.amountInDisplay])
  const riskStats=useMemo(()=>{
    const ordered=[...stats.chosen].sort((a,b)=>a.closeTime.localeCompare(b.closeTime))
    let cumulative=0,peak=0,maxDrawdown=0
    const perDay=new Map<string,number>()
    ordered.forEach(t=>{const net=stats.amountInDisplay(t,t.net);cumulative+=net;peak=Math.max(peak,cumulative);maxDrawdown=Math.max(maxDrawdown,peak-cumulative);const key=dayKey(t.closeTime);perDay.set(key,(perDay.get(key)||0)+net)})
    const worstDay=[...perDay.entries()].sort((a,b)=>a[1]-b[1])[0]
    return {maxDrawdown,worstDay:worstDay?.[1]??0,worstDayLabel:worstDay?.[0]??''}
  },[stats.chosen,stats.amountInDisplay])

  const filtered=useMemo(()=>stats.chosen.filter(t=>`${t.symbol} ${t.type} ${t.ticket}`.toLowerCase().includes(query.toLowerCase())),[stats.chosen,query])
  const accountOptions=[...new Set(syncLinks.map(link=>link.mt5_login))].sort()
  const manualAvailable=trades.some(t=>t.accountLogin==='manual')
  const portfolioOptions=[...(accountOptions.length+Number(manualAvailable)===1?[]:[{value:'all',label:'ทุกพอร์ต',description:'รวมผลลัพธ์ทุกบัญชี'}]),...accountOptions.map(login=>({value:login,label:`พอร์ต ${login}`,description:syncLinks.find(link=>link.mt5_login===login)?.mt5_server??'บัญชี MetaTrader 5'})),...(manualAvailable?[{value:'manual',label:'นำเข้าจากไฟล์',description:'ประวัติจากรายงาน MT5'}]:[])]
  useEffect(()=>{
    if(accountOptions.length+Number(manualAvailable)===1){const only=accountOptions[0]??'manual';if(selectedAccount!==only)setSelectedAccount(only)}
    else if(selectedAccount!=='all'&&selectedAccount!=='manual'&&!accountOptions.includes(selectedAccount))setSelectedAccount('all')
  },[accountOptions.join('|'),manualAvailable,selectedAccount])
  const signIn=async()=>{ if(!supabase){setMessage('ตั้งค่า Supabase ในไฟล์ .env.local ก่อนใช้งาน');return} if(!email){setMessage('กรอกอีเมลเพื่อรับลิงก์เข้าสู่ระบบ');return} const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});setMessage(error?error.message:'ส่งลิงก์เข้าสู่ระบบไปที่อีเมลแล้ว'); }
  const createSyncLink=async()=>{
    if(!user||!supabase){setShowConnector(false);setShowLogin(true);return}
    if(!/^\d{5,15}$/.test(mt5Login.trim())){setMessage('กรอกหมายเลขบัญชี MT5 ก่อนเชื่อมต่อ');return}
    if(syncLinks.some(link=>link.mt5_login===mt5Login.trim())){setMessage('บัญชีนี้เชื่อมอยู่แล้ว หากต้องการออกโทเคนใหม่ให้ลบการเชื่อมต่อเดิมก่อน');return}
    const token=Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('')
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
    const tokenHash=Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join('')
    const {data,error}=await supabase.from('mt5_sync_links').insert({user_id:user.id,mt5_login:mt5Login.trim(),token_hash:tokenHash}).select('id,mt5_login,mt5_server,account_currency,account_balance,account_equity,last_seen_at').single()
    if(error){setMessage(`สร้างการเชื่อมต่อไม่สำเร็จ: ${error.message}`);return}
    setSyncLinks((links)=>[...links,data as SyncLink])
    setLinkedLogin(mt5Login.trim())
    setSyncToken(token)
  }
  const removeSyncLink=async(id:string)=>{if(!supabase)return;const removed=syncLinks.find(link=>link.id===id);const {error}=await supabase.from('mt5_sync_links').delete().eq('id',id);if(error){setMessage(`ลบการเชื่อมต่อไม่สำเร็จ: ${error.message}`);return}setSyncLinks(links=>links.filter(link=>link.id!==id));if(removed&&selectedAccount===removed.mt5_login)setSelectedAccount('all');setSyncToken('');setMessage('ยกเลิกการเชื่อมต่อแล้ว — พอร์ตจะหายจากตัวเลือก ประวัติเดิมยังรวมอยู่ในยอดทุกพอร์ต')}
  const copySyncToken=async()=>{await navigator.clipboard.writeText(syncToken);setMessage('คัดลอกโทเคนแล้ว — เก็บไว้ใน MT5 เท่านั้น')}
  const exportCsv=()=>{const rows=[['Account','Ticket','Symbol','Type','Volume','Close time','Profit','Swap','Commission','Net'],...filtered.map(t=>[t.accountLogin,t.ticket,t.symbol,t.type,t.volume,t.closeTime,t.profit,t.swap,t.commission,t.net])]; const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(',')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='fisg-trading-report.csv';a.click();URL.revokeObjectURL(a.href)}

  return <div className="app-shell">
    {mobileNavOpen&&<button className="mobile-nav-backdrop" aria-label="ปิดเมนู" onClick={()=>setMobileNavOpen(false)}/>}
    <aside className={`sidebar ${mobileNavOpen?'mobile-open':''}`}>
      <div className="brand"><div className="brand-mark"><Activity size={20} strokeWidth={2.5}/></div><div><strong>trade<span>folio</span></strong><small>TRADING JOURNAL</small></div></div>
      <div className="workspace-label">WORKSPACE</div><div className="account-switch"><div className="account-icon">F</div><span><b>FISG MT5</b><small>{user?.email??'บัญชีส่วนตัว'}</small></span><ChevronDown size={16}/></div>
      <div className="nav-caption">เมนูหลัก</div><button className="nav-item active" onClick={()=>setMobileNavOpen(false)}><LayoutDashboard size={18}/>ภาพรวม</button><button className="nav-item" onClick={()=>{document.getElementById('trades')?.scrollIntoView({behavior:'smooth'});setMobileNavOpen(false)}}><BarChart3 size={18}/>ประวัติการเทรด</button><button className="nav-item" onClick={()=>{fileRef.current?.click();setMobileNavOpen(false)}}><FileUp size={18}/>นำเข้ารายงาน MT5</button>
      <div className="sidebar-spacer"/><div className="sync-card"><div className="sync-icon"><ShieldCheck size={18}/></div><b>ข้อมูลของคุณปลอดภัย</b><p>ประวัติการเทรดเป็นข้อมูลส่วนตัวและจัดเก็บอย่างปลอดภัย</p><div className="sync-status"><span className={user?'dot green':'dot'}/>{user?'ซิงก์กับ Supabase':'จัดเก็บในอุปกรณ์นี้'}</div></div><div className="sidebar-foot"><span className="avatar">{user?initials(user.email??'U'):'T'}</span><div><b>{user?.email??'Trader'}</b><small>{user?'สมาชิก':'บัญชีส่วนตัว'}</small></div>{user?<button className="icon-button" title="ออกจากระบบ" onClick={()=>supabase?.auth.signOut()}><LogOut size={17}/></button>:<button className="icon-button" title="เข้าสู่ระบบ" onClick={()=>setShowLogin(true)}><LogIn size={17}/></button>}</div>
    </aside>

    <main className="main-content">
      <header className="topbar"><button className="mobile-menu-button" aria-label="เปิดเมนู" onClick={()=>setMobileNavOpen(true)}><Menu size={20}/></button><div className="breadcrumb">พอร์ตของฉัน <ChevronRight size={15}/> <b>ภาพรวม</b></div><div className="top-actions"><span className="market-status"><span className="dot green"/>ตลาดเปิด</span><button className="icon-button help-button" title="ข้อมูลช่วยเหลือ"><CircleHelp size={19}/></button><span className="top-avatar">T</span></div></header>
      <div className="page-wrap">
        <div className="page-heading"><div><div className="eyebrow">{new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'}).format(new Date()).toUpperCase()}</div><h1>ภาพรวมพอร์ต</h1><p>ติดตามผลการเทรดของคุณได้ในที่เดียว</p></div><div className="heading-actions"><button className="button-secondary connect-button" onClick={()=>{setSyncToken('');setShowConnector(true)}}><Activity size={15}/>เชื่อม MT5 ({syncLinks.length})</button><button className="button-secondary" onClick={exportCsv} disabled={!filtered.length}><Download size={16}/>ส่งออกรายงาน</button><button className="button-primary" onClick={()=>fileRef.current?.click()} disabled={busy}><FileUp size={17}/>{busy?'กำลังนำเข้า…':'นำเข้ารายงาน'}<span className="shortcut">MT5</span></button><input ref={fileRef} type="file" accept=".csv,.htm,.html,text/csv,text/html" hidden onChange={e=>importFile(e.target.files?.[0])}/></div></div>
        {message&&<div className="notice"><span>{message}</span><button onClick={()=>setMessage('')}><X size={15}/></button></div>}
        <div className="period-row"><div className="period-tabs">{(['วัน','สัปดาห์','เดือน'] as Period[]).map(p=><button className={period===p?'selected':''} onClick={()=>{setPeriod(p);setRange(0)}} key={p}>ราย{p}</button>)}</div><div className="period-tools"><FancySelect label="พอร์ตที่กำลังดู" value={selectedAccount} icon={Wallet} onChange={setSelectedAccount} options={portfolioOptions}/><FancySelect label="สกุลเงินที่แสดง" value={displayCurrency} icon={Coins} onChange={value=>setDisplayCurrency(value as DisplayCurrency)} options={[{value:'auto',label:'USD · แปลง USC',description:'แสดงยอด USC เป็นดอลลาร์'}, {value:'USD',label:'USD',description:'แสดงมูลค่าเป็นดอลลาร์'}, {value:'USC',label:'USC',description:'แสดงยอด USC ที่ปรับสเกลแล้ว'}]}/><div className="date-selector"><button className="icon-button" onClick={()=>setRange(v=>v+1)}><ChevronLeft size={17}/></button><CalendarDays size={16}/><span>{stats.label}</span><button className="icon-button" onClick={()=>setRange(v=>Math.max(0,v-1))} disabled={range===0}><ChevronRight size={17}/></button></div></div></div>
        <section className="metrics-grid">
          <article className="metric-card primary-metric"><div className="metric-top"><span>กำไรสุทธิ · {stats.currency}</span><span className="metric-icon green-icon"><Wallet size={18}/></span></div><div className={`metric-value ${stats.net<0?'negative':''}`}>{money(stats.net,stats.currency)}</div><div className="metric-bottom"><span className={`change-pill ${stats.net>=0?'up':'down'}`}>{stats.net>=0?<ArrowUpRight size={14}/>:<ArrowDownRight size={14}/>} {stats.chosen.length} รายการ</span><span className="muted">ช่วง{period}นี้</span></div><div className="metric-sparkline"><svg viewBox="0 0 220 40" preserveAspectRatio="none"><path d="M0,32 C22,30 23,22 42,26 S67,15 84,23 S106,8 125,18 S148,4 165,13 S193,5 220,0" fill="none" stroke="currentColor" strokeWidth="2"/></svg></div></article>
          <article className="metric-card"><div className="metric-top"><span>จำนวนเทรด</span><span className="metric-icon blue-icon"><BarChart3 size={18}/></span></div><div className="metric-value">{stats.chosen.length.toLocaleString('th-TH')}</div><div className="metric-bottom"><span className="subtle-pill">ปิดออเดอร์แล้ว</span><span className="muted">ช่วง{period}นี้</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>อัตราชนะ</span><span className="metric-icon purple-icon"><Activity size={18}/></span></div><div className="metric-value">{stats.winRate.toFixed(1)}<small>%</small></div><div className="metric-bottom"><span className="win-count">{stats.wins} ชนะ</span><span className="loss-count">{stats.losses} แพ้</span></div><div className="progress-track"><div style={{width:`${stats.winRate}%`}}/></div></article>
          <article className="metric-card"><div className="metric-top"><span>กำไรเฉลี่ย / เทรด</span><span className="metric-icon amber-icon"><RefreshCw size={18}/></span></div><div className="metric-value">{money(stats.chosen.length?stats.net/stats.chosen.length:0,stats.currency)}</div><div className="metric-bottom"><span className="subtle-pill">รวม Swap + Commission + Fee</span></div></article>
        </section>
        <section className="panel calendar-panel"><div className="panel-heading calendar-heading"><div><span className="section-kicker"><CalendarDays size={13}/> TRADING CALENDAR</span><h2>ปฏิทินกำไรรายวัน</h2><p>เลือกวันที่เพื่อดูผลลัพธ์และรายการเทรด · {stats.currency}</p></div><div className="calendar-month-control"><button className="icon-button" aria-label="เดือนก่อน" onClick={()=>setCalendarMonth(date=>new Date(date.getFullYear(),date.getMonth()-1,1))}><ChevronLeft size={17}/></button><b>{calendarMonth.toLocaleDateString('th-TH',{month:'long',year:'numeric'})}</b><button className="icon-button" aria-label="เดือนถัดไป" onClick={()=>setCalendarMonth(date=>new Date(date.getFullYear(),date.getMonth()+1,1))}><ChevronRight size={17}/></button></div></div><div className="calendar-grid"><div className="calendar-weekday">จ</div><div className="calendar-weekday">อ</div><div className="calendar-weekday">พ</div><div className="calendar-weekday">พฤ</div><div className="calendar-weekday">ศ</div><div className="calendar-weekday">ส</div><div className="calendar-weekday">อา</div>{calendarCells.map(date=>{const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`,summary=calendarData.get(key),inMonth=date.getMonth()===calendarMonth.getMonth(),today=key===todayKey;return <button type="button" key={key} className={`calendar-day ${inMonth?'':'outside'} ${today?'today':''} ${selectedCalendarDate===key?'chosen':''} ${(summary?.net??0)>0?'has-profit':(summary?.net??0)<0?'has-loss':''}`} onClick={()=>setSelectedCalendarDate(key)}><span>{date.getDate()}</span>{summary&&<><b>{money(summary.net,stats.currency)}</b><small>{summary.count} เทรด</small></>}</button>})}</div><div className="calendar-legend"><span><i className="tiny-dot profit-dot"/>กำไร</span><span><i className="tiny-dot loss-dot"/>ขาดทุน</span><span className="calendar-note">แตะวันที่เพื่อดูรายละเอียด</span></div></section>
        <section className="content-grid"><article className="panel chart-panel growth-panel"><div className="panel-heading"><div><h2>การเติบโตของพอร์ต</h2><p>Growth และ Equity Growth · 90 วันล่าสุด · {stats.currency}</p></div><span className="growth-current">{growthData.length?`${growthData[growthData.length-1].growth.toFixed(2)}%`:'—'}</span></div><div className="chart-legend growth-legend"><span><i className="legend-line equity-line"/>Equity Growth</span><span><i className="legend-line growth-line"/>Growth</span><span><i className="tiny-dot profit-dot"/>Deposit</span><span><i className="tiny-dot withdrawal-dot"/>Withdrawal</span></div><div className="chart-area growth-chart">{growthData.length>1?<ResponsiveContainer width="100%" height="100%"><ComposedChart data={growthData} margin={{top:12,right:8,left:0,bottom:0}}><CartesianGrid stroke="#edf0f2" vertical={false}/><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill:'#9199a2',fontSize:10}} minTickGap={32} dy={8}/><YAxis yAxisId="growth" axisLine={false} tickLine={false} tick={{fill:'#9199a2',fontSize:10}} tickFormatter={v=>`${Number(v).toLocaleString('en-US')}%`} width={53}/><YAxis yAxisId="flows" orientation="right" hide domain={[0,'auto']}/><Tooltip formatter={(v,name)=>name==='Growth'||name==='Equity Growth'?[`${Number(v).toFixed(2)}%`,name]:[money(Number(v),stats.currency),name==='deposit'?'Deposit':'Withdrawal']} labelStyle={{fontWeight:600,color:'#36414a'}} contentStyle={{border:'1px solid #edf0f2',borderRadius:9,fontSize:11,boxShadow:'0 8px 25px #18223014'}}/><Bar yAxisId="flows" dataKey="deposit" fill="#35b56d" fillOpacity={0.19} maxBarSize={13} radius={[2,2,0,0]}/><Bar yAxisId="flows" dataKey="withdrawal" fill="#ef5c56" fillOpacity={0.16} maxBarSize={13} radius={[2,2,0,0]}/><Line yAxisId="growth" type="monotone" dataKey="equityGrowth" name="Equity Growth" stroke="#f0b24d" strokeWidth={1.8} dot={false} activeDot={{r:3}}/><Line yAxisId="growth" type="monotone" dataKey="growth" name="Growth" stroke="#f24e45" strokeWidth={2} dot={false} activeDot={{r:4,fill:'#f24e45',stroke:'#fff',strokeWidth:2}}/></ComposedChart></ResponsiveContainer>:<div className="empty-chart"><div className="empty-chart-icon"><BarChart3 size={23}/></div><b>ยังไม่มีข้อมูลเพียงพอสำหรับกราฟการเติบโต</b><span>ซิงก์ประวัติจาก MT5 เพื่อแสดงกำไรสะสม เงินฝาก และเงินถอน</span></div>}</div><div className="chart-footer"><span><i className="tiny-dot profit-dot"/>ฝากเงิน</span><span><i className="tiny-dot withdrawal-dot"/>ถอนเงิน</span><span className="chart-foot-note">Growth คำนวณจากกำไรสะสมเทียบทุนเริ่มต้น</span></div></article>
          <article className="panel breakdown-panel"><div className="panel-heading"><div><h2>สรุปการเทรด</h2><p>ภาพรวมช่วง{period}นี้</p></div><button className="more-button"><span>•••</span></button></div><div className="donut-wrap"><div className="donut" style={{background:`conic-gradient(#189b73 0 ${stats.winRate}%, #f0a653 ${stats.winRate}% 100%)`}}><div className="donut-hole"><b>{stats.winRate.toFixed(0)}%</b><span>อัตราชนะ</span></div></div></div><div className="legend-list"><div><span className="legend-left"><i className="tiny-dot profit-dot"/>เทรดที่ชนะ</span><b>{stats.wins}<small> รายการ</small></b></div><div><span className="legend-left"><i className="tiny-dot amber-dot"/>เทรดที่แพ้</span><b>{stats.losses}<small> รายการ</small></b></div></div><div className="breakdown-total"><span>กำไรสุทธิรวม</span><b className={stats.net>=0?'positive':'negative'}>{money(stats.net,stats.currency)}</b></div></article></section>
        <section className="insights-grid"><article className="panel insight-panel"><div className="panel-heading"><div><span className="section-kicker"><Wallet size={13}/> PORTFOLIO COMPARISON</span><h2>วิเคราะห์รายพอร์ต</h2><p>ผลลัพธ์ตามช่วงที่เลือกและตัวกรอง</p></div></div><div className="insight-list">{performanceByAccount.length?performanceByAccount.map(row=><div className="insight-row" key={row.login}><div className="insight-title"><span className="account-icon">{row.login==='manual'?'F':'M'}</span><span><b>{row.login==='manual'?'นำเข้าจากไฟล์':`พอร์ต ${row.login}`}</b><small>{row.count} เทรด · ชนะ {row.winRate.toFixed(1)}%</small></span></div><b className={`insight-value ${row.net>=0?'positive':'negative'}`}>{row.net>=0?'+':''}{money(row.net,stats.currency)}</b></div>):<div className="insight-empty">ยังไม่มีรายการในช่วงนี้</div>}</div></article><article className="panel insight-panel"><div className="panel-heading"><div><span className="section-kicker"><Activity size={13}/> SYMBOL PERFORMANCE</span><h2>วิเคราะห์รายสินทรัพย์</h2><p>เรียงตามกำไรสุทธิ · สูงสุด 8 รายการ</p></div></div><div className="insight-list">{performanceBySymbol.length?performanceBySymbol.map(row=><div className="insight-row" key={row.symbol}><div className="insight-title"><span className="symbol-icon">{row.symbol.slice(0,1)}</span><span><b>{row.symbol}</b><small>{row.count} เทรด · ชนะ {row.winRate.toFixed(1)}%</small></span></div><b className={`insight-value ${row.net>=0?'positive':'negative'}`}>{row.net>=0?'+':''}{money(row.net,stats.currency)}</b></div>):<div className="insight-empty">ยังไม่มีรายการในช่วงนี้</div>}</div></article></section>
        <section className="risk-goal-grid"><article className="panel risk-panel"><div className="panel-heading"><div><span className="section-kicker"><TrendingDown size={13}/> RISK SNAPSHOT</span><h2>สถิติความเสี่ยง</h2><p>คำนวณจากออเดอร์ปิดในช่วงที่เลือก</p></div></div><div className="risk-metrics"><div><span>Drawdown สูงสุด*</span><b className="negative">{money(-riskStats.maxDrawdown,stats.currency)}</b></div><div><span>วันที่ขาดทุนมากสุด</span><b className="negative">{riskStats.worstDay<0?money(riskStats.worstDay,stats.currency):'—'}</b><small>{riskStats.worstDayLabel?fmtDate(riskStats.worstDayLabel):'ไม่มีวันขาดทุน'}</small></div><div><span>อัตราชนะพอร์ตที่เลือก</span><b>{stats.winRate.toFixed(1)}%</b><small>{stats.wins} ชนะ · {stats.losses} แพ้</small></div></div><p className="risk-footnote">* Drawdown นี้วัดจากกำไร/ขาดทุนสะสมของออเดอร์ที่ปิดแล้ว ไม่รวมการแกว่งของออเดอร์ที่ยังเปิด</p></article><article className="panel goal-panel"><div className="panel-heading"><div><span className="section-kicker"><Target size={13}/> DAILY GOALS</span><h2>เป้าหมายรายวัน</h2><p>วันนี้: <b className={todayNet>=0?'positive':'negative'}>{money(todayNet,stats.currency)}</b></p></div><button className="notify-button" onClick={async()=>{if(!('Notification'in window)){setMessage('เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือน');return}const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();setMessage(permission==='granted'?'เปิดการแจ้งเตือนเมื่อถึงเป้าหมายแล้ว':'ยังไม่ได้อนุญาตการแจ้งเตือน')} }><Bell size={15}/>{typeof Notification!=='undefined'&&Notification.permission==='granted'?'เปิดแจ้งเตือน':'อนุญาตแจ้งเตือน'}</button></div><div className="goal-inputs"><label>เป้ากำไรรายวัน<input type="number" min="0" step="0.01" value={dailyProfitTarget||''} placeholder="เช่น 20" onChange={e=>setDailyProfitTarget(Math.max(0,Number(e.target.value)||0))}/><small>{stats.currency}</small></label><label>จำกัดขาดทุนรายวัน<input type="number" min="0" step="0.01" value={dailyLossLimit||''} placeholder="เช่น 10" onChange={e=>setDailyLossLimit(Math.max(0,Number(e.target.value)||0))}/><small>{stats.currency}</small></label></div><div className="goal-progress"><span style={{width:`${dailyProfitTarget?Math.min(100,Math.max(0,todayNet/dailyProfitTarget*100)):0}%`}}/></div><div className={`goal-status ${goalReached?'reached':''}`}>{goalReached==='profit'?'ถึงเป้ากำไรรายวันแล้ว':goalReached==='loss'?'ถึงขีดจำกัดขาดทุนรายวันแล้ว':'เป้าหมายจะบันทึกในอุปกรณ์นี้ และแจ้งเตือนเมื่อเปิดเว็บอยู่'}</div></article></section>
        <section className="panel trades-panel" id="trades"><div className="panel-heading trades-heading"><div><h2>รายการเทรดล่าสุด</h2><p>แสดง {filtered.length} จาก {stats.chosen.length} รายการ · ช่วง{period}นี้</p></div><div className="table-actions"><label className="search-box"><Search size={15}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหาสินทรัพย์…"/></label></div></div><div className="filter-strip"><span><Settings2 size={14}/>ตัวกรองการเทรด</span><FancySelect label="ทิศทาง" value={sideFilter} icon={Activity} onChange={value=>setSideFilter(value as SideFilter)} options={[{value:'all',label:'ทุกทิศทาง',description:'รวม Buy และ Sell'},{value:'buy',label:'Buy · ซื้อ',description:'เฉพาะรายการฝั่งซื้อ'},{value:'sell',label:'Sell · ขาย',description:'เฉพาะรายการฝั่งขาย'}]}/><FancySelect label="ช่วงชั่วโมง" value={hourFilter} icon={Clock3} onChange={setHourFilter} options={[{value:'all',label:'ทุกช่วงเวลา',description:'ไม่จำกัดชั่วโมง'},{value:'00-06',label:'00:00–06:00',description:'ช่วงดึก'},{value:'06-12',label:'06:00–12:00',description:'ช่วงเช้า'},{value:'12-18',label:'12:00–18:00',description:'ช่วงบ่าย'},{value:'18-24',label:'18:00–24:00',description:'ช่วงค่ำ'}]}/></div><div className="table-scroll"><table><thead><tr><th>สินทรัพย์ / พอร์ต</th><th>ทิศทาง</th><th>ปริมาณ</th><th>ราคาเปิด</th><th>ราคาปิด</th><th>เวลาปิด</th><th className="right">กำไรสุทธิ</th></tr></thead><tbody>{filtered.slice(0,8).map(t=><tr key={`${t.accountLogin}-${t.ticket}`}><td><div className="symbol-cell"><span className="symbol-icon">{t.symbol.slice(0,1)}</span><span><b>{t.symbol}</b><small>#{t.ticket} · {t.accountLogin==='manual'?'ไฟล์นำเข้า':`${t.accountLogin} ${stats.sourceCurrency(t.accountLogin)}`}</small></span></div></td><td><span className={`direction ${t.type.toLowerCase().includes('buy')?'buy':'sell'}`}>{t.type.toLowerCase().includes('buy')?'ซื้อ':'ขาย'}</span></td><td>{t.volume.toFixed(2)} <small>lot</small></td><td>{t.openPrice? t.openPrice.toFixed(5):'—'}</td><td>{t.closePrice? t.closePrice.toFixed(5):'—'}</td><td>{fmtDate(t.closeTime)}</td><td className={`right result ${t.net>=0?'positive':'negative'}`}>{t.net>=0?'+':''}{money(stats.amountInDisplay(t,t.net),stats.currency)}</td></tr>)}</tbody></table>{!filtered.length&&<div className="table-empty"><span className="empty-chart-icon"><Search size={20}/></span><b>{trades.length?'ไม่พบรายการในช่วงเวลานี้':'ยังไม่มีประวัติการเทรด'}</b><span>{trades.length?'ลองเปลี่ยนช่วงเวลาหรือนำเข้าประวัติเพิ่มเติม':'Export รายงานจาก MT5 แล้วนำเข้าเพื่อเริ่มดูสถิติ'}</span>{!trades.length&&<button className="button-secondary" onClick={()=>fileRef.current?.click()}><FileUp size={15}/>เลือกไฟล์รายงาน</button>}</div>}</div>{filtered.length>8&&<div className="table-bottom">แสดง 8 รายการล่าสุดจาก {filtered.length} รายการ<button className="text-action" onClick={exportCsv}>ดาวน์โหลดทั้งหมด <Download size={14}/></button></div>}</section>
        <footer className="page-footer"><span>tradefolio <span className="footer-dot">·</span> รองรับรายงาน MetaTrader 5</span><span><Cloud size={14}/> {user?'ซิงก์ข้อมูลแล้ว':'ข้อมูลเก็บอยู่ในอุปกรณ์นี้'}</span></footer>
      </div>
    </main>
    {selectedCalendarDate&&<div className="modal-backdrop" onClick={()=>setSelectedCalendarDate('')}><div className="login-modal daily-detail-modal" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" aria-label="ปิดรายละเอียด" onClick={()=>setSelectedCalendarDate('')}><X size={18}/></button><div className="modal-brand"><div className="brand-mark"><CalendarDays size={18}/></div><span>สรุปผลรายวัน</span></div><h2>{new Date(`${selectedCalendarDate}T12:00:00`).toLocaleDateString('th-TH',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</h2><div className="daily-detail-total"><span>กำไรสุทธิ</span><b className={selectedDayNet>=0?'positive':'negative'}>{money(selectedDayNet,stats.currency)}</b><small>{selectedDayTrades.length} รายการปิด</small></div><div className="daily-detail-list">{selectedDayTrades.length?selectedDayTrades.map(t=><div className="daily-trade-row" key={`${t.accountLogin}-${t.ticket}`}><span><b>{t.symbol}</b><small>{t.type.toLowerCase().includes('buy')?'Buy':'Sell'} · {t.volume.toFixed(2)} lot · {t.accountLogin}</small></span><b className={t.net>=0?'positive':'negative'}>{t.net>=0?'+':''}{money(stats.amountInDisplay(t,t.net),stats.currency)}</b></div>):<div className="insight-empty">วันนี้ไม่มีรายการปิดออเดอร์{calendarData.get(selectedCalendarDate)?.count? ' ที่ตรงกับตัวกรองปัจจุบัน':''}</div>}</div></div></div>}
    {showConnector&&<div className="modal-backdrop" onClick={()=>setShowConnector(false)}><div className="login-modal connector-modal" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={()=>setShowConnector(false)}><X size={18}/></button><div className="modal-brand"><div className="brand-mark"><Activity size={18}/></div><span>เชื่อมบัญชี MetaTrader 5</span></div>{syncToken?<><h2>พอร์ต {linkedLogin} พร้อมเชื่อม</h2><p>ดาวน์โหลด EA แล้วติดตั้งใน MT5 ของบัญชีนี้ จากนั้นใส่โทเคนด้านล่าง EA จะส่งประวัติที่ปิดแล้วทุกนาที</p><label className="login-label">Sync token · แสดงครั้งนี้ครั้งเดียว</label><div className="token-row"><input className="login-input" readOnly value={syncToken}/><button className="button-secondary" onClick={copySyncToken}>คัดลอก</button></div><label className="login-label endpoint-label">Endpoint</label><input className="login-input" readOnly value={`${supabaseUrl}/functions/v1/mt5-sync`}/><a className="button-primary download-ea" href="/TradefolioSync.mq5" download><Download size={16}/>ดาวน์โหลด EA สำหรับ MT5</a><div className="setup-hint"><ShieldCheck size={15}/> EA อ่านประวัติเท่านั้น ไม่มีคำสั่งเปิด/ปิดออเดอร์</div><p className="connector-note">ใน MT5 ให้เปิด Tools → Options → Expert Advisors และอนุญาต WebRequest ไปยัง <b>{supabaseUrl?.replace(/^https:\/\//,'')}</b></p><button className="button-secondary next-account" onClick={()=>{setSyncToken('');setMt5Login('')}}>เชื่อมพอร์ตถัดไป</button></>:<><h2>เชื่อมพอร์ต MT5</h2><p>เพิ่มแต่ละบัญชีแยกกันได้ ระบบจะเก็บข้อมูลและคำนวณกำไรแยกพอร์ต พร้อมดูยอดรวมทั้งหมด</p>{syncLinks.length>0&&<div className="linked-accounts"><label className="login-label">พอร์ตที่เชื่อมแล้ว ({syncLinks.length})</label>{syncLinks.map(link=><div className="linked-account" key={link.id}><span><b>{link.mt5_login}</b><small>{link.last_seen_at?`ซิงก์ล่าสุด ${fmtDate(link.last_seen_at)}`:'รอเชื่อมต่อจาก MT5'}</small></span><button className="icon-button" title="ยกเลิกการเชื่อม" onClick={()=>removeSyncLink(link.id)}><X size={15}/></button></div>)}</div>}<label className="login-label">หมายเลขบัญชี MT5 พอร์ตใหม่</label><input className="login-input" inputMode="numeric" placeholder="เช่น 12345678" value={mt5Login} onChange={e=>setMt5Login(e.target.value)}/><button className="button-primary login-submit" onClick={createSyncLink}><Activity size={16}/>สร้างการเชื่อมต่อ</button>{!user&&<div className="setup-hint"><LogIn size={15}/> ต้องเข้าสู่ระบบก่อนเพื่อแยกข้อมูลตามบัญชี</div>}</>}</div></div>}
    {showLogin&&<div className="modal-backdrop" onClick={()=>setShowLogin(false)}><div className="login-modal" onClick={e=>e.stopPropagation()}><button className="modal-close icon-button" onClick={()=>setShowLogin(false)}><X size={18}/></button><div className="modal-brand"><div className="brand-mark"><Cloud size={18}/></div><span>ซิงก์ข้อมูลกับ Supabase</span></div><h2>เข้าสู่ระบบเพื่อสำรองข้อมูล</h2><p>เราจะส่งลิงก์เข้าสู่ระบบไปยังอีเมลของคุณ ประวัติการเทรดจะซิงก์ข้ามอุปกรณ์</p><label className="login-label">อีเมล</label><input className="login-input" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/><button className="button-primary login-submit" onClick={signIn}><LogIn size={16}/>ส่งลิงก์เข้าสู่ระบบ</button>{!supabaseReady&&<div className="setup-hint"><CloudOff size={15}/> ยังไม่ได้ตั้งค่า Supabase ใน .env.local</div>}<small className="privacy-note"><ShieldCheck size={14}/> เราไม่ขอรหัสผ่าน MT5 ของคุณ</small></div></div>}
  </div>
}

type FancyOption={value:string;label:string;description:string}
function FancySelect({label,value,options,onChange,icon:Icon}:{label:string;value:string;options:FancyOption[];onChange:(value:string)=>void;icon:LucideIcon}){
  const [open,setOpen]=useState(false)
  const root=useRef<HTMLDivElement>(null)
  const active=options.find(option=>option.value===value)??options[0]
  useEffect(()=>{
    if(!open)return
    const outside=(event:MouseEvent)=>{if(root.current&&!root.current.contains(event.target as Node))setOpen(false)}
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setOpen(false)}
    document.addEventListener('mousedown',outside);document.addEventListener('keydown',escape)
    return()=>{document.removeEventListener('mousedown',outside);document.removeEventListener('keydown',escape)}
  },[open])
  return <div className={`fancy-select ${open?'is-open':''}`} ref={root}>
    <button type="button" className="fancy-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span className="fancy-select-icon"><Icon size={16}/></span><span className="fancy-select-copy"><small>{label}</small><b>{active?.label}</b></span><ChevronDown className="fancy-select-chevron" size={15}/>
    </button>
    {open&&<div className="fancy-select-menu" role="listbox" aria-label={label}><div className="fancy-select-menu-head"><span>{label}</span><small>เลือกเพื่อเปลี่ยนมุมมอง</small></div>{options.map(option=><button type="button" role="option" aria-selected={option.value===value} className={`fancy-select-option ${option.value===value?'active':''}`} key={option.value} onClick={()=>{onChange(option.value);setOpen(false)}}><span className="fancy-option-copy"><b>{option.label}</b><small>{option.description}</small></span>{option.value===value&&<Check size={16}/>}</button>)}</div>}
  </div>
}
