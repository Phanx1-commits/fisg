#property strict
#property version   "1.10"
#property description "Read-only MT5 closed-trade history sync for Tradefolio"

input string SyncEndpoint = "https://YOUR_PROJECT.supabase.co/functions/v1/mt5-sync";
input group "Account 1"
input long AccountLogin1 = 0;
input string SyncToken1 = "";
input group "Account 2"
input long AccountLogin2 = 0;
input string SyncToken2 = "";
input group "Account 3"
input long AccountLogin3 = 0;
input string SyncToken3 = "";
input int SyncEverySeconds = 60;
input int HistoryDays = 3650;

struct PositionSummary
{
   ulong id;
   string symbol;
   int side;
   double remaining;
   double openedVolume;
   double openValue;
   double closedVolume;
   double closeValue;
   double profit;
   double swap;
   double commission;
   double fee;
   datetime openTime;
   datetime closeTime;
};

struct CashFlowSummary
{
   ulong ticket;
   string type;
   double amount;
   datetime time;
};

PositionSummary positions[];
CashFlowSummary cashflows[];

int FindPosition(const ulong id)
{
   for(int i=0;i<ArraySize(positions);i++)
      if(positions[i].id==id) return i;
   return -1;
}

string JsonEscape(string value)
{
   StringReplace(value,"\\","\\\\");
   StringReplace(value,"\"","\\\"");
   StringReplace(value,"\r","\\r");
   StringReplace(value,"\n","\\n");
   StringReplace(value,"\t","\\t");
   return value;
}

string IsoUtc(const datetime serverTime)
{
   int offset=(int)(TimeTradeServer()-TimeGMT());
   datetime utc=serverTime-offset;
   string value=TimeToString(utc,TIME_DATE|TIME_SECONDS);
   StringReplace(value,".","-");
   StringReplace(value," ","T");
   return value+"Z";
}

string TokenForCurrentAccount()
{
   long login=AccountInfoInteger(ACCOUNT_LOGIN);
   if(AccountLogin1==login) return SyncToken1;
   if(AccountLogin2==login) return SyncToken2;
   if(AccountLogin3==login) return SyncToken3;
   return "";
}

