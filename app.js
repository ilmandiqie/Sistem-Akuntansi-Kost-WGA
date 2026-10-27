"use strict";

const state = {
  user: null,
  profile: null,
  page: "dashboard",
  tenants: [],
  properties: [],
  rooms: [],
  payments: [],
  invoices: [],
  maintenance: [],
  chartOfAccounts: [],
  journalEntries: [],
  deposits: [],
  refunds: [],
  reminderInvoiceId: "",
  tenantSearch: "",
  paymentSearch: "",
  maintenanceSearch: "",
  receivableMonth: monthNow(),
  reportType: "income",
  reportFrom: `${new Date().getFullYear()}-01-01`,
  reportTo: dateInput(new Date()),
  dashboardRange: "6months",
  roomView: "grid",
  editingTenantId: null,
  editingMaintenanceId: null
};

const dashboardCharts = {};

const meta = {
  dashboard: ["Overview", "Dashboard"],
  properties: ["Property Master", "Properti & Kamar"],
  tenants: ["Master Data", "Penyewa & Kamar"],
  receivables: ["Receivables", "Kontrol Piutang"],
  payments: ["Cash Receipt", "Penerimaan Kas"],
  maintenance: ["Operational", "Maintenance & Pengeluaran"],
  accounting: ["Accounting", "Laporan Keuangan"],
  deposits: ["Tenant Finance", "Deposit & Refund"]
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUI();
  document.getElementById("rec-month").value = state.receivableMonth;
  document.getElementById("period-label").textContent = monthLabel(state.receivableMonth);
  document.getElementById("report-from").value = state.reportFrom;
  document.getElementById("report-to").value = state.reportTo;
  document.getElementById("dashboard-period").value = state.dashboardRange;
  document.getElementById("dashboard-from").value = shiftDate(dateInput(new Date()), -29);
  document.getElementById("dashboard-to").value = dateInput(new Date());
  document.getElementById("ledger-from").value = state.reportFrom;
  document.getElementById("ledger-to").value = state.reportTo;
  document.getElementById("payment-date").value = dateInput(new Date());
  document.getElementById("maintenance-date").value = dateInput(new Date());
  document.getElementById("maintenance-payment-date").value = dateInput(new Date());
  document.getElementById("deposit-date").value = dateInput(new Date());
  document.getElementById("refund-date").value = dateInput(new Date());

  if (!api.isReady()) {
    showAuth();
    toast("Konfigurasi Supabase belum siap. Periksa URL dan anon key di file konfigurasi.", "error");
    return;
  }

  try {
    const session = await api.getSession();
    if (session?.user) await enterApp(session.user);
    else showAuth();
  } catch (e) {
    console.error(e);
    showAuth();
    toast("Periksa konfigurasi Supabase terlebih dahulu.", "error");
  }

  api.onAuthStateChange(async (event, session) => {
    if (event === "SIGNED_OUT" || !session) {
      state.user = null; state.profile = null;
      showAuth();
      return;
    }
    if (event === "SIGNED_IN" || event === "INITIAL_SESSION") {
      if (session.user) await enterApp(session.user);
    }
  });
}

function bindUI() {
  document.getElementById("auth-tab-login").onclick = () => switchAuth("login");
  document.getElementById("auth-tab-register").onclick = () => switchAuth("register");
  document.getElementById("login-form").onsubmit = login;
  document.getElementById("register-form").onsubmit = register;
  document.getElementById("logout-btn").onclick = logout;

  document.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => navigate(b.dataset.page)));
  document.getElementById("mobile-menu").onclick = openMobile;
  document.getElementById("sidebar-overlay").onclick = closeMobile;

  document.getElementById("add-tenant-btn").onclick = () => openTenant();
  document.getElementById("property-form").onsubmit = saveProperty;
  document.getElementById("room-form").onsubmit = saveRoom;
  document.getElementById("tenant-form").onsubmit = saveTenant;
  document.getElementById("tenant-room").onchange = updateTenantRoomRent;
  document.getElementById("tenant-id-card-view").onclick = openTenantIdCard;
  document.getElementById("tenant-search").oninput = e => { state.tenantSearch=e.target.value.toLowerCase(); renderTenants(); };

  document.getElementById("rec-month").onchange = async e => {
    state.receivableMonth = e.target.value || monthNow();
    document.getElementById("period-label").textContent = monthLabel(state.receivableMonth);
    await loadData();
  };

  document.getElementById("add-payment-btn").onclick = () => openPayment();
  document.getElementById("payment-form").onsubmit = savePayment;
  document.getElementById("payment-evidence-form").onsubmit = savePendingPaymentEvidence;
  document.getElementById("payment-method").onchange = updatePaymentMethodFields;
  document.getElementById("payment-reject-form").onsubmit = rejectPayment;
  document.getElementById("payment-search").oninput = e => { state.paymentSearch=e.target.value.toLowerCase(); renderPayments(); };
  document.getElementById("dashboard-period").onchange = e => {
    state.dashboardRange=e.target.value;
    el("dashboard-custom-range").classList.toggle("hidden",state.dashboardRange!=="custom");
    renderDashboard();
  };
  document.getElementById("dashboard-from").onchange = renderDashboard;
  document.getElementById("dashboard-to").onchange = renderDashboard;
  document.getElementById("dashboard-add-tenant").onclick = () => openTenant();
  document.getElementById("dashboard-create-invoice").onclick = () => el("issue-invoices-btn").click();
  document.getElementById("dashboard-add-payment").onclick = () => openPayment();
  document.getElementById("dashboard-add-maintenance").onclick = () => openMaintenance();
  document.getElementById("dashboard-open-reports").onclick = () => navigate("accounting");
  document.getElementById("room-grid-view-btn").onclick = () => setRoomView("grid");
  document.getElementById("room-table-view-btn").onclick = () => setRoomView("table");
  document.getElementById("payment-invoice").onchange = updatePaymentHint;
  document.getElementById("issue-invoices-btn").onclick = issueMonthlyInvoices;
  document.getElementById("reminder-invoice").onchange = e => {
    state.reminderInvoiceId=e.target.value;
    el("whatsapp-reminder-draft").value="";
    el("open-whatsapp-btn").disabled=true;
  };
  document.getElementById("whatsapp-reminder-draft").oninput = e => { el("open-whatsapp-btn").disabled=!e.target.value.trim()||!state.reminderInvoiceId; };
  document.getElementById("template-reminder-btn").onclick = createWhatsAppTemplate;
  document.getElementById("generate-reminder-btn").onclick = generateWhatsAppDraft;
  document.getElementById("open-whatsapp-btn").onclick = openWhatsAppReminder;

  document.getElementById("add-maintenance-btn").onclick = () => openMaintenance();
  document.getElementById("maintenance-form").onsubmit = saveMaintenance;
  document.getElementById("maintenance-search").oninput = e => { state.maintenanceSearch=e.target.value.toLowerCase(); renderMaintenance(); };
  document.getElementById("deposit-form").onsubmit = saveDeposit;
  document.getElementById("refund-form").onsubmit = saveRefund;
  document.getElementById("refund-deposit").onchange = updateRefundHint;
  document.getElementById("export-accounting-btn").onclick = exportAccountingCsv;
  document.getElementById("print-financial-report").onclick = printFinancialReport;
  document.getElementById("report-from").onchange = e => { state.reportFrom=e.target.value; renderFinancialReport(); };
  document.getElementById("report-to").onchange = e => { state.reportTo=e.target.value; renderFinancialReport(); };
  document.getElementById("ledger-account").onchange = renderGeneralLedger;
  document.getElementById("ledger-from").onchange = renderGeneralLedger;
  document.getElementById("ledger-to").onchange = renderGeneralLedger;
  document.getElementById("print-ledger-btn").onclick = printGeneralLedger;
  document.getElementById("close-period-btn").onclick = closeAccountingPeriod;
  document.querySelectorAll("[data-report-type]").forEach(button => button.onclick = () => {
    state.reportType=button.dataset.reportType;
    renderFinancialReport();
  });

  document.querySelectorAll("[data-close]").forEach(b => b.onclick = () => closeModal(b.dataset.close));
  document.querySelectorAll(".modal").forEach(m => m.onclick = e => { if(e.target===m)m.classList.add("hidden"); });
  document.getElementById("confirm-cancel").onclick = closeConfirm;
}

async function login(e) {
  e.preventDefault();
  try {
    await api.login(val("login-email"), val("login-password"));
    toast("Login berhasil.");
  } catch (err) { toast(err.message, "error"); }
}

async function register(e) {
  e.preventDefault();
  const fullName = val("register-name"), email = val("register-email"), password = val("register-password");
  try {
    const result = await api.register({ email, password, fullName });
    if (result.session) {
      toast("Akun berhasil dibuat.");
    } else {
      switchAuth("login");
      document.getElementById("login-email").value = email;
      toast("Akun dibuat. Konfirmasi email jika diminta Supabase.");
    }
  } catch (err) { toast(err.message, "error"); }
}

async function logout() {
  try { await api.logout(); } catch(e) { toast(e.message,"error"); }
}

async function enterApp(user) {
  state.user = user;
  try {
    state.profile = await api.getProfile(user.id);
  } catch(e) {
    console.warn("Profile tidak tersedia:", e);
    state.profile = null;
  }
  if (!state.profile || !state.profile.approved) {
    await api.logout().catch(error => console.warn("Logout akun belum disetujui gagal:", error));
    showAuth();
    toast(state.profile ? "Akun menunggu persetujuan admin sebelum dapat mengakses data." : "Profil akun belum tersedia. Hubungi admin untuk aktivasi.", "error");
    return;
  }
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("sidebar-user-name").textContent = state.profile.full_name || user.email;
  document.getElementById("sidebar-user-role").textContent = `${labelRole(state.profile.role)} · ${user.email}`;
  const canManage = ["admin", "pengelola"].includes(state.profile.role);
  ["add-tenant-btn", "add-payment-btn", "add-maintenance-btn", "issue-invoices-btn"].forEach(id => el(id).classList.toggle("hidden", !canManage));
  ["dashboard-add-tenant", "dashboard-create-invoice", "dashboard-add-payment", "dashboard-add-maintenance"].forEach(id => el(id).classList.toggle("hidden", !canManage));
  el("close-period-btn").classList.toggle("hidden",state.profile.role!=="admin");
  ["property-form", "room-form"].forEach(id => el(id).closest(".panel").classList.toggle("hidden", !canManage));
  ["deposit-form", "refund-form"].forEach(id => el(id).closest(".panel").classList.toggle("hidden", !canManage));
  await loadData();
  navigate("dashboard");
}

function showAuth() {
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
}

function switchAuth(mode) {
  const login = mode==="login";
  document.getElementById("login-form").classList.toggle("hidden", !login);
  document.getElementById("register-form").classList.toggle("hidden", login);
  document.getElementById("auth-tab-login").classList.toggle("active", login);
  document.getElementById("auth-tab-register").classList.toggle("active", !login);
}

async function loadData() {
  try {
    [state.tenants,state.payments,state.maintenance] = await Promise.all([
      api.getTenants(),api.getPayments(),api.getMaintenance()
    ]);
    try {
      [state.properties,state.rooms] = await Promise.all([api.getProperties(),api.getRooms()]);
    } catch (propertyError) {
      console.warn("Modul properti/kamar belum tersedia:", propertyError.message);
      state.properties=[];
      state.rooms=[];
    }

    try {
      state.invoices = await api.getInvoices(state.receivableMonth);
    } catch (invoiceError) {
      console.warn("Modul invoice belum tersedia:", invoiceError.message);
      state.invoices = [];
    }

    if (api.isReady()) {
      try {
        [state.chartOfAccounts, state.journalEntries] = await Promise.all([api.getChartOfAccounts(), api.getJournalEntries()]);
      } catch (accountingError) {
        console.warn("Accounting schema belum tersedia:", accountingError.message);
        state.chartOfAccounts = [];
        state.journalEntries = [];
      }
      try {
        [state.deposits, state.refunds] = await Promise.all([api.getDeposits(), api.getRefunds()]);
      } catch (depositError) {
        console.warn("Skema deposit/refund belum tersedia:", depositError.message);
        state.deposits = [];
        state.refunds = [];
      }
    }

    renderAll();
  } catch(e) {
    console.error(e); toast("Gagal memuat data: "+e.message,"error");
  }
}

function navigate(page) {
  state.page=page;
  document.querySelectorAll(".page-section").forEach(s=>s.classList.add("hidden"));
  document.getElementById("page-"+page).classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const m=meta[page]; document.getElementById("page-kicker").textContent=m[0]; document.getElementById("page-title").textContent=m[1];
  closeMobile(); renderCurrent();
}

function renderCurrent() {
  if(state.page==="dashboard")renderDashboard();
  if(state.page==="properties")renderPropertyRooms();
  if(state.page==="tenants")renderTenants();
  if(state.page==="receivables")renderReceivables();
  if(state.page==="payments")renderPayments();
  if(state.page==="maintenance")renderMaintenance();
  if(state.page==="accounting")renderAccounting();
  if(state.page==="deposits")renderDeposits();
}
function renderAll(){renderDashboard();renderPropertyRooms();renderTenants();renderReceivables();renderPayments();renderMaintenance();renderAccounting();renderDeposits();populatePaymentInvoiceSelect();populateTenantRoomSelect();populatePropertySelect();populateDepositTenantSelect();populateRefundDepositSelect();}

