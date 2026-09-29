/*
  KOST WGA V2 — Supabase Client & API Layer

  Isi SUPABASE_URL dan SUPABASE_ANON_KEY dari:
  Supabase Dashboard > Project Settings > API.

  Jangan gunakan service_role key di browser.
*/

const SUPABASE_URL = "https://pxscjusggxwuyljyjedz.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4c2NqdXNnZ3h3dXlsanlqZWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA1NzkwMzQsImV4cCI6MjEwNjE1NTAzNH0.dikC8uSMRIj96eMHYQmeM6r4Cf0stSDAtP0ANHtzXq0";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const api = {
  // ---------------- AUTH ----------------
  async register({ email, password, fullName, role }) {
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role: role || "pengelola"
        }
      }
    });
    if (error) throw error;
    return data;
  },

  async login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
    return data;
  },

  async logout() {
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  onAuthStateChange(callback) {
    return supabaseClient.auth.onAuthStateChange(callback);
  },

  // ---------------- PROFILE ----------------
  async getProfile(userId) {
    const { data, error } = await supabaseClient
      .from("users_profile")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  // ---------------- TENANTS ----------------
  async getTenants() {
    const { data, error } = await supabaseClient
      .from("tenants")
      .select("*")
      .order("tenant_id", { ascending: true });
    if (error) throw error;
    return data || [];
  },

  async createTenant(payload) {
    const { data, error } = await supabaseClient
      .from("tenants")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateTenant(id, payload) {
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
    const { error } = await supabaseClient.storage.from("tenant-documents").remove([path]);
    if (error) throw error;
  },

  async getTenantIdCardUrl(path) {
    const { data, error } = await supabaseClient.storage
      .from("tenant-documents")
      .createSignedUrl(path, 60);
    if (error) throw error;
    return data.signedUrl;
  },

  async deleteTenant(id) {
    const { error } = await supabaseClient
      .from("tenants")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  // ---------------- PAYMENTS ----------------
  async getPayments() {
    const { data, error } = await supabaseClient
      .from("payments")
      .select("*")
      .order("payment_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createPayment(payload) {
    const { data, error } = await supabaseClient
      .from("payments")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updatePayment(id, payload) {
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
    const { error } = await supabaseClient
      .from("payments")
      .delete()
      .eq("id", id);
    if (error) throw error;
  },

  // ---------------- MAINTENANCE ----------------
  async getMaintenance() {
    const { data, error } = await supabaseClient
      .from("maintenance_records")
      .select("*")
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async createMaintenance(payload) {
    const { data, error } = await supabaseClient
      .from("maintenance_records")
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateMaintenance(id, payload) {
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
    const { error } = await supabaseClient
      .from("maintenance_records")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }
};