bool BuildPayload(const string token,string &body)
{
   ArrayResize(positions,0);
   ArrayResize(cashflows,0);
   datetime to=TimeCurrent();
   datetime from=(HistoryDays<=0 ? 0 : to-(datetime)HistoryDays*86400);
   if(!HistorySelect(from,to))
   {
      Print("HistorySelect failed: ",GetLastError());
      return false;
   }

   int total=HistoryDealsTotal();
   for(int i=0;i<total;i++)
   {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0) continue;
      long dealType=HistoryDealGetInteger(deal,DEAL_TYPE);
      if(dealType==DEAL_TYPE_BALANCE)
      {
         double amount=HistoryDealGetDouble(deal,DEAL_PROFIT);
         if(amount!=0)
         {
            int flowIndex=ArraySize(cashflows);
            ArrayResize(cashflows,flowIndex+1);
            cashflows[flowIndex].ticket=deal;
            cashflows[flowIndex].type=(amount>0 ? "deposit" : "withdrawal");
            cashflows[flowIndex].amount=amount;
            cashflows[flowIndex].time=(datetime)HistoryDealGetInteger(deal,DEAL_TIME);
         }
         continue;
      }
      if(dealType!=DEAL_TYPE_BUY && dealType!=DEAL_TYPE_SELL) continue;
      long entry=HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_IN && entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY && entry!=DEAL_ENTRY_INOUT) continue;
      ulong positionId=(ulong)HistoryDealGetInteger(deal,DEAL_POSITION_ID);
      if(positionId==0) continue;
      int index=FindPosition(positionId);
      if(index<0)
      {
         index=ArraySize(positions);
         ArrayResize(positions,index+1);
         positions[index].id=positionId;
         positions[index].symbol=HistoryDealGetString(deal,DEAL_SYMBOL);
         positions[index].side=0;
         positions[index].remaining=0;
         positions[index].openedVolume=0;
         positions[index].openValue=0;
         positions[index].closedVolume=0;
         positions[index].closeValue=0;
         positions[index].profit=0;
         positions[index].swap=0;
         positions[index].commission=0;
         positions[index].fee=0;
         positions[index].openTime=0;
         positions[index].closeTime=0;
      }
      double volume=HistoryDealGetDouble(deal,DEAL_VOLUME);
      double price=HistoryDealGetDouble(deal,DEAL_PRICE);
      datetime dealTime=(datetime)HistoryDealGetInteger(deal,DEAL_TIME);
      positions[index].profit+=HistoryDealGetDouble(deal,DEAL_PROFIT);
      positions[index].swap+=HistoryDealGetDouble(deal,DEAL_SWAP);
      positions[index].commission+=HistoryDealGetDouble(deal,DEAL_COMMISSION);
      positions[index].fee+=HistoryDealGetDouble(deal,DEAL_FEE);
      if(entry==DEAL_ENTRY_IN)
      {
         if(positions[index].side==0) positions[index].side=(dealType==DEAL_TYPE_BUY ? 1 : -1);
         positions[index].remaining+=volume;
         positions[index].openedVolume+=volume;
         positions[index].openValue+=volume*price;
         if(positions[index].openTime==0 || dealTime<positions[index].openTime) positions[index].openTime=dealTime;
      }
      else
      {
         positions[index].remaining-=volume;
         if(positions[index].remaining<0 && positions[index].remaining>-0.0000001) positions[index].remaining=0;
         positions[index].closedVolume+=volume;
         positions[index].closeValue+=volume*price;
         if(dealTime>positions[index].closeTime) positions[index].closeTime=dealTime;
         if(entry==DEAL_ENTRY_INOUT)
         {
            // A netting reversal closes the old position and opens the excess volume in the other direction.
            double excess=volume-positions[index].remaining;
            if(excess>0) positions[index].remaining+=excess;
         }
      }
   }

   body="{\"token\":\""+JsonEscape(token)+"\",\"login\":\""+IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))+"\",\"server\":\""+JsonEscape(AccountInfoString(ACCOUNT_SERVER))+"\",\"currency\":\""+JsonEscape(AccountInfoString(ACCOUNT_CURRENCY))+"\",\"balance\":"+DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE),2)+",\"equity\":"+DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY),2)+",\"trades\":[";
   int sent=0;
   for(int i=0;i<ArraySize(positions);i++)
   {
      PositionSummary p=positions[i];
      if(p.remaining>0.0000001 || p.closeTime==0 || p.openedVolume<=0) continue;
      double openPrice=p.openValue/p.openedVolume;
      double closePrice=(p.closedVolume>0 ? p.closeValue/p.closedVolume : 0);
      double net=p.profit+p.swap+p.commission+p.fee;
      if(sent>0) body+=",";
      body+="{\"ticket\":\""+IntegerToString((long)p.id)+"\",\"symbol\":\""+JsonEscape(p.symbol)+"\",\"type\":\""+(p.side>0?"buy":"sell")+"\",\"volume\":"+DoubleToString(p.openedVolume,2)+",\"open_time\":\""+IsoUtc(p.openTime)+"\",\"close_time\":\""+IsoUtc(p.closeTime)+"\",\"open_price\":"+DoubleToString(openPrice,8)+",\"close_price\":"+DoubleToString(closePrice,8)+",\"profit\":"+DoubleToString(p.profit,8)+",\"swap\":"+DoubleToString(p.swap,8)+",\"commission\":"+DoubleToString(p.commission+p.fee,8)+",\"net\":"+DoubleToString(net,8)+"}";
      sent++;
   }
   body+="],\"cashflows\":[";
   for(int i=0;i<ArraySize(cashflows);i++)
   {
      if(i>0) body+=",";
      body+="{\"ticket\":\""+IntegerToString((long)cashflows[i].ticket)+"\",\"flow_type\":\""+cashflows[i].type+"\",\"amount\":"+DoubleToString(cashflows[i].amount,8)+",\"occurred_at\":\""+IsoUtc(cashflows[i].time)+"\"}";
   }
   body+="]}";
   Print("Tradefolio: prepared ",sent," closed positions and ",ArraySize(cashflows)," balance changes");
   return true;
}

void SyncHistory()
{
   if(StringFind(SyncEndpoint,"YOUR_PROJECT")>=0)
   {
      Print("Set SyncEndpoint in the EA inputs first.");
      return;
   }
   string token=TokenForCurrentAccount();
   if(token=="")
   {
      Print("Tradefolio: no account/token mapping for MT5 login ",AccountInfoInteger(ACCOUNT_LOGIN),". Set AccountLogin1-3 and SyncToken1-3 in the EA inputs.");
      return;
   }
   string body;
   if(!BuildPayload(token,body)) return;
   char request[];
   int copied=StringToCharArray(body,request,0,WHOLE_ARRAY,CP_UTF8);
   if(copied>0) ArrayResize(request,copied-1);
   char response[];
   string responseHeaders;
   int status=WebRequest("POST",SyncEndpoint,"Content-Type: application/json\r\n",10000,request,response,responseHeaders);
   if(status==-1)
   {
      Print("Tradefolio WebRequest failed: ",GetLastError(),". Add the Supabase domain to MT5 Tools > Options > Expert Advisors > WebRequest allow list.");
      return;
   }
   string reply=CharArrayToString(response,0,-1,CP_UTF8);
   if(status<200 || status>=300) Print("Tradefolio sync error HTTP ",status,": ",reply);
   else Print("Tradefolio sync completed: ",reply);
}

int OnInit()
{
   int interval=SyncEverySeconds;
   if(interval<15) interval=15;
   EventSetTimer(interval);
   SyncHistory();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { SyncHistory(); }