function renderDashboard() {
  const range=getDashboardRange();
  const finance=buildDashboardFinancialData(range);
  const rangePayments=state.payments.filter(payment=>payment.status!=="Dibatalkan"&&(payment.verification_status||"confirmed")==="confirmed"&&payment.payment_date>=range.from&&payment.payment_date<=range.to);
  const cashReceived=sum(rangePayments,payment=>payment.amount);
  const rec=receivables(state.receivableMonth);
  const periodInvoices=(state.invoices||[]).filter(invoice=>invoice.status!=="cancelled");
  const outstanding=periodInvoices.length
    ?sum(periodInvoices,invoice=>Math.max(num(invoice.total_amount)-invoicePaidAmount(invoice),0))
    :sum(rec,row=>row.outstanding);
  const active=state.tenants.filter(t=>t.status==="Aktif");
  const propertyRooms=state.rooms.filter(room=>room.properties?.status!=="closed");
  const occupancyRooms=propertyRooms.filter(room=>room.status!=="inactive");
  const totalRooms=occupancyRooms.length;
  const occupiedRooms=totalRooms?occupancyRooms.filter(room=>room.status==="occupied").length:active.length;
  const vacantRooms=occupancyRooms.filter(room=>room.status==="available").length;
  const occupancy=totalRooms?Math.round(occupiedRooms/totalRooms*100):0;
  const today=dateInput(new Date());
  const reminderLimit=shiftDate(today,30);
  const contractFollowups=active.filter(tenant=>tenant.contract_end_date&&tenant.contract_end_date<=reminderLimit);
  const pendingTransfers=state.payments.filter(payment=>payment.status!=="Dibatalkan"&&payment.verification_status==="pending").sort((a,b)=>String(a.payment_date).localeCompare(String(b.payment_date)));
  const overdueInvoices=periodInvoices.filter(invoice=>num(invoice.total_amount)-invoicePaidAmount(invoice)>0&&invoice.due_date<today);
  const cashBalance=getAccountingSummary().cashBalance;
  const depositBalance=sum((state.deposits||[]).filter(deposit=>deposit.status==="active"),deposit=>{
    const refunded=sum((state.refunds||[]).filter(refund=>refund.deposit_id===deposit.id&&refund.status==="released"),refund=>refund.amount);
    return Math.max(num(deposit.amount)-refunded,0);
  });
  const periodLabel=`${formatDate(range.from)} – ${formatDate(range.to)}`;

  el("dashboard-date").textContent=new Intl.DateTimeFormat("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date());
  el("dashboard-greeting").textContent=`${timeGreeting()}, ${state.profile?.full_name||"Pengelola Kost WGA"}`;
  el("dashboard-period-caption").textContent=periodLabel;
  el("dashboard-chart-range").textContent=periodLabel;
  el("dashboard-invoice-period").textContent=`Nominal invoice · ${monthLabel(state.receivableMonth)}`;
  el("dashboard-revenue-kpi").textContent=idr(finance.revenue);
  el("stat-cash").textContent=idr(cashReceived);
  el("stat-receivable").textContent=idr(outstanding);
  el("stat-maintenance").textContent=idr(finance.expense);
  el("dashboard-cash-balance").textContent=idr(cashBalance);
  el("dashboard-deposit-balance").textContent=idr(depositBalance);
  el("stat-occupied").textContent=occupiedRooms;
  el("stat-room-total").textContent=totalRooms;el("stat-vacant").textContent=vacantRooms;el("stat-occupancy").textContent=`${occupancy}%`;
  el("dashboard-occupancy-track").style.width=`${occupancy}%`;
  el("dashboard-insight-occupancy").textContent=`${occupancy}%`;
  el("dashboard-insight-track").style.width=`${occupancy}%`;
  el("dashboard-insight-vacant").textContent=String(vacantRooms);
  el("dashboard-insight-overdue").textContent=String(overdueInvoices.length);
  el("stat-contract-followup").textContent=String(contractFollowups.length);
  el("stat-pending-transfers").textContent=String(pendingTransfers.length);
  el("dash-paid-count").textContent=periodInvoices.filter(invoice=>invoice.total_amount>0&&invoicePaidAmount(invoice)>=num(invoice.total_amount)).length;
  el("dash-unpaid-count").textContent=periodInvoices.filter(invoice=>invoicePaidAmount(invoice)<num(invoice.total_amount)).length;
  el("dash-overdue-count").textContent=overdueInvoices.length;
  renderDashboardCharts(finance,propertyRooms,periodInvoices,today);

  el("dashboard-pending-transfers").innerHTML=pendingTransfers.length?pendingTransfers.slice(0,5).map(payment=>`<tr><td>${formatDate(payment.payment_date)}</td><td><b>${esc(payment.tenant_name)}</b><small>${esc(payment.room_number)}</small></td><td>${esc(payment.transaction_reference||"Belum ada referensi")}</td><td class="font-bold">${idr(payment.amount)}</td><td>${payment.evidence_path&&canManageData()?`<button class="text-wga-700 p-2" title="Periksa bukti transfer" aria-label="Periksa bukti transfer" onclick="viewPaymentEvidence('${payment.id}')"><i class="fa-solid fa-paperclip"></i></button>`:"Belum dilampirkan"}</td></tr>`).join(""):`<tr><td colspan="5">${empty("fa-circle-check","Tidak ada transfer yang menunggu verifikasi.")}</td></tr>`;

  el("contract-expiry-body").innerHTML=contractFollowups.length?contractFollowups.sort((a,b)=>String(a.contract_end_date).localeCompare(String(b.contract_end_date))).map(tenant=>{
    const expired=tenant.contract_end_date<today;
    return `<tr><td><b>${esc(tenant.name)}</b><small>${esc(tenant.tenant_id)}</small></td><td>${esc(tenant.room_number)}</td><td>${esc(tenant.contract_number||"-")}</td><td>${formatDate(tenant.contract_end_date)}</td><td><span class="badge ${expired?"red":"yellow"}">${expired?"Lewat":"Segera"}</span></td><td>${canManageData()?`<button class="btn-secondary !py-1.5 !px-2" onclick="editTenant('${tenant.id}')">Perbarui</button>`:"-"}</td></tr>`;
  }).join(""):`<tr><td colspan="6">${empty("fa-calendar-check","Tidak ada kontrak aktif yang perlu ditindaklanjuti dalam 30 hari.")}</td></tr>`;

  const debt=rec.filter(r=>r.outstanding>0).sort((a,b)=>b.outstanding-a.outstanding).slice(0,5);
  el("dashboard-receivables").innerHTML=debt.length?debt.map(r=>`
    <div class="flex justify-between gap-3 py-2">
      <div><p class="text-sm font-bold">${esc(r.tenant.name)}</p><p class="text-xs text-slate-400">Kamar ${esc(r.tenant.room_number)} · Jatuh tempo ${r.tenant.due_date}</p></div>
      <div class="text-right"><p class="text-sm font-bold text-rose-700">${idr(r.outstanding)}</p>${payBadge(r.status)}</div>
    </div>`).join(""):empty("fa-circle-check","Tidak ada piutang.");
  const activeMaint=state.maintenance.filter(m=>m.status!=="completed").slice(0,5);
  el("dashboard-maintenance").innerHTML=activeMaint.length?activeMaint.map(m=>`
    <div class="flex gap-3 items-start"><div class="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><i class="fa-solid fa-screwdriver-wrench"></i></div><div class="min-w-0"><p class="text-sm font-bold truncate">${esc(m.title)}</p><p class="text-xs text-slate-400">${esc(m.room_number||"Area umum")} · ${idr(m.cost)}</p>${maintBadge(m.status)}</div></div>`).join(""):empty("fa-check-double","Tidak ada maintenance aktif.");
}

function getDashboardRange() {
  const today=dateInput(new Date());
  const selected=state.dashboardRange;
  let from=today,to=today;
  if(selected==="7d")from=shiftDate(today,-6);
  else if(selected==="30d")from=shiftDate(today,-29);
  else if(selected==="this-month")from=`${today.slice(0,7)}-01`;
  else if(selected==="last-month"){
    const date=new Date(`${today.slice(0,7)}-01T00:00:00`);
    date.setMonth(date.getMonth()-1);
    from=dateInput(date);
    date.setMonth(date.getMonth()+1);
    to=shiftDate(dateInput(date),-1);
  }else if(selected==="6months"){
    const date=new Date(`${today.slice(0,7)}-01T00:00:00`);
    date.setMonth(date.getMonth()-5);
    from=dateInput(date);
  }else if(selected==="this-year")from=`${today.slice(0,4)}-01-01`;
  else if(selected==="custom"){
    from=val("dashboard-from");
    to=val("dashboard-to");
  }
  const valid=Boolean(from&&to&&from<=to);
  return {from,to,valid,label:valid?`${formatDate(from)} – ${formatDate(to)}`:"Rentang tanggal tidak valid"};
}

function timeGreeting() {
  const hour=new Date().getHours();
  if(hour<11)return "Selamat pagi";
  if(hour<15)return "Selamat siang";
  if(hour<18)return "Selamat sore";
  return "Selamat malam";
}

function buildDashboardFinancialData(range) {
  if(!range.valid)return {labels:[],keys:[],revenueValues:[],expenseValues:[],revenue:0,expense:0,expenseAccounts:[],hasJournalData:false};
  const start=new Date(`${range.from}T00:00:00`);
  const end=new Date(`${range.to}T00:00:00`);
  const daily=(end-start)/86400000<62;
  const buckets=[];
  const cursor=new Date(start);
  if(!daily)cursor.setDate(1);
  while(cursor<=end){
    const key=daily?dateInput(cursor):dateInput(cursor).slice(0,7);
    buckets.push(key);
    if(daily)cursor.setDate(cursor.getDate()+1);
    else cursor.setMonth(cursor.getMonth()+1);
  }
  const bucketData=new Map(buckets.map(key=>[key,{revenue:0,expense:0}]));
  const accounts=new Map((state.chartOfAccounts||[]).map(account=>[account.code,account]));
  const expenseAccounts=new Map();
  let hasJournalData=false;
  for(const entry of state.journalEntries||[]){
    if(entry.status!=="posted"||entry.entry_date<range.from||entry.entry_date>range.to)continue;
    hasJournalData=true;
    const key=daily?entry.entry_date:String(entry.entry_date).slice(0,7);
    const bucket=bucketData.get(key);
    if(!bucket)continue;
    for(const line of entry.journal_entry_lines||[]){
      const account=accounts.get(line.account_code);
      if(!account)continue;
      const debit=num(line.debit),credit=num(line.credit);
      if(account.account_group==="Revenue")bucket.revenue+=account.normal_balance==="credit"?credit-debit:debit-credit;
      if(account.account_group==="Expense"){
        const amount=account.normal_balance==="credit"?credit-debit:debit-credit;
        bucket.expense+=amount;
        expenseAccounts.set(account.code,(expenseAccounts.get(account.code)||0)+amount);
      }
    }
  }
  const labels=buckets.map(key=>daily
    ?new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"short"}).format(new Date(`${key}T00:00:00`))
    :monthLabel(key));
  const values=Array.from(bucketData.values());
  const revenueValues=values.map(value=>value.revenue);
  const expenseValues=values.map(value=>value.expense);
  return {
    labels,keys:buckets,revenueValues,expenseValues,
    revenue:sum(values,value=>value.revenue),
    expense:sum(values,value=>value.expense),
    expenseAccounts:Array.from(expenseAccounts.entries()).map(([code,amount])=>({account:accounts.get(code),amount})).filter(row=>row.amount>0).sort((a,b)=>b.amount-a.amount),
    hasJournalData
  };
}

function renderDashboardCharts(finance,rooms,invoices,today) {
  const colors=["#176B4D","#35A875","#D99528","#D95353","#4285B8","#71877B","#9AB8A5","#C58B5C"];
  const lineCanvas=el("dashboard-finance-chart");
  const lineEmpty=el("dashboard-finance-empty");
  const hasTrend=finance.hasJournalData&&finance.labels.length>0;
  lineCanvas.classList.toggle("hidden",!hasTrend);
  lineEmpty.classList.toggle("hidden",hasTrend);
  if(hasTrend&&window.Chart){
    const profit=finance.revenueValues.map((value,index)=>value-finance.expenseValues[index]);
    const config={
      type:"line",
      data:{labels:finance.labels,datasets:[
        {label:"Pendapatan",data:finance.revenueValues,borderColor:colors[0],backgroundColor:"rgba(53,168,117,.12)",fill:true,tension:.34,borderWidth:3,pointRadius:2,pointHoverRadius:5},
        {label:"Beban",data:finance.expenseValues,borderColor:colors[2],backgroundColor:"rgba(217,149,40,.08)",fill:false,tension:.34,borderWidth:2,pointRadius:2,pointHoverRadius:5},
        {label:"Laba / (rugi)",data:profit,borderColor:colors[4],backgroundColor:"transparent",fill:false,tension:.34,borderWidth:2,borderDash:[5,4],pointRadius:0,pointHoverRadius:4}
      ]},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},animation:window.matchMedia("(prefers-reduced-motion: reduce)").matches?false:{duration:450},plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,padding:18,font:{family:"Plus Jakarta Sans",size:13}}},tooltip:{callbacks:{label:context=>`${context.dataset.label}: ${idr(context.raw)}`}}},scales:{x:{grid:{display:false},ticks:{color:"#738278",maxRotation:0,font:{family:"Plus Jakarta Sans",size:12},autoSkip:true,maxTicksLimit:8}},y:{beginAtZero:true,grid:{color:"#edf2ee"},ticks:{color:"#738278",font:{family:"Plus Jakarta Sans",size:12},callback:value=>new Intl.NumberFormat("id-ID",{notation:"compact",maximumFractionDigits:1}).format(value)}}}}
    };
    updateDashboardChart("finance",lineCanvas,config);
  }else if(!hasTrend){
    lineEmpty.textContent="Belum ada jurnal posted pada periode ini. Grafik hanya menampilkan data akuntansi aktual.";
  }else{
    lineEmpty.classList.remove("hidden");
    lineCanvas.classList.add("hidden");
    lineEmpty.textContent="Grafik belum dapat dimuat. Periksa koneksi pustaka Chart.js.";
  }
  const peakIndex=values=>values.length?values.indexOf(Math.max(...values)):-1;
  const peakRevenue=peakIndex(finance.revenueValues);
  const peakExpense=peakIndex(finance.expenseValues);
  el("dashboard-trend-summary").textContent=finance.labels.length
    ?`Total periode: pendapatan ${idr(finance.revenue)}, beban ${idr(finance.expense)}, laba/rugi ${idr(finance.revenue-finance.expense)}.${peakRevenue>=0?` Pendapatan tertinggi ${finance.labels[peakRevenue]} (${idr(finance.revenueValues[peakRevenue])}).`:""}${peakExpense>=0?` Beban tertinggi ${finance.labels[peakExpense]} (${idr(finance.expenseValues[peakExpense])}).`:""}`
    :"Tidak ada data periode untuk diringkas.";
  el("dashboard-trend-table").innerHTML=finance.labels.length?`<table class="data-table"><thead><tr><th>Periode</th><th class="text-right">Pendapatan</th><th class="text-right">Beban</th><th class="text-right">Laba / (rugi)</th></tr></thead><tbody>${finance.labels.map((label,index)=>`<tr><td>${esc(label)}</td><td class="text-right">${idr(finance.revenueValues[index])}</td><td class="text-right">${idr(finance.expenseValues[index])}</td><td class="text-right">${idr(finance.revenueValues[index]-finance.expenseValues[index])}</td></tr>`).join("")}</tbody></table>`:`<p class="empty">Tidak ada data periode untuk ditampilkan.</p>`;

  const roomStatuses=[
    {key:"occupied",label:"Terisi",color:colors[0]},
    {key:"available",label:"Kosong",color:colors[1]},
    {key:"reserved",label:"Dipesan",color:colors[2]},
    {key:"maintenance",label:"Maintenance",color:colors[3]},
    {key:"inactive",label:"Tidak aktif",color:colors[5]}
  ];
  const roomData=roomStatuses.map(status=>({...status,value:rooms.filter(room=>room.status===status.key).length}));
  const roomTotal=sum(roomData,row=>row.value);
  el("dashboard-room-total").innerHTML=roomTotal?`<strong>${roomTotal}</strong><small>kamar</small>`:"";
  renderDonutChart("rooms","dashboard-room-chart","dashboard-room-empty","dashboard-room-legend",roomData,roomTotal,value=>String(value));

  const expenseData=finance.expenseAccounts.map((row,index)=>({label:`${row.account.code} · ${row.account.name}`,value:row.amount,color:colors[index%colors.length]}));
  renderDonutChart("expenses","dashboard-expense-chart","dashboard-expense-empty","dashboard-expense-legend",expenseData,0,idr);

  const invoiceStatus=[
    {key:"paid",label:"Lunas",color:colors[0],value:0},
    {key:"partial",label:"Sebagian",color:colors[4],value:0},
    {key:"overdue",label:"Terlambat",color:colors[3],value:0},
    {key:"unpaid",label:"Belum lunas",color:colors[2],value:0}
  ];
  for(const invoice of invoices){
    const amount=num(invoice.total_amount);
    if(amount<=0)continue;
    const paid=invoicePaidAmount(invoice);
    const status=paid>=amount?"paid":paid>0?"partial":invoice.due_date<today?"overdue":"unpaid";
    invoiceStatus.find(item=>item.key===status).value+=amount;
  }
  renderDonutChart("invoices","dashboard-invoice-chart","dashboard-invoice-empty","dashboard-invoice-legend",invoiceStatus,0,idr);
}

