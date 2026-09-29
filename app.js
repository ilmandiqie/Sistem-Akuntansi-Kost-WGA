"use strict";

const state = {
  user: null,
  profile: null,
  page: "dashboard",
  tenants: [],
  payments: [],
  maintenance: [],
  tenantSearch: "",
  paymentSearch: "",
  maintenanceSearch: "",
  receivableMonth: monthNow(),
  editingTenantId: null,
  editingMaintenanceId: null
};

const meta = {
  dashboard: ["Overview", "Dashboard"],
  tenants: ["Master Data", "Penyewa & Kamar"],
  receivables: ["Receivables", "Kontrol Piutang"],
  payments: ["Cash Receipt", "Penerimaan Kas"],
  maintenance: ["Operational", "Maintenance & Pengeluaran"]
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindUI();
  document.getElementById("rec-month").value = state.receivableMonth;
  document.getElementById("period-label").textContent = monthLabel(state.receivableMonth);
  document.getElementById("payment-date").value = dateInput(new Date());
  document.getElementById("maintenance-date").value = dateInput(new Date());

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
  document.getElementById("tenant-form").onsubmit = saveTenant;
  document.getElementById("tenant-id-card-view").onclick = openTenantIdCard;
  document.getElementById("tenant-search").oninput = e => { state.tenantSearch=e.target.value.toLowerCase(); renderTenants(); };

  document.getElementById("rec-month").onchange = e => {
    state.receivableMonth = e.target.value || monthNow();
    document.getElementById("period-label").textContent = monthLabel(state.receivableMonth);
    renderReceivables(); renderDashboard();
  };

  document.getElementById("add-payment-btn").onclick = () => openPayment();
  document.getElementById("payment-form").onsubmit = savePayment;
  document.getElementById("payment-search").oninput = e => { state.paymentSearch=e.target.value.toLowerCase(); renderPayments(); };
  document.getElementById("payment-tenant").onchange = updatePaymentHint;

  document.getElementById("add-maintenance-btn").onclick = () => openMaintenance();
  document.getElementById("maintenance-form").onsubmit = saveMaintenance;
  document.getElementById("maintenance-search").oninput = e => { state.maintenanceSearch=e.target.value.toLowerCase(); renderMaintenance(); };

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
  const fullName = val("register-name"), email = val("register-email"), password = val("register-password"), role = val("register-role");
  try {
    const result = await api.register({ email, password, fullName, role });
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
    state.profile = { full_name: user.user_metadata?.full_name || user.email, role: user.user_metadata?.role || "pengelola" };
  }
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("sidebar-user-name").textContent = state.profile.full_name || user.email;
  document.getElementById("sidebar-user-role").textContent = `${labelRole(state.profile.role)} · ${user.email}`;
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
  if(state.page==="tenants")renderTenants();
  if(state.page==="receivables")renderReceivables();
  if(state.page==="payments")renderPayments();
  if(state.page==="maintenance")renderMaintenance();
}
function renderAll(){renderDashboard();renderTenants();renderReceivables();renderPayments();renderMaintenance();populateTenantSelect();}

