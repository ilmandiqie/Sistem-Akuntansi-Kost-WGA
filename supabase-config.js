/*
  KOST WGA V2 — Supabase Client & API Layer

  Isi konfigurasi Supabase melalui window.KOST_WGA_CONFIG bila ingin override.
  Untuk produksi, tetap gunakan anon key pada project yang aman dan hindari
  service_role key di frontend.
*/

const KOST_WGA_CONFIG = window.KOST_WGA_CONFIG || {
  SUPABASE_URL: "https://pxscjusggxwuyljyjedz.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4c2NqdXNnZ3h3dXlsanlqZWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NzkwMzQsImV4cCI6MjEwNjE1NTAzNH0.dikC8uSMRIj96eMHYQmeM6r4Cf0stSDAtP0ANHtzXq0"
};

const SUPABASE_URL = KOST_WGA_CONFIG.SUPABASE_URL || "";
const SUPABASE_ANON_KEY = KOST_WGA_CONFIG.SUPABASE_ANON_KEY || "";
const isSupabaseReady = Boolean(window.supabase && SUPABASE_URL && SUPABASE_ANON_KEY);

if (!isSupabaseReady) {
  console.warn("Kost WGA: Supabase belum dikonfigurasi dengan benar. Pastikan @supabase/supabase-js sudah dimuat dan URL/key valid.");
}