function updateDashboardChart(name,canvas,config) {
  if(dashboardCharts[name]){
    dashboardCharts[name].data=config.data;
    dashboardCharts[name].options=config.options;
    dashboardCharts[name].update();
  }else dashboardCharts[name]=new Chart(canvas,config);
}

function renderDonutChart(name,canvasId,emptyId,legendId,items,centerTotal,formatValue) {
  const canvas=el(canvasId),emptyState=el(emptyId),legend=el(legendId);
  const data=items.filter(item=>item.value>0);
  const total=sum(data,item=>item.value);
  const chartAvailable=Boolean(window.Chart);
  const hasData=total>0&&chartAvailable;
  canvas.classList.toggle("hidden",!hasData);
  emptyState.classList.toggle("hidden",hasData);
  if(!hasData){
    emptyState.textContent=total>0?"Grafik tidak tersedia. Coba muat ulang halaman.":"Belum ada data pada periode ini.";
    legend.innerHTML=items.map(item=>`<div class="legend-row"><span class="legend-swatch" style="--legend-color:${item.color}"></span><span>${esc(item.label)}</span><strong>${esc(formatValue(item.value))}</strong></div>`).join("");
    if(dashboardCharts[name]){dashboardCharts[name].destroy();delete dashboardCharts[name]}
    return;
  }
  const config={
    type:"doughnut",
    data:{labels:data.map(item=>item.label),datasets:[{data:data.map(item=>item.value),backgroundColor:data.map(item=>item.color),borderColor:"#fff",borderWidth:3,hoverOffset:7}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:"70%",animation:window.matchMedia("(prefers-reduced-motion: reduce)").matches?false:{duration:450},plugins:{legend:{display:false},tooltip:{callbacks:{label:context=>`${context.label}: ${formatValue(context.raw)} (${total?Math.round(context.raw/total*100):0}%)`}}}}
  };
  updateDashboardChart(name,canvas,config);
  legend.innerHTML=items.map(item=>`<div class="legend-row"><span class="legend-swatch" style="--legend-color:${item.color}"></span><span>${esc(item.label)}</span><strong>${esc(formatValue(item.value))}<small> (${total?Math.round(item.value/total*100):0}%)</small></strong></div>`).join("");
}

function renderPropertyRooms() {
  el("property-body").innerHTML=state.properties.length?state.properties.map(property=>`
    <tr><td class="font-bold text-wga-700">${esc(property.code)}</td><td><b>${esc(property.name)}</b><small>${esc(property.owner_name||"")}</small></td><td>${esc(property.address||"-")}</td><td>${property.floor_count}</td><td><span class="badge ${property.status==="active"?"green":"gray"}">${esc(property.status)}</span></td></tr>
  `).join(""):`<tr><td colspan="5">${empty("fa-building","Belum ada properti.")}</td></tr>`;
  el("room-body").innerHTML=state.rooms.length?state.rooms.map(room=>{
    const statusOptions=["available","reserved","occupied","maintenance","inactive"].map(status=>`<option value="${status}" ${room.status===status?"selected":""}>${status}</option>`).join("");
    return `<tr><td>${esc(room.properties?.name||"Kost WGA")}</td><td class="font-bold">${esc(room.room_number)}</td><td>${room.floor_number||"-"}</td><td>${esc(room.room_type)}</td><td>${idr(room.monthly_rent)}</td><td>${esc(room.condition)}</td><td>${canManageData()?`<select class="input !py-1 !px-2" aria-label="Status kamar ${escAttr(room.room_number)}" onchange="updateRoomStatus('${room.id}',this.value)">${statusOptions}</select>`:`<span class="badge ${room.status==="occupied"?"blue":room.status==="available"?"green":"yellow"}">${esc(room.status)}</span>`}</td></tr>`;
  }).join(""):`<tr><td colspan="7">${empty("fa-door-closed","Belum ada data kamar. Tambahkan properti dan kamar.")}</td></tr>`;
  el("room-grid").innerHTML=state.rooms.length?state.rooms.map(room=>{
    const activeTenant=canManageData()?state.tenants.find(tenant=>tenant.room_id===room.id&&tenant.status==="Aktif"):null;
    const activeWork=state.maintenance.filter(ticket=>ticket.room_number===room.room_number&&ticket.status!=="completed");
    const statusLabels={occupied:"Terisi",available:"Tersedia",reserved:"Dipesan",maintenance:"Maintenance",inactive:"Tidak aktif"};
    const statusClasses={occupied:"room-status-occupied",available:"room-status-available",reserved:"room-status-reserved",maintenance:"room-status-maintenance",inactive:"room-status-inactive"};
    const statusOptions=["available","reserved","occupied","maintenance","inactive"].map(status=>`<option value="${status}" ${room.status===status?"selected":""}>${statusLabels[status]}</option>`).join("");
    return `<article class="room-tile ${statusClasses[room.status]||"room-status-inactive"}">
      <div class="room-tile-top"><span class="room-status-mark" aria-hidden="true"></span><span class="room-status-label">${esc(statusLabels[room.status]||room.status)}</span><span class="room-number">${esc(room.room_number)}</span></div>
      <p class="room-property">${esc(room.properties?.name||"Kost WGA")}${room.floor_number?` · Lantai ${room.floor_number}`:""}</p>
      <h5>${esc(room.room_type||"Kamar")}</h5>
      <p class="room-rent">${idr(room.monthly_rent)}<small> / bulan</small></p>
      <div class="room-tile-details"><span><i class="fa-solid fa-screwdriver-wrench"></i> ${activeWork.length?`${activeWork.length} pekerjaan aktif`:"Kondisi " + esc(room.condition||"baik")}</span>${room.facilities?`<span><i class="fa-solid fa-list-check"></i> ${esc(room.facilities)}</span>`:""}${activeTenant?`<span><i class="fa-solid fa-user"></i> ${esc(activeTenant.name)}</span>`:""}</div>
      ${canManageData()?`<label class="room-status-control"><span>Status kamar</span><select class="input" aria-label="Status kamar ${escAttr(room.room_number)}" onchange="updateRoomStatus('${room.id}',this.value)">${statusOptions}</select></label>`:""}
    </article>`;
  }).join(""):`<div class="room-empty">${empty("fa-door-closed","Belum ada data kamar. Tambahkan properti dan kamar.")}</div>`;
  setRoomView(state.roomView,false);
}

function setRoomView(view,render=true) {
  state.roomView=view;
  el("room-grid").classList.toggle("hidden",view!=="grid");
  el("room-table-view").classList.toggle("hidden",view!=="table");
  el("room-grid-view-btn").setAttribute("aria-pressed",String(view==="grid"));
  el("room-table-view-btn").setAttribute("aria-pressed",String(view==="table"));
  if(render&&state.rooms.length)renderPropertyRooms();
}

async function saveProperty(event) {
  event.preventDefault();
  const code=val("property-code").trim().toUpperCase();
  if(!/^[A-Z0-9-]+$/.test(code)){toast("Kode properti hanya boleh berisi huruf, angka, dan tanda hubung.","error");return}
  try {
    await api.createProperty({code,name:val("property-name").trim(),address:val("property-address").trim()||null,owner_name:val("property-owner").trim()||null,contact_phone:val("property-phone").trim()||null,floor_count:Number(val("property-floors")),status:"active"});
    el("property-form").reset();el("property-floors").value="1";
    toast("Properti berhasil ditambahkan.");await loadData();
  } catch(error){toast(error.message,"error")}
}

async function saveRoom(event) {
  event.preventDefault();
  const monthlyRent=num(val("room-rent"));
  if(!val("room-property")||monthlyRent<0){toast("Pilih properti dan isi tarif kamar yang valid.","error");return}
  try {
    await api.createRoom({property_id:val("room-property"),room_number:val("room-number").trim(),floor_number:val("room-floor")?Number(val("room-floor")):null,room_type:val("room-type").trim(),monthly_rent:monthlyRent,facilities:val("room-facilities").trim()||null,status:"available"});
    el("room-form").reset();el("room-type").value="Standard";
    toast("Kamar berhasil ditambahkan.");await loadData();
  } catch(error){toast(error.message,"error")}
}

async function updateRoomStatus(id,status) {
  try {
    await api.updateRoom(id,{status});
    toast("Status kamar diperbarui.");await loadData();
  } catch(error){toast(error.message,"error");await loadData()}
}
window.updateRoomStatus=updateRoomStatus;

function populatePropertySelect() {
  el("room-property").innerHTML='<option value="">Pilih properti...</option>'+state.properties.filter(property=>property.status==="active").map(property=>`<option value="${escAttr(property.id)}">${esc(property.name)}</option>`).join("");
}

function populateTenantRoomSelect() {
  const currentTenant=state.editingTenantId?tenantById(state.editingTenantId):null;
  const available=state.rooms.filter(room=>room.status==="available"||room.id===currentTenant?.room_id);
  el("tenant-room").innerHTML='<option value="">Pilih kamar...</option>'+available.map(room=>`<option value="${escAttr(room.id)}">${esc(room.properties?.name||"Kost WGA")} — ${esc(room.room_number)} · ${idr(room.monthly_rent)}</option>`).join("");
}

function updateTenantRoomRent() {
  const room=state.rooms.find(item=>item.id===val("tenant-room"));
  if(room)el("tenant-rent").value=String(room.monthly_rent);
}

function renderTenants() {
  const q=state.tenantSearch, rows=state.tenants.filter(t=>[t.tenant_id,t.name,t.room_number,t.status,t.phone,t.email,t.emergency_phone].some(x=>String(x||"").toLowerCase().includes(q)));
  el("tenant-body").innerHTML=rows.length?rows.map(t=>`<tr>
    <td class="font-bold text-wga-700">${esc(t.tenant_id)}</td><td class="font-semibold">${esc(t.name)}<small>${esc(t.contract_number||"")}</small></td><td>${esc(t.room_number)}</td><td class="font-bold">${idr(t.monthly_rent)}</td><td>Tanggal ${t.due_date}</td>
    <td>${t.status==="Aktif"?'<span class="badge green">Aktif</span>':'<span class="badge gray">Keluar</span>'}</td>
    <td><button class="text-wga-700 p-2" title="Riwayat kontrak" aria-label="Riwayat kontrak" onclick="viewTenantContracts('${t.id}')"><i class="fa-solid fa-file-contract"></i></button>${canManageData()?`<button class="text-slate-500 p-2" onclick="editTenant('${t.id}')"><i class="fa-solid fa-pen"></i></button><button class="text-rose-500 p-2" onclick="deleteTenantAsk('${t.id}')"><i class="fa-solid fa-trash"></i></button>`:""}</td>
  </tr>`).join(""):`<tr><td colspan="7">${empty("fa-users-slash","Belum ada penyewa.")}</td></tr>`;
}
async function viewTenantContracts(tenantId) {
  const tenant=tenantById(tenantId);
  if(!tenant)return;
  el("tenant-contract-history-title").textContent=`Riwayat Kontrak · ${tenant.name}`;
  el("tenant-contract-history-body").innerHTML=`<tr><td colspan="7">${empty("fa-spinner","Memuat riwayat kontrak...")}</td></tr>`;
  modal("tenant-contract-history-modal");
  try {
    const contracts=await api.getTenantContracts(tenant.tenant_id);
    el("tenant-contract-history-body").innerHTML=contracts.length?contracts.map(contract=>`<tr><td class="font-bold">${esc(contract.contract_number)}</td><td>${formatDate(contract.start_date)}</td><td>${formatDate(contract.end_date)}</td><td>${idr(contract.monthly_rent)}</td><td>Tanggal ${contract.due_day}</td><td><span class="badge ${contract.status==="active"?"green":contract.status==="ended"?"gray":"yellow"}">${esc(contract.status)}</span></td><td>${formatDate(String(contract.created_at||"").slice(0,10))}</td></tr>`).join(""):`<tr><td colspan="7">${empty("fa-file-contract","Belum ada riwayat kontrak.")}</td></tr>`;
  } catch(error) {
    el("tenant-contract-history-body").innerHTML=`<tr><td colspan="7">${empty("fa-circle-exclamation",error.message)}</td></tr>`;
  }
}
window.viewTenantContracts=viewTenantContracts;

function renderReceivables() {
  const rows=receivables(state.receivableMonth);
  el("rec-billed").textContent=idr(sum(rows,r=>r.billed));el("rec-paid").textContent=idr(sum(rows,r=>r.paid));el("rec-outstanding").textContent=idr(sum(rows,r=>r.outstanding));
  const invoiceRows = state.invoices || [];
  el("invoice-body").innerHTML=invoiceRows.length?invoiceRows.map(invoice=>{
    const tenant=tenantByCode(invoice.tenant_id);
    const paid=invoicePaidAmount(invoice);
    const pending=invoicePendingAmount(invoice);
    const outstanding=Math.max(num(invoice.total_amount)-paid,0);
    const available=Math.max(num(invoice.total_amount)-invoiceReservedAmount(invoice),0);
    const status=invoiceStatus(invoice,outstanding);
    const statusLabel=status==="pending_verification"?"Menunggu verifikasi":status==="partially_paid"?"Dibayar sebagian":status==="paid"?"Lunas":status==="overdue"?"Jatuh tempo":"Terbit";
    return `<tr><td class="font-bold text-wga-700">${esc(invoice.invoice_no)}</td><td><b>${esc(tenant?.name||invoice.tenant_id)}</b><small>${esc(invoice.tenant_id)}</small></td><td>${formatDate(invoice.due_date)}</td><td>${idr(invoice.total_amount)}</td><td class="text-emerald-700 font-bold">${idr(paid)}</td><td class="text-amber-700 font-bold">${idr(pending)}</td><td class="text-rose-700 font-bold">${idr(outstanding)}</td><td><span class="badge ${status==="paid"?"green":status==="overdue"?"red":"yellow"}">${statusLabel}</span></td><td class="whitespace-nowrap"><button class="text-wga-700 p-2" title="Cetak invoice" aria-label="Cetak invoice" onclick="printRentInvoice('${invoice.id}')"><i class="fa-solid fa-print"></i></button>${available>0&&canManageData()?`<button class="btn-primary !py-2 !px-3 !text-[11px]" onclick="openInvoicePayment('${invoice.id}')">Bayar</button>`:""}</td></tr>`;
  }).join(""):`<tr><td colspan="9">${empty("fa-file-invoice-dollar","Belum ada invoice untuk periode ini. Terbitkan invoice untuk mengakui pendapatan dan piutang.")}</td></tr>`;
  const reminderInvoices=invoiceRows.filter(invoice=>{
    const tenant=tenantByCode(invoice.tenant_id);
    return num(invoice.total_amount)-invoicePaidAmount(invoice)>0 && tenant?.phone;
  });
  const nextReminderId=reminderInvoices.some(invoice=>invoice.id===state.reminderInvoiceId)?state.reminderInvoiceId:reminderInvoices[0]?.id||"";
  if(nextReminderId!==state.reminderInvoiceId)el("whatsapp-reminder-draft").value="";
  state.reminderInvoiceId=nextReminderId;
  el("reminder-invoice").innerHTML=reminderInvoices.length
    ?reminderInvoices.map(invoice=>`<option value="${escAttr(invoice.id)}" ${invoice.id===state.reminderInvoiceId?"selected":""}>${esc(invoice.invoice_no)} · ${esc(tenantByCode(invoice.tenant_id)?.name||invoice.tenant_id)} · ${idr(Math.max(num(invoice.total_amount)-invoicePaidAmount(invoice),0))}</option>`).join("")
    :'<option value="">Tidak ada invoice outstanding dengan nomor telepon</option>';
  el("generate-reminder-btn").disabled=!reminderInvoices.length;
  el("open-whatsapp-btn").disabled=!reminderInvoices.length||!el("whatsapp-reminder-draft").value.trim();
  const aging=[
    {label:"Belum jatuh tempo",count:0,total:0},
    {label:"1-30 hari",count:0,total:0},
    {label:"31-60 hari",count:0,total:0},
    {label:"61-90 hari",count:0,total:0},
    {label:">90 hari",count:0,total:0}
  ];
  for(const invoice of invoiceRows){
    const outstanding=Math.max(num(invoice.total_amount)-invoicePaidAmount(invoice),0);
    if(outstanding<=0||invoice.status==="cancelled")continue;
    const daysLate=Math.floor((new Date(`${dateInput(new Date())}T00:00:00`)-new Date(`${invoice.due_date}T00:00:00`))/86400000);
    const bucket=daysLate<=0?0:daysLate<=30?1:daysLate<=60?2:daysLate<=90?3:4;
    aging[bucket].count+=1;aging[bucket].total+=outstanding;
  }
  el("receivable-aging-body").innerHTML=aging.map(row=>`<tr><td class="font-semibold">${esc(row.label)}</td><td>${row.count}</td><td class="font-bold">${idr(row.total)}</td></tr>`).join("");
  el("rec-body").innerHTML=rows.length?rows.map(r=>`<tr>
    <td><b>${esc(r.tenant.name)}</b><small>${esc(r.tenant.tenant_id)}</small></td><td>${esc(r.tenant.room_number)}</td><td>${formatDue(state.receivableMonth,r.tenant.due_date)}</td>
    <td>${idr(r.billed)}</td><td class="text-emerald-700 font-bold">${idr(r.paid)}</td><td class="text-rose-700 font-bold">${idr(r.outstanding)}</td><td>${payBadge(r.status)}</td>
    <td>${r.outstanding>0&&canManageData()?`<button class="btn-primary !py-2 !px-3 !text-[11px]" onclick="openPayment('${r.tenant.tenant_id}')">Bayar</button>`:r.outstanding>0?'<span class="text-xs text-slate-400">Belum lunas</span>':'<span class="text-xs text-slate-400">Selesai</span>'}</td>
  </tr>`).join(""):`<tr><td colspan="8">${empty("fa-file-circle-xmark","Tidak ada tagihan.")}</td></tr>`;
}

async function generateWhatsAppDraft() {
  const invoice=(state.invoices||[]).find(item=>item.id===state.reminderInvoiceId);
  const tenant=invoice&&tenantByCode(invoice.tenant_id);
  if(!invoice||!tenant?.phone){toast("Pilih invoice outstanding dengan nomor telepon penyewa.","error");return}
  const button=el("generate-reminder-btn");
  button.disabled=true;
  button.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Menyusun';
  try {
    const draft=await api.generateWhatsAppDraft({
      dueDate:invoice.due_date,
      outstandingAmount:Math.max(num(invoice.total_amount)-invoicePaidAmount(invoice),0),
      period:invoice.period_month
    });
    el("whatsapp-reminder-draft").value=draft.replaceAll("{nama}",tenant.name||"Kak");
    el("open-whatsapp-btn").disabled=false;
    toast("Draft pengingat berhasil dibuat. Periksa sebelum dikirim.");
  } catch(error) {
    toast(error.message||"Gagal membuat draft AI.","error");
  } finally {
    button.disabled=false;
    button.innerHTML='<i class="fa-solid fa-wand-magic-sparkles"></i> Buat draft AI';
  }
}

function createWhatsAppTemplate() {
  const invoice=(state.invoices||[]).find(item=>item.id===state.reminderInvoiceId);
  const tenant=invoice&&tenantByCode(invoice.tenant_id);
  if(!invoice||!tenant?.phone){toast("Pilih invoice outstanding dengan nomor telepon penyewa.","error");return}
  const amount=Math.max(num(invoice.total_amount)-invoicePaidAmount(invoice),0);
  el("whatsapp-reminder-draft").value=`Halo ${tenant.name||"Kak"}, kami mengingatkan bahwa tagihan sewa periode ${invoice.period_month} sebesar ${idr(amount)} jatuh tempo pada ${formatDate(invoice.due_date)}. Mohon konfirmasi jika pembayaran sudah dilakukan. Terima kasih.`;
  el("open-whatsapp-btn").disabled=false;
}

function openWhatsAppReminder() {
  const invoice=(state.invoices||[]).find(item=>item.id===state.reminderInvoiceId);
  const tenant=invoice&&tenantByCode(invoice.tenant_id);
  const draft=el("whatsapp-reminder-draft").value.trim();
  if(!tenant?.phone||!draft){toast("Buat atau isi draft pesan terlebih dahulu.","error");return}
  let phone=String(tenant.phone).replace(/\D/g,"");
  if(phone.startsWith("0"))phone=`62${phone.slice(1)}`;
  else if(phone.startsWith("8"))phone=`62${phone}`;
  if(phone.length<8||phone.length>15){toast("Nomor telepon penyewa tidak valid.","error");return}
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(draft)}`,"_blank","noopener,noreferrer");
}

function renderPayments() {
  const q=state.paymentSearch;
  const rows=[...state.payments].sort((a,b)=>String(b.payment_date).localeCompare(String(a.payment_date))).filter(p=>{
    const t=tenantByCode(p.tenant_id); return [p.payment_id,p.tenant_name,p.room_number,p.payment_method,p.notes].some(x=>String(x||"").toLowerCase().includes(q))||String(t && t.name || "").toLowerCase().includes(q);
  });
  el("payment-total").textContent="Total terverifikasi: "+idr(sum(state.payments.filter(p=>p.status!=="Dibatalkan"&&(p.verification_status||"confirmed")==="confirmed"),p=>p.amount));
  el("payment-body").innerHTML=rows.length?rows.map(p=>`<tr>
    <td class="font-bold text-wga-700">${esc(p.payment_id)}</td><td>${formatDate(p.payment_date)}</td><td><b>${esc(p.tenant_name)}</b><small>${esc(p.room_number)}</small></td>
    <td><span class="badge ${p.payment_method==="Cash"?"gray":"green"}">${esc(p.payment_method)}</span></td><td class="font-bold text-emerald-700">${idr(p.amount)}</td>
    <td>${esc(p.transaction_reference||"-")}${p.evidence_path&&canManageData()?`<button class="text-wga-700 p-2" title="Lihat bukti transfer privat" aria-label="Lihat bukti transfer" onclick="viewPaymentEvidence('${p.id}')"><i class="fa-solid fa-paperclip"></i></button>`:""}</td>
    <td><span class="badge ${(p.verification_status||"confirmed")==="confirmed"?"green":p.verification_status==="rejected"?"red":"yellow"}">${(p.verification_status||"confirmed")==="confirmed"?"Terkonfirmasi":p.verification_status==="rejected"?"Ditolak":"Menunggu"}</span>${p.rejection_reason?`<small>${esc(p.rejection_reason)}</small>`:""}</td>
    <td>${p.status==="Lunas"?'<span class="badge green">Lunas</span>':p.status==="Belum Lunas"?'<span class="badge yellow">Belum Lunas</span>':'<span class="badge red">Dibatalkan</span>'}</td>
    <td>${p.status==="Lunas"&&(p.verification_status||"confirmed")==="confirmed"?`<button class="text-wga-700 p-2" title="Cetak invoice" aria-label="Cetak invoice" onclick="printInvoice('${p.id}')"><i class="fa-solid fa-print"></i></button>`:""}${canManageData()&&p.verification_status==="pending"?`${!p.evidence_path?`<button class="text-wga-700 p-2" title="Lengkapi bukti transfer" aria-label="Lengkapi bukti transfer" onclick="openPaymentEvidenceForm('${p.id}')"><i class="fa-solid fa-paperclip"></i></button>`:""}<button class="text-emerald-700 p-2" title="Konfirmasi transfer" aria-label="Konfirmasi transfer" onclick="verifyPayment('${p.id}')"><i class="fa-solid fa-circle-check"></i></button><button class="text-rose-600 p-2" title="Tolak transfer" aria-label="Tolak transfer" onclick="openRejectPayment('${p.id}')"><i class="fa-solid fa-circle-xmark"></i></button>`:""}${canManageData()&&p.status!=="Dibatalkan"&&p.verification_status!=="pending"?`<button class="text-amber-600 p-2" title="Batalkan pembayaran" aria-label="Batalkan pembayaran" onclick="cancelPaymentAsk('${p.id}')"><i class="fa-solid fa-ban"></i></button>`:""}</td>
  </tr>`).join(""):`<tr><td colspan="9">${empty("fa-receipt","Belum ada pembayaran.")}</td></tr>`;
}

function printInvoice(id) {
  const payment=state.payments.find(p=>p.id===id);
  if(!payment||payment.status!=="Lunas"){toast("Invoice hanya tersedia untuk pembayaran lunas.","error");return}
  const printWindow=window.open("","_blank","width=800,height=900");
  if(!printWindow){toast("Izinkan pop-up untuk mencetak invoice.","error");return}
  const notes=payment.notes?`<p class="notes"><b>Catatan:</b> ${esc(payment.notes)}</p>`:"";
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Invoice ${esc(payment.payment_id)}</title><style>
    *{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#17211f;margin:0;padding:40px}.invoice{max-width:720px;margin:auto;border:1px solid #d7e2dd;padding:36px}.top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #087a56;padding-bottom:22px}.brand{font-size:24px;font-weight:700;color:#087a56}.muted{color:#64746e}.number{text-align:right}.number strong{font-size:17px}.status{display:inline-block;margin-top:8px;padding:6px 10px;background:#e8f7ef;color:#087a56;font-weight:bold}.title{margin:30px 0 18px;font-size:20px}.details{display:grid;grid-template-columns:1fr 1fr;gap:16px}.label{font-size:11px;text-transform:uppercase;color:#64746e;margin-bottom:5px}.value{font-weight:600}.amount{margin-top:28px;padding:18px;background:#f2f8f5;display:flex;justify-content:space-between;align-items:center}.amount strong{font-size:22px;color:#087a56}.notes{margin-top:22px}.footer{margin-top:54px;padding-top:14px;border-top:1px solid #d7e2dd;color:#64746e;font-size:12px;text-align:center}@media print{body{padding:0}.invoice{border:0;padding:20px;max-width:none}}</style></head><body><main class="invoice"><header class="top"><div><div class="brand">Kost WGA</div><div class="muted">Bukti penerimaan pembayaran sewa</div></div><div class="number"><div class="muted">No. Invoice</div><strong>${esc(payment.payment_id)}</strong><div class="status">LUNAS</div></div></header><h1 class="title">Invoice Pembayaran</h1><section class="details"><div><div class="label">Nama Penyewa</div><div class="value">${esc(payment.tenant_name)}</div></div><div><div class="label">Nomor Kamar</div><div class="value">${esc(payment.room_number)}</div></div><div><div class="label">Tanggal Pembayaran</div><div class="value">${formatDate(payment.payment_date)}</div></div><div><div class="label">Metode Pembayaran</div><div class="value">${esc(payment.payment_method)}</div></div></section><div class="amount"><span>Total dibayarkan</span><strong>${idr(payment.amount)}</strong></div>${notes}<footer class="footer">Terima kasih telah melakukan pembayaran. Invoice ini diterbitkan oleh Kost WGA.</footer></main><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  printWindow.document.close();
}

function printRentInvoice(id) {
  const invoice=(state.invoices||[]).find(item=>item.id===id);
  if(!invoice){toast("Invoice tidak ditemukan.","error");return}
  const tenant=tenantByCode(invoice.tenant_id);
  const items=(invoice.invoice_items||[]).map(item=>`<tr><td>${esc(item.description)}</td><td>${num(item.quantity)}</td><td>${idr(item.unit_price)}</td><td>${idr(item.line_total)}</td></tr>`).join("");
  const paid=invoicePaidAmount(invoice);
  const printWindow=window.open("","_blank","width=850,height=900");
  if(!printWindow){toast("Izinkan pop-up untuk mencetak invoice.","error");return}
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(invoice.invoice_no)}</title><style>*{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#1f2937;margin:40px}.invoice{max-width:760px;margin:auto}.header{display:flex;justify-content:space-between;border-bottom:2px solid #047857;padding-bottom:20px}.brand{font-size:24px;color:#047857;font-weight:bold}.muted{color:#64748b;font-size:12px}.title{font-size:22px;margin:26px 0 16px}.details{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:26px}.label{font-size:11px;color:#64748b;text-transform:uppercase}.value{font-weight:bold;margin-top:4px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:10px;border-bottom:1px solid #e2e8f0}th:last-child,td:last-child{text-align:right}.totals{margin:20px 0 0 auto;width:min(100%,360px)}.totals div{display:flex;justify-content:space-between;padding:6px 0}.grand{border-top:2px solid #047857;font-size:18px;font-weight:bold}.footer{margin-top:42px;text-align:center;border-top:1px solid #cbd5e1;padding-top:14px;color:#64748b;font-size:12px}@media print{body{margin:12mm}}</style></head><body><main class="invoice"><header class="header"><div><div class="brand">Kost WGA</div><div class="muted">Tagihan sewa</div></div><div style="text-align:right"><div class="label">Nomor Invoice</div><strong>${esc(invoice.invoice_no)}</strong></div></header><h1 class="title">Invoice Sewa</h1><section class="details"><div><div class="label">Penyewa</div><div class="value">${esc(tenant?.name||invoice.tenant_id)}</div></div><div><div class="label">ID Penyewa</div><div class="value">${esc(invoice.tenant_id)}</div></div><div><div class="label">Periode</div><div class="value">${esc(invoice.period_month)}</div></div><div><div class="label">Jatuh Tempo</div><div class="value">${formatDate(invoice.due_date)}</div></div></section><table><thead><tr><th>Rincian</th><th>Qty</th><th>Harga</th><th>Total</th></tr></thead><tbody>${items}</tbody></table><section class="totals"><div><span>Subtotal</span><strong>${idr(invoice.subtotal)}</strong></div><div><span>Diskon</span><strong>${idr(invoice.discount_amount)}</strong></div><div><span>Pajak</span><strong>${idr(invoice.tax_amount)}</strong></div><div class="grand"><span>Total Tagihan</span><strong>${idr(invoice.total_amount)}</strong></div><div><span>Telah Dibayar</span><strong>${idr(paid)}</strong></div><div><span>Sisa</span><strong>${idr(Math.max(num(invoice.total_amount)-paid,0))}</strong></div></section><footer class="footer">Simpan invoice ini sebagai bukti tagihan periode ${esc(invoice.period_month)}.</footer></main></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderMaintenance() {
  const month=monthNow(), rows=state.maintenance.filter(m=>[m.room_number,m.title,m.description,m.vendor_name,m.status].some(x=>String(x||"").toLowerCase().includes(state.maintenanceSearch)));
  el("maint-cost").textContent=idr(sum(state.maintenance.filter(m=>m.status==="completed"&&String(m.expense_date).slice(0,7)===month),m=>m.cost));
  el("maint-scheduled").textContent=state.maintenance.filter(m=>m.status==="scheduled").length;
  el("maint-active-rooms").textContent=new Set(state.maintenance.filter(m=>m.status==="in_progress"&&m.room_number).map(m=>m.room_number)).size;
  el("maint-total").textContent=idr(sum(state.maintenance.filter(m=>m.status==="completed"),m=>m.cost));
  el("maintenance-body").innerHTML=rows.length?rows.map(m=>`<tr>
    <td>${formatDate(m.expense_date)}</td><td>${esc(m.room_number||"Area Umum")}</td><td><b>${esc(m.title)}</b><small>${esc(m.description||"")}</small></td><td>${esc(m.vendor_name||"-")}</td><td class="font-bold">${idr(m.cost)}</td><td>${maintBadge(m.status)}</td><td><span class="badge ${m.payment_status==="paid"?"green":"yellow"}">${m.payment_status==="paid"?`Dibayar ${formatDate(m.payment_date)}`:"Terutang"}</span></td>
    <td>${canManageData()?`<button class="text-slate-500 p-2" onclick="editMaintenance('${m.id}')"><i class="fa-solid fa-pen"></i></button><button class="text-rose-500 p-2" onclick="deleteMaintenanceAsk('${m.id}')"><i class="fa-solid fa-trash"></i></button>`:"-"}</td>
  </tr>`).join(""):`<tr><td colspan="8">${empty("fa-screwdriver-wrench","Belum ada riwayat maintenance.")}</td></tr>`;
}

function renderAccounting() {
  const journalRows = state.journalEntries || [];
  const postedEntries = journalRows.filter(item => item.status === "posted");
  const totalDebit = postedEntries.reduce((sum, item) => sum + sumJournalLines(item.journal_entry_lines || [], "debit"), 0);
  const totalCredit = postedEntries.reduce((sum, item) => sum + sumJournalLines(item.journal_entry_lines || [], "credit"), 0);
  const accountingOverview = getAccountingSummary();

  el("accounting-journal-count").textContent = String(journalRows.length);
  el("accounting-coa-count").textContent = String((state.chartOfAccounts || []).length);
  el("accounting-total-debit").textContent = idr(totalDebit);
  el("accounting-total-credit").textContent = idr(totalCredit);

  el("accounting-cash-balance").textContent = idr(accountingOverview.cashBalance);
  el("accounting-receivable-balance").textContent = idr(accountingOverview.receivableBalance);
  el("accounting-revenue-total").textContent = idr(accountingOverview.revenue);
  el("accounting-expense-total").textContent = idr(accountingOverview.expense);
  el("accounting-net-profit").textContent = idr(accountingOverview.netProfit);
  el("accounting-net-profit").classList.toggle("text-emerald-700", accountingOverview.netProfit >= 0);
  el("accounting-net-profit").classList.toggle("text-rose-700", accountingOverview.netProfit < 0);

  const trialBalance = buildTrialBalance();
  el("accounting-trial-body").innerHTML = trialBalance.length ? trialBalance.map(account => {
    const signed = account.balance;
    const position = signed >= 0
      ? (account.normal_balance === "credit" ? "Kredit" : "Debit")
      : (account.normal_balance === "credit" ? "Debit" : "Kredit");
    return `<tr>
      <td class="font-bold text-slate-700">${esc(account.code)}</td>
      <td>${esc(account.name)}</td>
      <td>${esc(account.account_group)}</td>
      <td>${esc(account.normal_balance)}</td>
      <td class="font-bold ${signed >= 0 ? "text-emerald-700" : "text-rose-700"}">${idr(Math.abs(signed))}</td>
      <td class="font-bold ${signed >= 0 ? "text-emerald-700" : "text-rose-700"}">${position}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6">${empty("fa-balance-scale","Belum ada data trial balance.")}</td></tr>`;

  const accountByCode = new Map((state.chartOfAccounts || []).map(account => [account.code, account]));
  const rows = [...journalRows].sort((a, b) => String(b.entry_date).localeCompare(String(a.entry_date)) || String(b.journal_no).localeCompare(String(a.journal_no)));
  el("accounting-journal-body").innerHTML = rows.length ? rows.map(entry => {
    const lines = [...(entry.journal_entry_lines || [])].sort((a, b) => (num(b.debit) > 0 ? 1 : 0) - (num(a.debit) > 0 ? 1 : 0) || String(a.account_code).localeCompare(String(b.account_code)));
    const debit = lines.reduce((sum, line) => sum + num(line.debit), 0);
    const credit = lines.reduce((sum, line) => sum + num(line.credit), 0);
    const detailRows = lines.map(line => {
      const account = accountByCode.get(line.account_code);
      return `<tr>
        <td class="pl-8"><span class="font-semibold">${esc(line.account_code)}</span><small>${esc(account?.name || "Akun tidak ditemukan")}</small></td>
        <td>${esc(line.description || entry.description || "-")}</td>
        <td class="text-right">${num(line.debit) ? idr(line.debit) : "-"}</td>
        <td class="text-right">${num(line.credit) ? idr(line.credit) : "-"}</td>
      </tr>`;
    }).join("");
    return `<tr class="bg-slate-50"><td colspan="4" class="font-semibold">
      <div class="flex flex-wrap items-center justify-between gap-2"><span>${formatDate(entry.entry_date)} <span class="text-wga-700">${esc(entry.journal_no || "-")}</span> · ${esc(entry.description || "-")}</span><span class="badge ${entry.status === "posted" ? "green" : "yellow"}">${esc(entry.status || "draft")}</span></div>
    </td></tr>${detailRows}<tr class="border-b-2 border-slate-200"><td colspan="2" class="text-right font-bold">Total jurnal</td><td class="text-right text-emerald-700 font-bold">${idr(debit)}</td><td class="text-right text-rose-700 font-bold">${idr(credit)}</td></tr>`;
  }).join("") : `<tr><td colspan="4">${empty("fa-book-open","Jurnal akuntansi belum dibuat. Jalankan migration accounting dan simpan pembayaran untuk memicu jurnal otomatis.")}</td></tr>`;

  const coaRows = (state.chartOfAccounts || []).slice(0, 10);
  el("accounting-coa-body").innerHTML = coaRows.length ? coaRows.map(account => `
    <tr>
      <td class="font-bold text-slate-700">${esc(account.code || "-")}</td>
      <td>${esc(account.name || "-")}</td>
      <td>${esc(account.account_group || "-")}</td>
      <td>${esc(account.normal_balance || "-")}</td>
      <td>${account.active ? '<span class="badge green">Aktif</span>' : '<span class="badge gray">Nonaktif</span>'}</td>
    </tr>
  `).join("") : `<tr><td colspan="5">${empty("fa-table-list","Chart of accounts belum tersedia.")}</td></tr>`;
  const ledgerSelect = el("ledger-account");
  const selectedAccount = ledgerSelect.value;
  const ledgerAccounts = [...(state.chartOfAccounts || [])].filter(account => account.active).sort((a, b) => String(a.code).localeCompare(String(b.code)));
  ledgerSelect.innerHTML = '<option value="">Pilih akun...</option>' + ledgerAccounts.map(account => `<option value="${escAttr(account.code)}">${esc(account.code)} · ${esc(account.name)}</option>`).join("");
  ledgerSelect.value = ledgerAccounts.some(account => account.code === selectedAccount) ? selectedAccount : ledgerAccounts[0]?.code || "";
  renderGeneralLedger();
  renderFinancialReport();
}