function renderDashboard() {
  const cash=sum(state.payments,p=>p.amount), rec=receivables(state.receivableMonth), outstanding=sum(rec,r=>r.outstanding);
  const active=state.tenants.filter(t=>t.status==="Aktif");
  const thisMonth=monthNow();
  const maintCost=sum(state.maintenance.filter(m=>String(m.expense_date).slice(0,7)===thisMonth),m=>m.cost);
  el("stat-cash").textContent=idr(cash); el("stat-receivable").textContent=idr(outstanding); el("stat-maintenance").textContent=idr(maintCost); el("stat-occupied").textContent=active.length;
  el("dash-paid-count").textContent=rec.filter(r=>r.status==="Lunas").length;
  el("dash-unpaid-count").textContent=rec.filter(r=>r.status==="Belum Lunas").length;
  el("dash-overdue-count").textContent=rec.filter(r=>r.status==="Jatuh Tempo").length;

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

function renderTenants() {
  const q=state.tenantSearch, rows=state.tenants.filter(t=>[t.tenant_id,t.name,t.room_number,t.status,t.phone,t.email,t.emergency_phone].some(x=>String(x||"").toLowerCase().includes(q)));
  el("tenant-body").innerHTML=rows.length?rows.map(t=>`<tr>
    <td class="font-bold text-wga-700">${esc(t.tenant_id)}</td><td class="font-semibold">${esc(t.name)}</td><td>${esc(t.room_number)}</td><td class="font-bold">${idr(t.monthly_rent)}</td><td>Tanggal ${t.due_date}</td>
    <td>${t.status==="Aktif"?'<span class="badge green">Aktif</span>':'<span class="badge gray">Keluar</span>'}</td>
    <td><button class="text-slate-500 p-2" onclick="editTenant('${t.id}')"><i class="fa-solid fa-pen"></i></button><button class="text-rose-500 p-2" onclick="deleteTenantAsk('${t.id}')"><i class="fa-solid fa-trash"></i></button></td>
  </tr>`).join(""):`<tr><td colspan="7">${empty("fa-users-slash","Belum ada penyewa.")}</td></tr>`;
}

function renderReceivables() {
  const rows=receivables(state.receivableMonth);
  el("rec-billed").textContent=idr(sum(rows,r=>r.billed));el("rec-paid").textContent=idr(sum(rows,r=>r.paid));el("rec-outstanding").textContent=idr(sum(rows,r=>r.outstanding));
  el("rec-body").innerHTML=rows.length?rows.map(r=>`<tr>
    <td><b>${esc(r.tenant.name)}</b><small>${esc(r.tenant.tenant_id)}</small></td><td>${esc(r.tenant.room_number)}</td><td>${formatDue(state.receivableMonth,r.tenant.due_date)}</td>
    <td>${idr(r.billed)}</td><td class="text-emerald-700 font-bold">${idr(r.paid)}</td><td class="text-rose-700 font-bold">${idr(r.outstanding)}</td><td>${payBadge(r.status)}</td>
    <td>${r.outstanding>0?`<button class="btn-primary !py-2 !px-3 !text-[11px]" onclick="openPayment('${r.tenant.tenant_id}')">Bayar</button>`:'<span class="text-xs text-slate-400">Selesai</span>'}</td>
  </tr>`).join(""):`<tr><td colspan="8">${empty("fa-file-circle-xmark","Tidak ada tagihan.")}</td></tr>`;
}

function renderPayments() {
  const q=state.paymentSearch;
  const rows=[...state.payments].sort((a,b)=>String(b.payment_date).localeCompare(String(a.payment_date))).filter(p=>{
    const t=tenantByCode(p.tenant_id); return [p.payment_id,p.tenant_name,p.room_number,p.payment_method,p.notes].some(x=>String(x||"").toLowerCase().includes(q))||String(t?.name||"").toLowerCase().includes(q);
  });
  el("payment-total").textContent="Total: "+idr(sum(state.payments,p=>p.amount));
  el("payment-body").innerHTML=rows.length?rows.map(p=>`<tr>
    <td class="font-bold text-wga-700">${esc(p.payment_id)}</td><td>${formatDate(p.payment_date)}</td><td><b>${esc(p.tenant_name)}</b><small>${esc(p.room_number)}</small></td>
    <td><span class="badge ${p.payment_method==="Cash"?"gray":"green"}">${esc(p.payment_method)}</span></td><td class="font-bold text-emerald-700">${idr(p.amount)}</td>
    <td>${p.status==="Lunas"?'<span class="badge green">Lunas</span>':p.status==="Belum Lunas"?'<span class="badge yellow">Belum Lunas</span>':'<span class="badge red">Dibatalkan</span>'}</td>
    <td>${p.status==="Lunas"?`<button class="text-wga-700 p-2" title="Cetak invoice" aria-label="Cetak invoice" onclick="printInvoice('${p.id}')"><i class="fa-solid fa-print"></i></button>`:""}<button class="text-rose-500 p-2" title="Hapus pembayaran" aria-label="Hapus pembayaran" onclick="deletePaymentAsk('${p.id}')"><i class="fa-solid fa-trash"></i></button></td>
  </tr>`).join(""):`<tr><td colspan="7">${empty("fa-receipt","Belum ada pembayaran.")}</td></tr>`;
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

function renderMaintenance() {
  const month=monthNow(), rows=state.maintenance.filter(m=>[m.room_number,m.title,m.description,m.vendor_name,m.status].some(x=>String(x||"").toLowerCase().includes(state.maintenanceSearch)));
  el("maint-cost").textContent=idr(sum(state.maintenance.filter(m=>String(m.expense_date).slice(0,7)===month),m=>m.cost));
  el("maint-scheduled").textContent=state.maintenance.filter(m=>m.status==="scheduled").length;
  el("maint-active-rooms").textContent=new Set(state.maintenance.filter(m=>m.status==="in_progress"&&m.room_number).map(m=>m.room_number)).size;
  el("maint-total").textContent=idr(sum(state.maintenance,m=>m.cost));
  el("maintenance-body").innerHTML=rows.length?rows.map(m=>`<tr>
    <td>${formatDate(m.expense_date)}</td><td>${esc(m.room_number||"Area Umum")}</td><td><b>${esc(m.title)}</b><small>${esc(m.description||"")}</small></td><td>${esc(m.vendor_name||"-")}</td><td class="font-bold">${idr(m.cost)}</td><td>${maintBadge(m.status)}</td>
    <td><button class="text-slate-500 p-2" onclick="editMaintenance('${m.id}')"><i class="fa-solid fa-pen"></i></button><button class="text-rose-500 p-2" onclick="deleteMaintenanceAsk('${m.id}')"><i class="fa-solid fa-trash"></i></button></td>
  </tr>`).join(""):`<tr><td colspan="7">${empty("fa-screwdriver-wrench","Belum ada riwayat maintenance.")}</td></tr>`;
}

function receivables(month) {
  return state.tenants.filter(t=>t.status==="Aktif").map(t=>{
    const billed=num(t.monthly_rent), paid=sum(state.payments.filter(p=>p.tenant_id===t.tenant_id&&p.status!=="Dibatalkan"&&String(p.payment_date).slice(0,7)===month),p=>p.amount), outstanding=Math.max(billed-paid,0);
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
  const cardView=el("tenant-id-card-view");cardView.classList.add("hidden");
  if(id){const t=tenantById(id);el("tenant-id").value=t.tenant_id;el("tenant-name").value=t.name;el("tenant-phone").value=t.phone||"";el("tenant-email").value=t.email||"";el("tenant-address").value=t.address||"";el("tenant-occupation").value=t.occupation||"";el("tenant-move-in-date").value=t.move_in_date||"";el("tenant-emergency-name").value=t.emergency_name||"";el("tenant-emergency-relation").value=t.emergency_relation||"";el("tenant-emergency-phone").value=t.emergency_phone||"";el("tenant-room").value=t.room_number;el("tenant-rent").value=t.monthly_rent;el("tenant-due").value=t.due_date;el("tenant-status").value=t.status;cardView.classList.toggle("hidden",!t.id_card_path);}
  modal("tenant-modal");
}
window.editTenant=openTenant;

async function saveTenant(e) {
  e.preventDefault();
  const file=el("tenant-id-card").files[0], allowedTypes=["image/jpeg","image/png","application/pdf"];
  if(file&&(!allowedTypes.includes(file.type)||file.size>5*1024*1024)){toast("KTP harus berupa JPG, PNG, atau PDF maksimal 5 MB.","error");return}
  const current=state.editingTenantId?tenantById(state.editingTenantId):null;
  const payload={tenant_id:val("tenant-id").trim(),name:val("tenant-name").trim(),phone:val("tenant-phone").trim()||null,email:val("tenant-email").trim()||null,address:val("tenant-address").trim()||null,occupation:val("tenant-occupation").trim()||null,move_in_date:val("tenant-move-in-date")||null,emergency_name:val("tenant-emergency-name").trim()||null,emergency_relation:val("tenant-emergency-relation").trim()||null,emergency_phone:val("tenant-emergency-phone").trim()||null,id_card_path:current?.id_card_path||null,room_number:val("tenant-room").trim(),monthly_rent:num(val("tenant-rent")),due_date:Number(val("tenant-due")),status:val("tenant-status")};
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
  document.getElementById("payment-form").reset();populateTenantSelect();el("payment-date").value=dateInput(new Date());
  if(tenantCode)el("payment-tenant").value=tenantCode;updatePaymentHint();modal("payment-modal");
}
window.openPayment=openPayment;

function populateTenantSelect() {
  el("payment-tenant").innerHTML='<option value="">Pilih penyewa...</option>'+state.tenants.filter(t=>t.status==="Aktif").map(t=>`<option value="${escAttr(t.tenant_id)}">${esc(t.tenant_id)} — ${esc(t.name)} (${esc(t.room_number)})</option>`).join("");
}
function updatePaymentHint() {
  const code=val("payment-tenant"),t=tenantByCode(code);if(!t){el("payment-hint").textContent="";return}
  const r=receivables(state.receivableMonth).find(x=>x.tenant.tenant_id===code);
  el("payment-hint").textContent=r?`Piutang ${monthLabel(state.receivableMonth)}: ${idr(r.outstanding)}`:"";
}
async function savePayment(e) {
  e.preventDefault();const t=tenantByCode(val("payment-tenant"));if(!t){toast("Pilih penyewa.","error");return}
  const payload={payment_id:"PAY-"+Date.now(),tenant_id:t.tenant_id,tenant_name:t.name,room_number:t.room_number,amount:num(val("payment-amount")),payment_date:val("payment-date"),payment_method:val("payment-method"),status:val("payment-status"),notes:val("payment-notes").trim()||null};
  if(payload.amount<=0){toast("Nominal harus lebih dari 0.","error");return}
  try{await api.createPayment(payload);closeModal("payment-modal");toast("Penerimaan kas berhasil dicatat.");await loadData()}catch(e){toast(e.message,"error")}
}

function openMaintenance(id=null) {
  state.editingMaintenanceId=id;document.getElementById("maintenance-form").reset();el("maintenance-edit-id").value=id||"";el("maintenance-modal-title").textContent=id?"Edit Maintenance":"Buat Tiket Maintenance";el("maintenance-date").value=dateInput(new Date());
  if(id){const m=state.maintenance.find(x=>x.id===id);el("maintenance-room").value=m.room_number||"";el("maintenance-date").value=m.expense_date;el("maintenance-title").value=m.title;el("maintenance-description").value=m.description||"";el("maintenance-cost").value=m.cost;el("maintenance-vendor").value=m.vendor_name||"";el("maintenance-status").value=m.status;}
  modal("maintenance-modal");
}
window.editMaintenance=openMaintenance;

async function saveMaintenance(e) {
  e.preventDefault();
  const payload={room_number:val("maintenance-room").trim()||null,title:val("maintenance-title").trim(),description:val("maintenance-description").trim()||null,expense_date:val("maintenance-date"),cost:num(val("maintenance-cost")),vendor_name:val("maintenance-vendor").trim()||null,status:val("maintenance-status")};
  if(!payload.title){toast("Judul perbaikan wajib diisi.","error");return}
  try{if(state.editingMaintenanceId)await api.updateMaintenance(state.editingMaintenanceId,payload);else await api.createMaintenance(payload);closeModal("maintenance-modal");toast("Tiket maintenance tersimpan.");await loadData()}catch(e){toast(e.message,"error")}
}

function deleteTenantAsk(id){confirmAsk("Hapus penyewa?","Data penyewa akan dihapus. Pembayaran terkait dapat terhalang foreign key jika masih ada.",async()=>{const tenant=tenantById(id);try{await api.deleteTenant(id);if(tenant?.id_card_path)try{await api.removeTenantIdCard(tenant.id_card_path)}catch(storageError){console.warn("Berkas KTP tidak dapat dihapus:",storageError)}toast("Penyewa dihapus.");await loadData()}catch(e){toast(e.message,"error")}})}
function deletePaymentAsk(id){confirmAsk("Hapus pembayaran?","Kas masuk akan berkurang dan piutang terkait akan kembali.",async()=>{try{await api.deletePayment(id);toast("Pembayaran dihapus.");await loadData()}catch(e){toast(e.message,"error")}})}
function deleteMaintenanceAsk(id){confirmAsk("Hapus tiket maintenance?","Catatan pengeluaran ini akan dihapus.",async()=>{try{await api.deleteMaintenance(id);toast("Maintenance dihapus.");await loadData()}catch(e){toast(e.message,"error")}})}

function confirmAsk(title,msg,cb){el("confirm-title").textContent=title;el("confirm-message").textContent=msg;el("confirm-modal").classList.remove("hidden");el("confirm-ok").onclick=async()=>{closeConfirm();await cb()}}
function closeConfirm(){el("confirm-modal").classList.add("hidden")}
function modal(id){el(id).classList.remove("hidden")}function closeModal(id){el(id).classList.add("hidden")}
function openMobile(){el("sidebar").classList.add("mobile-open");el("sidebar-overlay").classList.remove("hidden")}function closeMobile(){el("sidebar").classList.remove("mobile-open");el("sidebar-overlay").classList.add("hidden")}

function tenantById(id){return state.tenants.find(t=>t.id===id)}
function tenantByCode(code){return state.tenants.find(t=>t.tenant_id===code)}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function sum(arr,fn){return arr.reduce((s,x)=>s+num(fn(x)),0)}
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