const supabaseClient = isSupabaseReady ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const api = {
  isReady() {
    return Boolean(supabaseClient);
  },

  ensureReady() {
    if (!supabaseClient) {
      throw new Error("Konfigurasi Supabase belum siap. Periksa URL dan anon key, lalu muat ulang aplikasi.");
    }
  },

  // ---------------- AUTH ----------------
  async register({ email, password, fullName }) {
    this.ensureReady();
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: "pengelola"
        }
      }
    });
    if (error) throw error;
    return data;
  },

  async login(email, password) {
    this.ensureReady();
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  },

  async logout() {
    this.ensureReady();
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    this.ensureReady();
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  onAuthStateChange(callback) {
    this.ensureReady();
    return supabaseClient.auth.onAuthStateChange(callback);
  },

  // ---------------- PROFILE ----------------
  async getProfile(userId) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("users_profile")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error && error.code !== "PGRST116") throw error;
    return data;
  },

  async getProperties() {
    this.ensureReady();
    const { data, error } = await supabaseClient.from("properties").select("*").order("name");
    if (error) throw error;
    return data || [];
  },

  async createProperty(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient.from("properties").insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async getRooms() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("rooms")
      .select("*, properties(code, name, status)")
      .order("property_id")
      .order("room_number");
    if (error) throw error;
    return data || [];
  },

  async createRoom(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient.from("rooms").insert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async updateRoom(id, payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient.from("rooms").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return data;
  },

  // ---------------- TENANTS ----------------
  async getTenants() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenants")
      .select("*")
      .order("tenant_id", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getTenantContracts(tenantCode) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenant_contracts")
      .select("*")
      .eq("tenant_id", tenantCode)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createTenant(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenants")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateTenant(id, payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenants")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async uploadTenantIdCard(tenantCode, file) {
    this.ensureReady();
    const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
    const path = `${tenantCode}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { data, error } = await supabaseClient.storage
      .from("tenant-documents")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return data.path;
  },

  async removeTenantIdCard(path) {
    if (!path) return;
    this.ensureReady();
    const { error } = await supabaseClient.storage.from("tenant-documents").remove([path]);
    if (error) throw error;
  },

  async getTenantIdCardUrl(path) {
    this.ensureReady();
    const { data, error } = await supabaseClient.storage
      .from("tenant-documents")
      .createSignedUrl(path, 60);
    if (error) throw error;
    return data.signedUrl;
  },

  // ---------------- PAYMENTS ----------------
  async getPayments() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("payments")
      .select("*")
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createPayment(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("payments")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updatePayment(id, payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("payments")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deletePayment(id) {
    this.ensureReady();
    const { error } = await supabaseClient
      .from("payments")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  async getInvoices(periodMonth) {
    this.ensureReady();
    const { data: invoices, error } = await supabaseClient
      .from("invoices")
      .select("*, invoice_items(*)")
      .eq("period_month", periodMonth)
      .order("due_date", { ascending: true });
    if (error) throw error;
    if (!invoices?.length) return [];

    const invoiceIds = invoices.map(invoice => invoice.id);
    const { data: allocations, error: allocationError } = await supabaseClient
      .from("payment_allocations")
      .select("invoice_id, amount, payments(status, verification_status, payment_id, payment_date)")
      .in("invoice_id", invoiceIds);
    if (allocationError) throw allocationError;

    return invoices.map(invoice => ({
      ...invoice,
      payment_allocations: (allocations || []).filter(allocation => allocation.invoice_id === invoice.id)
    }));
  },

  async issueMonthlyRentInvoices(periodMonth) {
    this.ensureReady();
    const { data, error } = await supabaseClient.rpc("issue_monthly_rent_invoices", {
      p_period_month: periodMonth,
      p_issue_date: new Date().toISOString().slice(0, 10)
    });
    if (error) throw error;
    return data || 0;
  },

  async closeAccountingPeriod(periodMonth) {
    this.ensureReady();
    const { error } = await supabaseClient.rpc("close_accounting_period", {
      p_period_month: periodMonth
    });
    if (error) throw error;
  },

  async generateWhatsAppDraft(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient.functions.invoke("draft-whatsapp-reminder", { body: payload });
    if (error) throw error;
    if (!data?.draft) throw new Error("Fungsi AI tidak mengembalikan draft pesan.");
    return data.draft;
  },

  async recordInvoicePayment({ invoiceId, amount, paymentDate, paymentMethod, notes, transactionReference, evidencePath }) {
    this.ensureReady();
    const { data: paymentId, error } = await supabaseClient.rpc("record_invoice_payment_with_evidence", {
      p_invoice_id: invoiceId,
      p_amount: amount,
      p_payment_date: paymentDate,
      p_payment_method: paymentMethod,
      p_notes: notes,
      p_transaction_reference: transactionReference,
      p_evidence_path: evidencePath
    });
    if (error) throw error;

    const { data: payment, error: readError } = await supabaseClient
      .from("payments")
      .select("*")
      .eq("id", paymentId)
      .single();
    if (readError) throw readError;
    return payment;
  },

  async uploadPaymentEvidence(file) {
    this.ensureReady();
    if (!file || file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "application/pdf"].includes(file.type)) {
      throw new Error("Bukti transfer harus JPG, PNG, atau PDF maksimal 5 MB.");
    }
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session?.user) throw new Error("Sesi login tidak tersedia.");
    const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
    const path = `${sessionData.session.user.id}/${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await supabaseClient.storage
      .from("payment-evidence")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return data.path;
  },

  async removePaymentEvidence(path) {
    if (!path) return;
    this.ensureReady();
    const { error } = await supabaseClient.storage.from("payment-evidence").remove([path]);
    if (error) throw error;
  },

  async getPaymentEvidenceUrl(path) {
    this.ensureReady();
    const { data, error } = await supabaseClient.storage
      .from("payment-evidence")
      .createSignedUrl(path, 60);
    if (error) throw error;
    return data.signedUrl;
  },

  async verifyInvoicePayment(paymentId) {
    this.ensureReady();
    const { error } = await supabaseClient.rpc("verify_invoice_payment", { p_payment_id: paymentId });
    if (error) throw error;
  },

  async rejectInvoicePayment(paymentId, reason) {
    this.ensureReady();
    const { error } = await supabaseClient.rpc("reject_invoice_payment", {
      p_payment_id: paymentId,
      p_reason: reason
    });
    if (error) throw error;
  },

  async attachPendingPaymentEvidence(paymentId, reference, evidencePath) {
    this.ensureReady();
    const { error } = await supabaseClient.rpc("attach_pending_payment_evidence", {
      p_payment_id: paymentId,
      p_transaction_reference: reference,
      p_evidence_path: evidencePath
    });
    if (error) throw error;
  },

  async syncPaymentJournal(paymentId) {
    this.ensureReady();
    const { error } = await supabaseClient.rpc("create_payment_journal", {
      p_payment_id: paymentId
    });

    if (error) {
      const message = (error.message || "").toLowerCase();
      if (message.includes("does not exist") || message.includes("not exist") || message.includes("function") || message.includes("relation")) {
        return false;
      }
      throw error;
    }

    return true;
  },

  async getChartOfAccounts() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("chart_of_accounts")
      .select("*")
      .order("code", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async getJournalEntries() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("journal_entries")
      .select("*, journal_entry_lines(*)")
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getDeposits() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenant_deposits")
      .select("*")
      .order("paid_date", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createDeposit(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenant_deposits")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getRefunds() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenant_refunds")
      .select("*")
      .order("refund_date", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createRefund(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenant_refunds")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateRefund(id, payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("tenant_refunds")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ---------------- MAINTENANCE ----------------
  async getMaintenance() {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("maintenance_records")
      .select("*")
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createMaintenance(payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("maintenance_records")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateMaintenance(id, payload) {
    this.ensureReady();
    const { data, error } = await supabaseClient
      .from("maintenance_records")
      .update(payload)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async deleteMaintenance(id) {
    this.ensureReady();
    const { error } = await supabaseClient
      .from("maintenance_records")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }
};