function renderGeneralLedger() {
  const accountCode = val("ledger-account");
  const from = val("ledger-from");
  const to = val("ledger-to");
  const account = (state.chartOfAccounts || []).find(item => item.code === accountCode);
  const content = el("general-ledger-content");
  el("print-ledger-btn").disabled = !account;
  if (!account) {
    content.innerHTML = `<div class="p-6">${empty("fa-book-open","Chart of Accounts belum tersedia untuk ditampilkan sebagai buku besar.")}</div>`;
    ["ledger-opening", "ledger-debit-total", "ledger-credit-total", "ledger-closing"].forEach(id => { el(id).textContent = idr(0); });
    return;
  }
  if (!from || !to || from > to) {
    content.innerHTML = `<div class="p-6">${empty("fa-calendar-xmark","Rentang tanggal tidak valid. Pilih tanggal awal dan akhir yang benar.")}</div>`;
    ["ledger-opening", "ledger-debit-total", "ledger-credit-total", "ledger-closing"].forEach(id => { el(id).textContent = idr(0); });
    return;
  }

  const postedEntries = (state.journalEntries || []).filter(entry => entry.status === "posted");
  const openingEntries = postedEntries.filter(entry => entry.entry_date < from);
  const periodEntries = postedEntries.filter(entry => entry.entry_date >= from && entry.entry_date <= to)
    .sort((a, b) => String(a.entry_date).localeCompare(String(b.entry_date)) || String(a.journal_no).localeCompare(String(b.journal_no)));
  let runningBalance = 0;
  for (const entry of openingEntries) {
    for (const line of entry.journal_entry_lines || []) {
      if (line.account_code === accountCode) runningBalance += num(line.debit) - num(line.credit);
    }
  }
  const openingBalance = runningBalance;
  let periodDebit = 0;
  let periodCredit = 0;
  const ledgerRows = [`<tr class="bg-slate-50 font-semibold"><td colspan="5">Saldo awal per ${formatDate(shiftDate(from, -1))}</td><td class="text-right">${formatLedgerBalance(openingBalance)}</td></tr>`];
  for (const entry of periodEntries) {
    for (const line of entry.journal_entry_lines || []) {
      if (line.account_code !== accountCode) continue;
      const debit = num(line.debit);
      const credit = num(line.credit);
      periodDebit += debit;
      periodCredit += credit;
      runningBalance += debit - credit;
      ledgerRows.push(`<tr>
        <td>${formatDate(entry.entry_date)}</td>
        <td class="font-semibold text-wga-700">${esc(entry.journal_no || "-")}</td>
        <td><b>${esc(entry.description || "-")}</b><small>${esc(line.description || "")}</small></td>
        <td class="text-right">${debit ? idr(debit) : "-"}</td>
        <td class="text-right">${credit ? idr(credit) : "-"}</td>
        <td class="text-right font-semibold">${formatLedgerBalance(runningBalance)}</td>
      </tr>`);
    }
  }
  if (ledgerRows.length === 1) ledgerRows.push(`<tr><td colspan="6" class="text-center text-slate-500">Tidak ada mutasi untuk akun dan rentang tanggal ini.</td></tr>`);
  content.innerHTML = `<div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Tanggal</th><th>No. Jurnal</th><th>Keterangan Transaksi</th><th class="text-right">Debit</th><th class="text-right">Kredit</th><th class="text-right">Saldo Berjalan</th></tr></thead><tbody>${ledgerRows.join("")}</tbody><tfoot><tr class="bg-slate-50 font-bold"><td colspan="3" class="text-right">Total mutasi / saldo akhir</td><td class="text-right">${idr(periodDebit)}</td><td class="text-right">${idr(periodCredit)}</td><td class="text-right">${formatLedgerBalance(runningBalance)}</td></tr></tfoot></table></div>`;
  el("ledger-opening").innerHTML = formatLedgerBalance(openingBalance);
  el("ledger-debit-total").textContent = idr(periodDebit);
  el("ledger-credit-total").textContent = idr(periodCredit);
  el("ledger-closing").innerHTML = formatLedgerBalance(runningBalance);
}

function formatLedgerBalance(balance) {
  const side = Math.abs(balance) < 0.005 ? "Seimbang" : balance > 0 ? "Debit" : "Kredit";
  return `${idr(Math.abs(balance))}<small class="block text-xs font-normal text-slate-500">${side}</small>`;
}

function printGeneralLedger() {
  const account = (state.chartOfAccounts || []).find(item => item.code === val("ledger-account"));
  if (!account) return;
  const printWindow = window.open("", "_blank", "width=1100,height=800");
  if (!printWindow) { toast("Izinkan pop-up untuk mencetak buku besar.", "error"); return; }
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Buku Besar ${esc(account.code)}</title><style>body{font:13px Arial,sans-serif;color:#1f2937;margin:28px}h1{font-size:20px;margin:0 0 6px}.muted{color:#64748b;margin:0 0 18px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid #e2e8f0}th{text-align:right}th:nth-child(-n+3){text-align:left}td:nth-last-child(-n+3){text-align:right}small{color:#64748b;font-size:11px}.bg-slate-50{background:#f8fafc}.font-semibold{font-weight:600}.text-wga-700{color:#047857}@media print{body{margin:12mm}}</style></head><body><h1>Buku Besar · ${esc(account.code)} ${esc(account.name)}</h1><p class="muted">Periode ${formatDate(val("ledger-from"))} sampai ${formatDate(val("ledger-to"))} · Dicetak ${formatDate(dateInput(new Date()))}</p>${el("general-ledger-content").innerHTML}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function renderFinancialReport() {
  const content = el("financial-report-content");
  const from = state.reportFrom;
  const to = state.reportTo;
  renderFinancialTrend(from,to);
  const reportNames = {
    income: "Laporan Laba Rugi",
    position: "Laporan Posisi Keuangan",
    cashflow: "Laporan Arus Kas",
    equity: "Laporan Perubahan Ekuitas",
    notes: "Catatan atas Laporan Keuangan"
  };

  document.querySelectorAll("[data-report-type]").forEach(button => {
    const active = button.dataset.reportType === state.reportType;
    button.classList.toggle("btn-primary", active);
    button.classList.toggle("btn-secondary", !active);
    button.setAttribute("aria-pressed", String(active));
  });

  if (!from || !to || from > to) {
    content.innerHTML = `<div class="p-6">${empty("fa-calendar-xmark","Periode laporan tidak valid. Pilih tanggal awal dan akhir yang benar.")}</div>`;
    return;
  }

  const postedEntries = (state.journalEntries || []).filter(entry => entry.status === "posted");
  const periodEntries = postedEntries.filter(entry => entry.entry_date >= from && entry.entry_date <= to);
  const periodMoves = collectAccountMoves(periodEntries);
  const allMovesToDate = collectAccountMoves(postedEntries.filter(entry => entry.entry_date <= to));
  const openingDate = shiftDate(from, -1);
  const openingMoves = collectAccountMoves(postedEntries.filter(entry => entry.entry_date <= openingDate));
  const accountByCode = new Map((state.chartOfAccounts || []).map(account => [account.code, account]));
  const reportTitle = reportNames[state.reportType] || reportNames.income;
  const periodLabel = `${formatDate(from)} - ${formatDate(to)}`;
  const periodRevenue = groupBalance(periodMoves, "Revenue");
  const periodExpenses = groupBalance(periodMoves, "Expense");
  const netIncome = periodRevenue - periodExpenses;
  const moneyRows = (moves, group) => (state.chartOfAccounts || [])
    .filter(account => account.account_group === group)
    .map(account => ({ account, amount: accountBalance(account, moves) }))
    .filter(row => Math.abs(row.amount) > 0);

  let reportBody = "";
  if (state.reportType === "income") {
    const revenues = moneyRows(periodMoves, "Revenue");
    const expenses = moneyRows(periodMoves, "Expense");
    reportBody = statementTable(reportTitle, periodLabel, [
      ...statementGroupRows("PENDAPATAN", revenues),
      statementTotalRow("Total Pendapatan", periodRevenue),
      ...statementGroupRows("BEBAN", expenses),
      statementTotalRow("Total Beban", periodExpenses),
      statementTotalRow(netIncome >= 0 ? "Laba Bersih Periode Ini" : "Rugi Bersih Periode Ini", netIncome, true)
    ]);
  } else if (state.reportType === "position") {
    const assets = moneyRows(allMovesToDate, "Asset");
    const liabilities = moneyRows(allMovesToDate, "Liability");
    const equityAccounts = moneyRows(allMovesToDate, "Equity");
    const totalAssets = sum(assets, row => row.amount);
    const totalLiabilities = sum(liabilities, row => row.amount);
    const capital = sum(equityAccounts, row => row.amount);
    const retainedEarnings = groupBalance(allMovesToDate, "Revenue") - groupBalance(allMovesToDate, "Expense");
    const totalEquity = capital + retainedEarnings;
    reportBody = statementTable(reportTitle, `Per ${formatDate(to)}`, [
      ...statementGroupRows("ASET", assets),
      statementTotalRow("Total Aset", totalAssets),
      ...statementGroupRows("LIABILITAS", liabilities),
      statementTotalRow("Total Liabilitas", totalLiabilities),
      ...statementGroupRows("EKUITAS", equityAccounts),
      statementTotalRow("Saldo Laba Akumulasi", retainedEarnings),
      statementTotalRow("Total Ekuitas", totalEquity),
      statementTotalRow("Total Liabilitas dan Ekuitas", totalLiabilities + totalEquity, true),
      statementTotalRow("Selisih (harus Rp0)", totalAssets - totalLiabilities - totalEquity)
    ]);
  } else if (state.reportType === "cashflow") {
    const flows = { operating: { inflow: 0, outflow: 0 }, investing: { inflow: 0, outflow: 0 }, financing: { inflow: 0, outflow: 0 } };
    for (const entry of periodEntries) {
      const lines = entry.journal_entry_lines || [];
      const cashLines = lines.filter(line => line.account_code === "1101");
      const counterpartLines = lines.filter(line => line.account_code !== "1101");
      for (const cashLine of cashLines) {
        const cashMovement = num(cashLine.debit) - num(cashLine.credit);
        if (!cashMovement) continue;
        for (const line of counterpartLines) {
          const account = accountByCode.get(line.account_code);
          const amount = cashMovement > 0 ? num(line.credit) - num(line.debit) : num(line.debit) - num(line.credit);
          if (!account || amount <= 0) continue;
          const isFixedAsset = account.account_group === "Asset" && /aset tetap|peralatan|bangunan|kendaraan/i.test(account.name);
          const isFinancingLiability = account.account_group === "Liability" && /utang bank|pinjaman|kredit jangka panjang/i.test(account.name);
          const category = isFixedAsset
            ? "investing"
            : account.account_group === "Equity" || isFinancingLiability
              ? "financing"
              : "operating";
          flows[category][cashMovement > 0 ? "inflow" : "outflow"] += amount;
        }
      }
    }
    const openingCash = accountBalance(accountByCode.get("1101"), openingMoves);
    const closingCash = accountBalance(accountByCode.get("1101"), allMovesToDate);
    const netChange = Object.values(flows).reduce((total, flow) => total + flow.inflow - flow.outflow, 0);
    reportBody = statementTable(reportTitle, periodLabel, [
      statementTotalRow("Saldo Kas Awal Periode", openingCash),
      ...cashFlowRows("Aktivitas Operasi", flows.operating),
      ...cashFlowRows("Aktivitas Investasi", flows.investing),
      ...cashFlowRows("Aktivitas Pendanaan", flows.financing),
      statementTotalRow("Kenaikan / (Penurunan) Kas", netChange),
      statementTotalRow("Saldo Kas Akhir Periode", closingCash, true),
      statementTotalRow("Selisih terhadap buku besar", closingCash - openingCash - netChange)
    ]);
  } else if (state.reportType === "equity") {
    const openingCapital = sum(moneyRows(openingMoves, "Equity"), row => row.amount);
    const openingProfit = groupBalance(openingMoves, "Revenue") - groupBalance(openingMoves, "Expense");
    const openingEquity = openingCapital + openingProfit;
    const capitalMovement = sum(moneyRows(periodMoves, "Equity"), row => row.amount);
    const closingEquity = openingEquity + capitalMovement + netIncome;
    reportBody = statementTable(reportTitle, periodLabel, [
      statementTotalRow("Ekuitas Awal Periode", openingEquity),
      statementTotalRow("Setoran / (Penarikan) Pemilik", capitalMovement),
      statementTotalRow(netIncome >= 0 ? "Laba Bersih Periode Ini" : "Rugi Bersih Periode Ini", netIncome),
      statementTotalRow("Ekuitas Akhir Periode", closingEquity, true)
    ]);
  } else {
    const periodDebit = periodEntries.reduce((total, entry) => total + sumJournalLines(entry.journal_entry_lines || [], "debit"), 0);
    const periodCredit = periodEntries.reduce((total, entry) => total + sumJournalLines(entry.journal_entry_lines || [], "credit"), 0);
    const unpostedCount = (state.journalEntries || []).filter(entry => entry.status !== "posted" && entry.entry_date >= from && entry.entry_date <= to).length;
    const noteRows = [
      ["Dasar penyusunan", "Basis internal aplikasi: penerimaan sewa dicatat saat pembayaran diterima; beban maintenance diakui saat pekerjaan selesai, lalu pelunasan utang dicatat pada tanggal bayar. Ini belum merupakan implementasi penuh SAK EMKM."],
      ["Mata uang", "Rupiah (IDR)."],
      ["Periode laporan", periodLabel],
      ["Jurnal posted dalam periode", String(periodEntries.length)],
      ["Jurnal draft / status lain", String(unpostedCount)],
      ["Uji keseimbangan jurnal periode", Math.abs(periodDebit - periodCredit) < 0.01 ? "Debit dan kredit seimbang." : `Selisih ${idr(periodDebit - periodCredit)}.`],
      ["Batas data", "Laporan hanya mencakup transaksi yang telah dijurnal. Piutang tagihan, aset tetap, pajak, dan transaksi di luar aplikasi belum otomatis diakui jika belum memiliki jurnal."],
      ["Status penggunaan", "Laporan manajemen; periksa kelengkapan dokumen, kebijakan akuntansi, dan kewajiban SAK dengan akuntan sebelum dipakai sebagai laporan resmi." ]
    ];
    reportBody = statementTable(reportTitle, periodLabel, noteRows.map(row => ({ label: row[0], detail: row[1], amount: null })));
  }

  content.innerHTML = reportBody;
}

function renderFinancialTrend(from,to) {
  const canvas=el("financial-trend-chart");
  const emptyState=el("financial-trend-empty");
  const summary=el("financial-trend-summary");
  const valid=Boolean(from&&to&&from<=to);
  const data=buildDashboardFinancialData({from,to,valid});
  if(!valid||!data.hasJournalData){
    canvas.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent=valid?"Belum ada jurnal posted pada periode laporan ini.":"Pilih rentang tanggal laporan yang valid untuk melihat grafik.";
    summary.textContent="Grafik hanya menggunakan pendapatan dan beban dari jurnal posted.";
    if(dashboardCharts.report){dashboardCharts.report.destroy();delete dashboardCharts.report}
    return;
  }
  if(!window.Chart){
    canvas.classList.add("hidden");
    emptyState.classList.remove("hidden");
    emptyState.textContent="Grafik belum tersedia. Periksa koneksi pustaka Chart.js.";
    return;
  }
  canvas.classList.remove("hidden");
  emptyState.classList.add("hidden");
  const net=data.revenueValues.map((value,index)=>value-data.expenseValues[index]);
  updateDashboardChart("report",canvas,{
    type:"bar",
    data:{labels:data.labels,datasets:[
      {label:"Pendapatan",data:data.revenueValues,backgroundColor:"rgba(53,168,117,.82)",borderRadius:6,maxBarThickness:34},
      {label:"Beban",data:data.expenseValues,backgroundColor:"rgba(217,149,40,.76)",borderRadius:6,maxBarThickness:34},
      {type:"line",label:"Laba / (rugi)",data:net,borderColor:"#4285b8",backgroundColor:"#4285b8",borderDash:[5,4],borderWidth:2,tension:.3,pointRadius:2,pointHoverRadius:5}
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},animation:window.matchMedia("(prefers-reduced-motion: reduce)").matches?false:{duration:400},plugins:{legend:{position:"bottom",labels:{usePointStyle:true,boxWidth:8,padding:18,font:{family:"Plus Jakarta Sans",size:13}}},tooltip:{callbacks:{label:context=>`${context.dataset.label}: ${idr(context.raw)}`}}},scales:{x:{grid:{display:false},ticks:{color:"#738278",font:{family:"Plus Jakarta Sans",size:12},autoSkip:true,maxTicksLimit:10}},y:{beginAtZero:true,grid:{color:"#edf2ee"},ticks:{color:"#738278",font:{family:"Plus Jakarta Sans",size:12},callback:value=>new Intl.NumberFormat("id-ID",{notation:"compact",maximumFractionDigits:1}).format(value)}}}}
  });
  summary.textContent=`Total periode: pendapatan ${idr(data.revenue)}, beban ${idr(data.expense)}, laba/rugi ${idr(data.revenue-data.expense)}. Nilai ini bersumber dari jurnal posted.`;
}

function collectAccountMoves(entries) {
  const moves = new Map();
  for (const entry of entries) {
    for (const line of entry.journal_entry_lines || []) {
      const current = moves.get(line.account_code) || { debit: 0, credit: 0 };
      current.debit += num(line.debit);
      current.credit += num(line.credit);
      moves.set(line.account_code, current);
    }
  }
  return moves;
}

function accountBalance(account, moves) {
  if (!account) return 0;
  const move = moves.get(account.code) || { debit: 0, credit: 0 };
  return account.normal_balance === "credit" ? move.credit - move.debit : move.debit - move.credit;
}

function groupBalance(moves, group) {
  return sum((state.chartOfAccounts || []).filter(account => account.account_group === group), account => accountBalance(account, moves));
}

function statementTable(title, period, rows) {
  return `<div class="panel-header"><div><h4 class="font-bold">${esc(title)}</h4><p class="text-xs text-slate-400 mt-1">${esc(period)}</p></div></div>
    <div class="overflow-x-auto"><table class="data-table"><thead><tr><th>Uraian</th><th>Keterangan</th><th class="text-right">Jumlah</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.group ? "bg-slate-50 font-bold" : row.emphasis ? "font-bold border-t-2 border-slate-200" : ""}"><td>${esc(row.label)}</td><td>${esc(row.detail || "")}</td><td class="text-right ${row.amount < 0 ? "text-rose-700" : ""}">${row.amount === null ? "" : idr(row.amount)}</td></tr>`).join("")}</tbody></table></div>`;
}

function printFinancialReport() {
  const report = el("financial-report-content");
  const printWindow = window.open("", "_blank", "width=900,height=800");
  if (!printWindow) {
    toast("Izinkan pop-up untuk mencetak laporan.", "error");
    return;
  }
  printWindow.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Laporan Keuangan Kost WGA</title><style>
    body{font:14px Arial,sans-serif;color:#1f2937;margin:32px}h1{font-size:22px;margin:0 0 6px}p{color:#64748b;margin:0 0 20px}.panel-header{border-bottom:1px solid #cbd5e1;padding-bottom:12px;margin-bottom:12px}h4{font-size:18px;margin:0 0 5px}.text-xs{font-size:11px;color:#64748b}.overflow-x-auto{overflow:visible}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px;border-bottom:1px solid #e2e8f0}th:last-child,td:last-child{text-align:right}.bg-slate-50{background:#f8fafc}.font-bold{font-weight:700}.border-t-2{border-top:2px solid #94a3b8}.text-rose-700{color:#be123c}@media print{body{margin:12mm}}
  </style></head><body><h1>Kost WGA</h1><p>Laporan manajemen berdasarkan jurnal posted. Periksa catatan basis penyusunan pada aplikasi.</p>${report.innerHTML}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

function closeAccountingPeriod() {
  const periodMonth=(state.reportTo||"").slice(0,7);
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodMonth)){toast("Pilih tanggal akhir laporan yang valid.","error");return}
  confirmAsk(
    `Tutup periode ${periodMonth}?`,
    "Penutupan permanen. Pastikan laporan sudah diperiksa, jurnal seimbang, tidak ada draft, dan semua transfer sudah diverifikasi.",
    async()=>{
      const button=el("close-period-btn");
      button.disabled=true;
      try {
        await api.closeAccountingPeriod(periodMonth);
        button.innerHTML='<i class="fa-solid fa-lock"></i> Periode ditutup';
        toast(`Periode ${periodMonth} berhasil ditutup.`);
      } catch(error) {
        button.disabled=false;
        toast(error.message,"error");
      }
    }
  );
}

function statementGroupRows(label, rows) {
  return [{ label, detail: "", amount: null, group: true }, ...rows.map(row => ({ label: `${row.account.code} - ${row.account.name}`, detail: "", amount: row.amount }))];
}

function statementTotalRow(label, amount, emphasis = false) {
  return { label, detail: "", amount, emphasis };
}

function cashFlowRows(title, flow) {
  const net = flow.inflow - flow.outflow;
  return [
    { label: title, detail: "", amount: null, group: true },
    { label: "Kas diterima", detail: "", amount: flow.inflow },
    { label: "Kas dibayarkan", detail: "", amount: -flow.outflow },
    { label: `Arus kas bersih - ${title.toLowerCase()}`, detail: "", amount: net, emphasis: true }
  ];
}

function shiftDate(date, days) {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return dateInput(value);
}

function renderDeposits() {
  const activeDeposits = (state.deposits || []).filter(deposit => deposit.status === "active");
  const activeBalance = sum(activeDeposits, deposit => {
    const refunded = sum((state.refunds || []).filter(refund => refund.deposit_id === deposit.id && refund.status === "released"), refund => refund.amount);
    return Math.max(num(deposit.amount) - refunded, 0);
  });
  el("deposit-active-total").textContent = idr(Math.max(activeBalance, 0));
  el("deposit-count").textContent = String((state.deposits || []).length);
  el("refund-pending-count").textContent = String((state.refunds || []).filter(refund => ["requested", "approved"].includes(refund.status)).length);

  const depositRows = [...(state.deposits || [])].sort((a, b) => String(b.paid_date).localeCompare(String(a.paid_date)));
  el("deposit-body").innerHTML = depositRows.length ? depositRows.map(deposit => `
    <tr>
      <td>${formatDate(deposit.paid_date)}</td>
      <td><b>${esc(deposit.tenant_name)}</b><small>${esc(deposit.tenant_id)}</small></td>
      <td>${esc(deposit.deposit_type)}</td>
      <td class="font-bold">${idr(deposit.amount)}</td>
      <td><span class="badge ${deposit.status === "active" ? "green" : "gray"}">${esc(deposit.status)}</span></td>
      <td>${esc(deposit.notes || "-")}</td>
    </tr>`).join("") : `<tr><td colspan="6">${empty("fa-vault","Belum ada deposit tercatat.")}</td></tr>`;

  const refundRows = [...(state.refunds || [])].sort((a, b) => String(b.refund_date).localeCompare(String(a.refund_date)));
  el("refund-body").innerHTML = refundRows.length ? refundRows.map(refund => {
    const actions = !canManageData() ? "-" : refund.status === "requested"
      ? `<button class="btn-secondary !py-1.5 !px-2" onclick="setRefundStatus('${refund.id}','approved')">Setujui</button><button class="btn-danger !py-1.5 !px-2" onclick="setRefundStatus('${refund.id}','rejected')">Tolak</button>`
      : refund.status === "approved"
        ? `<button class="btn-primary !py-1.5 !px-2" onclick="setRefundStatus('${refund.id}','released')">Cairkan</button>`
        : "-";
    return `<tr>
      <td>${formatDate(refund.refund_date)}</td>
      <td><b>${esc(refund.tenant_name)}</b><small>${esc(refund.tenant_id)}</small></td>
      <td class="font-bold">${idr(refund.amount)}</td>
      <td>${esc(refund.reason || "-")}</td>
      <td><span class="badge ${refund.status === "released" ? "green" : refund.status === "rejected" ? "gray" : "yellow"}">${esc(refund.status)}</span></td>
      <td class="flex gap-2">${actions}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="6">${empty("fa-arrow-rotate-left","Belum ada permintaan refund.")}</td></tr>`;
}

function getAccountingSummary() {
  const balances = buildTrialBalance();
  const cashBalance = balances.find(account => account.code === "1101")?.balance || 0;
  const receivableBalance = sum(receivables(monthNow()), r => r.outstanding);
  const revenue = sum(balances.filter(account => account.account_group === "Revenue"), account => account.balance);
  const expense = sum(balances.filter(account => account.account_group === "Expense"), account => account.balance);
  const netProfit = revenue - expense;

  return {
    cashBalance,
    receivableBalance,
    revenue,
    expense,
    netProfit
  };
}

function buildTrialBalance() {
  const accounts = state.chartOfAccounts || [];
  const accountMap = new Map(accounts.map(account => [account.code, account]));
  const balances = new Map();

  for (const account of accounts) {
    balances.set(account.code, { code: account.code, name: account.name, account_group: account.account_group, normal_balance: account.normal_balance, balance: 0 });
  }

  for (const entry of state.journalEntries || []) {
    if (entry.status !== "posted") continue;
    const lines = entry.journal_entry_lines || [];
    for (const line of lines) {
      const accountCode = line.account_code;
      const record = balances.get(accountCode);
      if (!record) continue;

      const debit = num(line.debit);
      const credit = num(line.credit);
      const account = accountMap.get(accountCode);
      const normal = (account?.normal_balance || "debit").toLowerCase();
      const delta = normal === "debit" ? debit - credit : credit - debit;
      record.balance += delta;
    }
  }

  return Array.from(balances.values()).filter(item => Math.abs(item.balance) > 0 || item.code).sort((a, b) => a.code.localeCompare(b.code));
}

function sumJournalLines(lines, key) {
  return (lines || []).reduce((sum, line) => sum + num(line?.[key]), 0);
}

function exportAccountingCsv() {
  const accounts = new Map((state.chartOfAccounts || []).map(account => [account.code, account.name]));
  const rows = [["journal_no", "entry_date", "status", "description", "account_code", "account_name", "debit", "credit"]];
  for (const entry of (state.journalEntries || []).filter(item => item.status === "posted")) {
    for (const line of entry.journal_entry_lines || []) {
      rows.push([
        entry.journal_no,
        entry.entry_date,
        entry.status,
        line.description || entry.description,
        line.account_code,
        accounts.get(line.account_code) || "",
        num(line.debit),
        num(line.credit)
      ]);
    }
  }
  if (rows.length === 1) {
    toast("Belum ada jurnal posted untuk diekspor.", "error");
    return;
  }

  const csv = "\uFEFF" + rows.map(row => row.map(value => `"${String(value ?? "").replaceAll('"', '""')}"`).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kost-wga-jurnal-${monthNow()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function receivables(month) {
  return state.tenants.filter(t=>t.status==="Aktif").map(t=>{
    const invoice=(state.invoices||[]).find(item=>item.tenant_id===t.tenant_id&&item.period_month===month);
    const billed=invoice?num(invoice.total_amount):num(t.monthly_rent);
    const paid=invoice?invoicePaidAmount(invoice):sum(state.payments.filter(p=>p.tenant_id===t.tenant_id&&p.status!=="Dibatalkan"&&String(p.payment_date).slice(0,7)===month),p=>p.amount);
    const outstanding=Math.max(billed-paid,0);
    const status=outstanding===0?"Lunas":overdue(month,t.due_date)?"Jatuh Tempo":"Belum Lunas";
    return {tenant:t,billed,paid,outstanding,status};
  });
}

function overdue(month,due) {
  const now=new Date(), cur=monthNow(); if(month<cur)return true;if(month>cur)return false;
  return now.getDate()>Math.min(Number(due),new Date(now.getFullYear(),now.getMonth()+1,0).getDate());
}

function openTenant(id=null) {
  state.editingTenantId=id; document.getElementById("tenant-form").reset(); el("tenant-edit-id").value=id||""; el("tenant-modal-title").textContent=id?"Edit Penyewa":"Tambah Penyewa";
  populateTenantRoomSelect();
  const cardView=el("tenant-id-card-view");cardView.classList.add("hidden");
  el("tenant-contract-start").value=dateInput(new Date());
  if(id){const t=tenantById(id);const room=state.rooms.find(item=>item.room_number===t.room_number&&item.properties?.code==="KOST-WGA");el("tenant-id").value=t.tenant_id;el("tenant-name").value=t.name;el("tenant-phone").value=t.phone||"";el("tenant-email").value=t.email||"";el("tenant-address").value=t.address||"";el("tenant-occupation").value=t.occupation||"";el("tenant-move-in-date").value=t.move_in_date||"";el("tenant-contract-number").value=t.contract_number||`CON-${t.tenant_id}`;el("tenant-contract-start").value=t.contract_start_date||t.move_in_date||dateInput(new Date());el("tenant-contract-end").value=t.contract_end_date||"";el("tenant-emergency-name").value=t.emergency_name||"";el("tenant-emergency-relation").value=t.emergency_relation||"";el("tenant-emergency-phone").value=t.emergency_phone||"";el("tenant-room").value=t.room_id||room?.id||"";el("tenant-rent").value=t.monthly_rent;el("tenant-due").value=t.due_date;el("tenant-status").value=t.status;cardView.classList.toggle("hidden",!t.id_card_path);}
  modal("tenant-modal");
}
window.editTenant=openTenant;

async function saveTenant(e) {
  e.preventDefault();
  const file=el("tenant-id-card").files[0], allowedTypes=["image/jpeg","image/png","application/pdf"];
  if(file&&(!allowedTypes.includes(file.type)||file.size>5*1024*1024)){toast("KTP harus berupa JPG, PNG, atau PDF maksimal 5 MB.","error");return}
  const current=state.editingTenantId?tenantById(state.editingTenantId):null;
  const room=state.rooms.find(item=>item.id===val("tenant-room"));
  if(!room){toast("Pilih kamar yang tersedia.","error");return}
  const tenantCode=val("tenant-id").trim();
  const contractStart=val("tenant-contract-start");
  const contractEnd=val("tenant-contract-end")||null;
  if(!contractStart||(contractEnd&&contractEnd<contractStart)){toast("Tanggal kontrak tidak valid.","error");return}
  const payload={tenant_id:tenantCode,name:val("tenant-name").trim(),phone:val("tenant-phone").trim()||null,email:val("tenant-email").trim()||null,address:val("tenant-address").trim()||null,occupation:val("tenant-occupation").trim()||null,move_in_date:val("tenant-move-in-date")||contractStart,contract_number:val("tenant-contract-number").trim()||`CON-${tenantCode}`,contract_start_date:contractStart,contract_end_date:contractEnd,emergency_name:val("tenant-emergency-name").trim()||null,emergency_relation:val("tenant-emergency-relation").trim()||null,emergency_phone:val("tenant-emergency-phone").trim()||null,id_card_path:current?.id_card_path||null,room_id:room.id,room_number:room.room_number,monthly_rent:num(val("tenant-rent")),due_date:Number(val("tenant-due")),status:val("tenant-status")};
  const saveButton=el("tenant-save-btn");saveButton.disabled=true;
  let uploadedPath=null;
  try {
    if(file){uploadedPath=await api.uploadTenantIdCard(payload.tenant_id,file);payload.id_card_path=uploadedPath;}
    if(state.editingTenantId)await api.updateTenant(state.editingTenantId,payload); else await api.createTenant(payload);
    if(uploadedPath&&current?.id_card_path)try{await api.removeTenantIdCard(current.id_card_path)}catch(err){console.warn("KTP lama tidak dapat dihapus:",err)}
    closeModal("tenant-modal");toast("Data penyewa tersimpan.");await loadData();
  }catch(e){if(uploadedPath)try{await api.removeTenantIdCard(uploadedPath)}catch(cleanupError){console.warn("Berkas KTP sementara tidak dapat dihapus:",cleanupError)}toast(e.message,"error")}
  finally{saveButton.disabled=false}
}

async function openTenantIdCard() {
  const tenant=state.editingTenantId&&tenantById(state.editingTenantId);
  if(!tenant?.id_card_path)return;
  const tab=window.open("about:blank","_blank");
  if(!tab){toast("Izinkan pop-up untuk membuka berkas KTP.","error");return}
  try{tab.location.href=await api.getTenantIdCardUrl(tenant.id_card_path)}catch(e){tab.close();toast(e.message,"error")}
}

function openPayment(tenantCode=null) {
  document.getElementById("payment-form").reset();populatePaymentInvoiceSelect();el("payment-date").value=dateInput(new Date());
  updatePaymentMethodFields();
  const firstInvoice=(state.invoices||[]).find(invoice=>invoice.status!=="cancelled"&&num(invoice.total_amount)-invoiceReservedAmount(invoice)>0&&(!tenantCode||invoice.tenant_id===tenantCode));
  if(!firstInvoice){toast("Belum ada invoice dengan saldo. Terbitkan invoice terlebih dahulu.","error");return}
  el("payment-invoice").value=firstInvoice.id;updatePaymentHint();modal("payment-modal");
}
window.openPayment=openPayment;

function updatePaymentMethodFields() {
  const isTransfer=val("payment-method")==="Transfer";
  el("payment-transfer-fields").classList.toggle("hidden",!isTransfer);
  el("payment-reference").required=isTransfer;
  el("payment-evidence").required=isTransfer;
  if(!isTransfer){el("payment-reference").value="";el("payment-evidence").value=""}
}

function openInvoicePayment(invoiceId) {
  openPayment();
  if(!el("payment-modal").classList.contains("hidden")){
    el("payment-invoice").value=invoiceId;
    updatePaymentHint();
  }
}
window.openInvoicePayment=openInvoicePayment;

function populatePaymentInvoiceSelect() {
  const available=(state.invoices||[]).filter(invoice=>invoice.status!=="cancelled"&&num(invoice.total_amount)-invoiceReservedAmount(invoice)>0);
  el("payment-invoice").innerHTML='<option value="">Pilih invoice...</option>'+available.map(invoice=>{
    const tenant=tenantByCode(invoice.tenant_id);
    const outstanding=num(invoice.total_amount)-invoiceReservedAmount(invoice);
    return `<option value="${escAttr(invoice.id)}">${esc(invoice.invoice_no)} — ${esc(tenant?.name||invoice.tenant_id)} — Sisa ${idr(outstanding)}</option>`;
  }).join("");
}

async function issueMonthlyInvoices() {
  const button=el("issue-invoices-btn");
  button.disabled=true;
  try {
    const created=await api.issueMonthlyRentInvoices(state.receivableMonth);
    toast(created?`${created} invoice baru diterbitkan.`:"Invoice periode ini sudah pernah diterbitkan.");
    await loadData();
  } catch(error){toast(error.message,"error")}
  finally{button.disabled=false}
}

function invoicePaidAmount(invoice) {
  return sum(invoice.payment_allocations||[],allocation=>{
    const payment=allocation.payments;
    return payment?.status!=="Dibatalkan"&&(payment?.verification_status||"confirmed")==="confirmed"?allocation.amount:0;
  });
}

function invoiceReservedAmount(invoice) {
  return sum(invoice.payment_allocations||[],allocation=>allocation.payments?.status==="Dibatalkan"?0:allocation.amount);
}

function invoiceStatus(invoice,outstanding) {
  if(invoice.status==="cancelled")return "cancelled";
  if(outstanding<=0)return "paid";
  if(String(invoice.due_date)<dateInput(new Date()))return "overdue";
  if(invoicePaidAmount(invoice)>0)return "partially_paid";
  if(invoicePendingAmount(invoice)>0)return "pending_verification";
  return invoice.status||"issued";
}

function invoicePendingAmount(invoice) {
  return sum(invoice.payment_allocations||[],allocation=>allocation.payments?.status!=="Dibatalkan"&&allocation.payments?.verification_status==="pending"?allocation.amount:0);
}
function populateDepositTenantSelect() {
  el("deposit-tenant").innerHTML='<option value="">Pilih penyewa...</option>'+state.tenants.map(t=>`<option value="${escAttr(t.tenant_id)}">${esc(t.tenant_id)} — ${esc(t.name)}</option>`).join("");
}
function populateRefundDepositSelect() {
  el("refund-deposit").innerHTML='<option value="">Pilih deposit aktif...</option>'+(state.deposits || []).filter(deposit=>deposit.status==="active").map(deposit=>`<option value="${escAttr(deposit.id)}">${esc(deposit.tenant_name)} — ${idr(deposit.amount)} (${formatDate(deposit.paid_date)})</option>`).join("");
  updateRefundHint();
}
function updateRefundHint() {
  const deposit=(state.deposits || []).find(item=>item.id===val("refund-deposit"));
  if(!deposit){el("refund-hint").textContent="Pilih deposit aktif yang akan dikembalikan.";return}
  const alreadyRefunded=sum((state.refunds || []).filter(refund=>refund.deposit_id===deposit.id&&refund.status==="released"),refund=>refund.amount);
  const remaining=Math.max(num(deposit.amount)-alreadyRefunded,0);
  el("refund-amount").max=String(remaining);
  el("refund-hint").textContent=`Maksimal yang dapat dicairkan: ${idr(remaining)}.`;
}
async function saveDeposit(event) {
  event.preventDefault();
  const tenant=tenantByCode(val("deposit-tenant"));
  const amount=num(val("deposit-amount"));
  if(!tenant||amount<=0){toast("Pilih penyewa dan isi nominal deposit lebih dari 0.","error");return}
  try {
    await api.createDeposit({tenant_id:tenant.tenant_id,tenant_name:tenant.name,amount,deposit_type:val("deposit-type"),paid_date:val("deposit-date"),notes:val("deposit-notes").trim()||null});
    el("deposit-form").reset();el("deposit-date").value=dateInput(new Date());
    toast("Deposit berhasil dicatat.");await loadData();
  } catch(error){toast(error.message,"error")}
}
async function saveRefund(event) {
  event.preventDefault();
  const deposit=(state.deposits || []).find(item=>item.id===val("refund-deposit"));
  const amount=num(val("refund-amount"));
  if(!deposit||amount<=0){toast("Pilih deposit dan isi nominal refund lebih dari 0.","error");return}
  const alreadyRefunded=sum((state.refunds || []).filter(refund=>refund.deposit_id===deposit.id&&refund.status==="released"),refund=>refund.amount);
  if(amount>num(deposit.amount)-alreadyRefunded){toast("Nominal refund melebihi sisa deposit.","error");return}
  try {
    await api.createRefund({deposit_id:deposit.id,tenant_id:deposit.tenant_id,tenant_name:deposit.tenant_name,amount,refund_date:val("refund-date"),reason:val("refund-reason").trim()||null,status:"requested"});
    el("refund-form").reset();el("refund-date").value=dateInput(new Date());populateRefundDepositSelect();
    toast("Permintaan refund dicatat dan menunggu persetujuan.");await loadData();
  } catch(error){toast(error.message,"error")}
}
async function setRefundStatus(id,status) {
  try {
    await api.updateRefund(id,{status});
    toast(status==="released"?"Refund dicairkan dan jurnal kas dibuat.":`Permintaan refund ${status==="approved"?"disetujui":"ditolak"}.`);
    await loadData();
  } catch(error){toast(error.message,"error")}
}
window.setRefundStatus=setRefundStatus;
function updatePaymentHint() {
  const invoice=(state.invoices||[]).find(item=>item.id===val("payment-invoice"));
  if(!invoice){el("payment-hint").textContent="Pilih invoice yang akan dibayar.";return}
  const outstanding=Math.max(num(invoice.total_amount)-invoiceReservedAmount(invoice),0);
  el("payment-amount").max=String(outstanding);
  if(!el("payment-amount").value||num(el("payment-amount").value)>outstanding)el("payment-amount").value=String(outstanding);
  el("payment-hint").textContent=`Saldo tersedia ${invoice.invoice_no}: ${idr(outstanding)}. Transfer baru mengurangi piutang setelah diverifikasi.`;
}
async function savePayment(e) {
  e.preventDefault();
  const invoice=(state.invoices||[]).find(item=>item.id===val("payment-invoice"));
  const amount=num(val("payment-amount"));
  const paymentMethod=val("payment-method");
  const transactionReference=val("payment-reference").trim();
  const evidenceFile=el("payment-evidence").files[0];
  if(!invoice){toast("Pilih invoice.","error");return}
  const outstanding=Math.max(num(invoice.total_amount)-invoiceReservedAmount(invoice),0);
  if(amount<=0||amount>outstanding){toast(`Nominal harus lebih dari 0 dan tidak boleh melebihi sisa ${idr(outstanding)}.`,"error");return}
  if(paymentMethod==="Transfer"&&(!transactionReference||!evidenceFile)){toast("Transfer memerlukan nomor referensi dan bukti transfer.","error");return}
  let evidencePath=null;
  try {
    if(paymentMethod==="Transfer")evidencePath=await api.uploadPaymentEvidence(evidenceFile);
    try {
      await api.recordInvoicePayment({invoiceId:invoice.id,amount,paymentDate:val("payment-date"),paymentMethod,notes:val("payment-notes").trim()||null,transactionReference,evidencePath});
    } catch(error) {
      if(evidencePath)await api.removePaymentEvidence(evidencePath).catch(cleanupError=>console.warn("Bukti transfer sementara tidak dapat dibersihkan:",cleanupError));
      throw error;
    }
    closeModal("payment-modal");
    toast(paymentMethod==="Transfer"?"Transfer dicatat dan menunggu verifikasi; belum dihitung sebagai kas.":"Pembayaran tunai tercatat dan terkonfirmasi.");
    await loadData();
  } catch(e){toast(e.message,"error")}
}

async function viewPaymentEvidence(paymentId) {
  const payment=state.payments.find(item=>item.id===paymentId);
  if(!payment?.evidence_path){toast("Bukti transfer tidak tersedia.","error");return}
  const tab=window.open("about:blank","_blank");
  if(!tab){toast("Izinkan pop-up untuk membuka bukti transfer.","error");return}
  try{tab.location.href=await api.getPaymentEvidenceUrl(payment.evidence_path)}
  catch(error){tab.close();toast(error.message,"error")}
}
window.viewPaymentEvidence=viewPaymentEvidence;

function openPaymentEvidenceForm(paymentId) {
  el("payment-evidence-form").reset();
  el("payment-evidence-id").value=paymentId;
  modal("payment-evidence-modal");
}
window.openPaymentEvidenceForm=openPaymentEvidenceForm;

async function savePendingPaymentEvidence(event) {
  event.preventDefault();
  const paymentId=val("payment-evidence-id");
  const reference=val("payment-evidence-reference").trim();
  const file=el("payment-evidence-file").files[0];
  if(!reference||!file){toast("Nomor referensi dan berkas bukti wajib diisi.","error");return}
  let evidencePath=null;
  try {
    evidencePath=await api.uploadPaymentEvidence(file);
    try {
      await api.attachPendingPaymentEvidence(paymentId,reference,evidencePath);
    } catch(error) {
      await api.removePaymentEvidence(evidencePath).catch(cleanupError=>console.warn("Bukti transfer sementara tidak dapat dibersihkan:",cleanupError));
      throw error;
    }
    closeModal("payment-evidence-modal");
    toast("Referensi dan bukti transfer tersimpan; status tetap menunggu verifikasi.");
    await loadData();
  } catch(error){toast(error.message,"error")}
}

async function verifyPayment(paymentId) {
  try {
    await api.verifyInvoicePayment(paymentId);
    toast("Transfer dikonfirmasi; jurnal kas dan pelunasan piutang telah diposting.");
    await loadData();
  } catch(error){toast(error.message,"error")}
}
window.verifyPayment=verifyPayment;

function openRejectPayment(paymentId) {
  el("payment-reject-form").reset();
  el("payment-reject-id").value=paymentId;
  modal("payment-reject-modal");
}
window.openRejectPayment=openRejectPayment;

async function rejectPayment(event) {
  event.preventDefault();
  const paymentId=val("payment-reject-id");
  const reason=val("payment-reject-reason").trim();
  if(!reason){toast("Alasan penolakan wajib diisi.","error");return}
  try {
    await api.rejectInvoicePayment(paymentId,reason);
    closeModal("payment-reject-modal");
    toast("Transfer ditolak; alokasi dilepas dan tercatat pada audit.");
    await loadData();
  } catch(error){toast(error.message,"error")}
}

function openMaintenance(id=null) {
  state.editingMaintenanceId=id;document.getElementById("maintenance-form").reset();el("maintenance-edit-id").value=id||"";el("maintenance-modal-title").textContent=id?"Edit Maintenance":"Buat Tiket Maintenance";el("maintenance-date").value=dateInput(new Date());el("maintenance-payment-date").value=dateInput(new Date());
  if(id){const m=state.maintenance.find(x=>x.id===id);el("maintenance-room").value=m.room_number||"";el("maintenance-date").value=m.expense_date;el("maintenance-title").value=m.title;el("maintenance-description").value=m.description||"";el("maintenance-cost").value=m.cost;el("maintenance-vendor").value=m.vendor_name||"";el("maintenance-status").value=m.status;el("maintenance-payment-status").value=m.payment_status||"unpaid";el("maintenance-payment-date").value=m.payment_date||dateInput(new Date());}
  modal("maintenance-modal");
}
window.editMaintenance=openMaintenance;

async function saveMaintenance(e) {
  e.preventDefault();
  const payload={room_number:val("maintenance-room").trim()||null,title:val("maintenance-title").trim(),description:val("maintenance-description").trim()||null,expense_date:val("maintenance-date"),cost:num(val("maintenance-cost")),vendor_name:val("maintenance-vendor").trim()||null,status:val("maintenance-status"),payment_status:val("maintenance-payment-status")};
  payload.payment_date=payload.payment_status==="paid"?val("maintenance-payment-date"):null;
  if(payload.payment_status==="paid"&&!payload.payment_date){toast("Tanggal pembayaran vendor wajib diisi.","error");return}
  if(!payload.title){toast("Judul perbaikan wajib diisi.","error");return}
  try{if(state.editingMaintenanceId)await api.updateMaintenance(state.editingMaintenanceId,payload);else await api.createMaintenance(payload);closeModal("maintenance-modal");toast("Tiket maintenance tersimpan.");await loadData()}catch(e){toast(e.message,"error")}
}

function deleteTenantAsk(id){confirmAsk("Hapus penyewa?","Data penyewa akan dihapus. Pembayaran terkait dapat terhalang foreign key jika masih ada.",async()=>{const tenant=tenantById(id);try{await api.deleteTenant(id);if(tenant?.id_card_path)try{await api.removeTenantIdCard(tenant.id_card_path)}catch(storageError){console.warn("Berkas KTP tidak dapat dihapus:",storageError)}toast("Penyewa dihapus.");await loadData()}catch(e){toast(e.message,"error")}})}
function cancelPaymentAsk(id){confirmAsk("Batalkan pembayaran?","Jurnal pembalik akan dibuat dan transaksi tetap tersimpan untuk audit.",async()=>{try{await api.updatePayment(id,{status:"Dibatalkan"});toast("Pembayaran dibatalkan dan jurnal pembalik dibuat.");await loadData()}catch(e){toast(e.message,"error")}})}
function deletePaymentAsk(id){confirmAsk("Hapus pembayaran?","Hanya pembayaran yang belum terjurnal yang dapat dihapus.",async()=>{try{await api.deletePayment(id);toast("Pembayaran dihapus.");await loadData()}catch(e){toast(e.message,"error")}})}
function deleteMaintenanceAsk(id){confirmAsk("Hapus tiket maintenance?","Catatan pengeluaran ini akan dihapus.",async()=>{try{await api.deleteMaintenance(id);toast("Maintenance dihapus.");await loadData()}catch(e){toast(e.message,"error")}})}

function confirmAsk(title,msg,cb){el("confirm-title").textContent=title;el("confirm-message").textContent=msg;el("confirm-modal").classList.remove("hidden");el("confirm-ok").onclick=async()=>{closeConfirm();await cb()}}
function closeConfirm(){el("confirm-modal").classList.add("hidden")}
function modal(id){el(id).classList.remove("hidden")}function closeModal(id){el(id).classList.add("hidden")}
function openMobile(){el("sidebar").classList.add("mobile-open");el("sidebar-overlay").classList.remove("hidden")}function closeMobile(){el("sidebar").classList.remove("mobile-open");el("sidebar-overlay").classList.add("hidden")}

function tenantById(id){return state.tenants.find(t=>t.id===id)}
function tenantByCode(code){return state.tenants.find(t=>t.tenant_id===code)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function sum(arr,fn){return arr.reduce((s,x)=>s+num(fn(x)),0)}
function canManageData(){return ["admin","pengelola"].includes(state.profile?.role)}
function idr(v){return new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR",maximumFractionDigits:0}).format(num(v))}
function monthNow(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`}
function monthLabel(m){return new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(new Date(`${m}-01T00:00:00`))}
function dateInput(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function formatDate(s){if(!s)return"-";return new Intl.DateTimeFormat("id-ID",{day:"2-digit",month:"short",year:"numeric"}).format(new Date(`${s}T00:00:00`))}
function formatDue(m,day){const [y,mo]=m.split("-").map(Number),d=Math.min(Number(day),new Date(y,mo,0).getDate());return formatDate(`${y}-${String(mo).padStart(2,"0")}-${String(d).padStart(2,"0")}`)}
function val(id){return document.getElementById(id).value}
function el(id){return document.getElementById(id)}
function labelRole(r){return({admin:"Admin",pengelola:"Pengelola",pemilik:"Pemilik"}[r]||r)}
function esc(v){return String(v??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function escAttr(v){return esc(v)}
function empty(icon,text){return`<div class="empty"><i class="fa-solid ${icon}"></i><p class="text-sm">${esc(text)}</p></div>`}
function payBadge(s){return s==="Lunas"?'<span class="badge green">Lunas</span>':s==="Jatuh Tempo"?'<span class="badge red">Jatuh Tempo</span>':'<span class="badge yellow">Belum Lunas</span>'}
function maintBadge(s){return s==="completed"?'<span class="badge green">Completed</span>':s==="in_progress"?'<span class="badge blue">In Progress</span>':'<span class="badge yellow">Scheduled</span>'}
function toast(msg,type="success"){const t=document.createElement("div");t.className=`toast ${type}`;t.innerHTML=`<div class="flex gap-3"><i class="fa-solid ${type==="success"?"fa-circle-check text-emerald-600":"fa-circle-exclamation text-rose-600"} mt-1"></i><p class="text-sm">${esc(msg)}</p></div>`;el("toast-container").appendChild(t);setTimeout(()=>t.remove(),3500)}
