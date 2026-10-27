# Audit Proyek Kost WGA

## A. Ringkasan kondisi awal project

Proyek ini sudah berada pada fase demo / MVP operasional yang berfungsi untuk:

- login/register dengan Supabase Authentication,
- pengelolaan data penyewa dan kamar,
- kontrol piutang sewa,
- penerimaan kas,
- pencatatan maintenance dan biaya operasional.

Struktur aplikasi saat ini masih sederhana dan mengikuti pendekatan single-page app berbasis HTML + CSS + JavaScript. Database schema sudah tersedia di `schema.sql`, dengan tabel utama `users_profile`, `tenants`, `payments`, dan `maintenance_records`. Aplikasi memanfaatkan Supabase untuk autentikasi dan koneksi data.

Kondisi saat ini:

- Fungsionalitas utama sudah ada dan dapat dioperasikan untuk kebutuhan harian yang sederhana.
- Aplikasi belum mencakup akuntansi lengkap sesuai brief upgrade, seperti chart of accounts, jurnal otomatis, buku besar, neraca saldo, tutup buku, dan audit trail keuangan.
- Data dan alur operasional masih bersifat lightweight dan tidak sepenuhnya layak untuk sistem akuntansi yang terdokumentasi dan dapat diaudit.
- Pada sisi keamanan, konfigurasi Supabase masih dipasang di frontend secara langsung dan perlu ditata ulang agar lebih aman untuk lingkungan produksi.

## B. Daftar fitur existing yang dipertahankan

- Login dan register pengguna melalui Supabase
- Dashboard ringkas untuk operasional dan keuangan
- Kelola data penyewa dan kamar
- Upload KTP privat ke storage bucket `tenant-documents`
- Monitoring piutang per penyewa
- Pencatatan pembayaran kas masuk
- Cetak invoice untuk pembayaran lunas
- Maintenance dan pengeluaran operasional
- Session management dan logout
- RLS dan trigger awal pada database

## C. Daftar fitur yang ditingkatkan dan ditambahkan

- Penambahan guard konfigurasi Supabase agar aplikasi tidak crash saat URL/key belum siap.
- Penanganan error yang lebih jelas pada saat auth dan profile gagal di-load.
- Struktur audit dan roadmap upgrade yang lebih terarah untuk fase berikutnya.
- Persiapan dasar untuk transisi ke akuntansi lengkap dengan skema tambahan seperti akun, jurnal, dan periode akuntansi.

## D. Arsitektur dan ERD final

### Arsitektur

- Frontend: HTML5 + Tailwind CSS + Vanilla JavaScript
- Backend: Supabase PostgreSQL + Auth + Storage
- Security: RLS pada tabel utama
- Data model: operasional sederhana yang sudah ada, belum mencakup semua kebutuhan akuntansi final

### ERD ringkas

```text
auth.users
   1:1
   |
   v
users_profile

tenants
   1:N
   |
   +--> payments

maintenance_records
   (independent operational records)
```

## E. Daftar perubahan skema dan file

### File yang saat ini relevan

- `index.html` — UI utama dan modal
- `app.js` — logika aplikasi, render dashboard, CRUD operasional
- `supabase-config.js` — koneksi dan API layer
- `schema.sql` — struktur database awal
- `seed.sql` — sample data
- `tenant-profile-migration.sql` — migrasi tambahan untuk profil tenant

### Perubahan yang disarankan

- Menambah tabel akuntansi: `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `accounting_periods`, `bank_accounts`, `reconciliations`.
- Menambah tabel pada modul kontrak, deposit, invoice, payment_allocations, dan audit_logs.
- Mempertahankan kompatibilitas backward dengan tabel existing.
- Menetapkan migration SQL aman dan terdokumentasi untuk setiap penambahan skema.

## F. Matriks kebutuhan fitur

| Area | Status saat ini | Masalah utama | Perbaikan prioritas |
|---|---|---|---|
| Login / auth | Ada | Hardcoded config frontend | Pakai konfigurasi aman dan guard init |
| Master data tenant | Ada | Data belum lengkap untuk akuntansi multi-entity | Tambah dokumen, kontrak, status arsip |
| Piutang | Ada | Perhitungan sederhana, belum terhubung ke jurnal akuntansi | Hubungkan ke jurnal, alokasi, aging |
| Pembayaran | Ada | Belum ada idempotency dan alokasi multi-invoice | Tambahkan status verifikasi dan mapping jurnal |
| Deposit | Tidak ada | Belum dipisahkan dari pendapatan | Tambah modul deposit & refund |
| Invoice | Belum lengkap | Invoice manual belum formal | Tambah nomor unik, item, status lifecycle |
| Akuntansi | Belum ada | Belum ada COA/jurnal/buku besar | Implementasikan setelah skema selesai |
| RLS & hak akses | Basic | Belum memiliki peran detail dan audit | Tambah role policy yang lebih presisi |
| Rekonsiliasi bank | Tidak ada | Belum ada impor mutasi bank | Tambah flow import & match |
| Audit trail | Belum ada | Tidak ada catatan histori transaksi siap audit | Tambah `audit_logs` |

## G. Risiko terhadap data lama

- Jika skema diubah tanpa migrasi yang aman, data tenant dan payment dapat rusak.
- Perubahan struktur tabel secara agresif dapat memutus fitur existing.
- Jika bucket `tenant-documents` diubah dengan policy terlalu longgar, dokumen privat dapat terekspos.
- Menambahkan kolom tanpa migration dapat gagal di lingkungan Supabase yang sudah aktif.

## H. Rencana pengujian

1. Login/register dengan akun valid dan invalid.
2. Simpan data tenant dengan KTP valid dan invalid.
3. Buat pembayaran untuk tenant aktif.
4. Uji piutang dan status yang berubah.
5. Uji keamanan storage KTP dan signed URL.
6. Uji CRUD data operational.
7. Uji regresi untuk halaman dashboard, tenant, payment, maintenance.
8. Setelah skema akuntansi baru tersedia, uji jurnal seimbang dan laporan keuangan.

## I. Tahapan implementasi selanjutnya

### Fase 1 — Stabilitas
- Safe config guard
- Error handling untuk auth dan data loading
- Perbaiki arus CRUD data operasional

### Fase 2 — Master data
- Properti, room, tenant profile, kontrak, dokumen, arsip

### Fase 3 — Transaksi
- Invoice, payment allocation, deposit, refund, expense

### Fase 4 — Akuntansi
- COA, journal entries, book of accounts, trial balance

### Fase 5 — Pelaporan
- P&L, balance sheet, cash flow, aging, occupancy

### Fase 6 — Pengendalian
- RLS detail, audit logs, period close, approval flow

### Fase 7 — Penyempurnaan
- Notifications, export, responsive design, regression testing

## J. Catatan penting

Project saat ini sudah bagus sebagai MVP operasi kost, tetapi belum siap sepenuhnya menjadi sistem akuntansi yang terdokumentasi, audit-ready, dan sesuai dengan brief upgrade yang diberikan. Implementasi penuh harus dilakukan secara bertahap dengan migrasi aman, bukan dengan penggantian total aplikasi.

## K. Status implementasi lanjutan

### Sudah ditambahkan

- `accounting-migration.sql`: COA, periode, jurnal kas basis untuk seluruh penerimaan yang tidak dibatalkan, jurnal pembalik saat pembatalan, dan backfill transaksi lama.
- `accounting-advanced-migration.sql`: deposit, permintaan refund, pembatasan nilai pencairan di database, jurnal deposit/refund, dan audit log.
- `security-role-migration.sql`: akun baru menunggu persetujuan admin, role pemilik hanya-baca, hak tulis staf, serta jurnal tidak dapat diedit langsung melalui browser.
- UI deposit/refund, laporan saldo akun dari jurnal posted, ringkasan akun, dan trial balance.
- Lima laporan periode yang dapat dicetak: laba rugi, posisi keuangan, arus kas, perubahan ekuitas, dan catatan.
- Maintenance selesai membukukan beban dan utang vendor; pembayaran kas dicatat terpisah memakai tanggal pembayaran.
- `billing-accounting-migration.sql`: invoice sewa bulanan unik per penyewa/periode, jurnal akrual piutang-pendapatan, alokasi pembayaran atomik, jurnal penerimaan kas melawan piutang, dan cetak invoice.
- `property-room-migration.sql`: properti dan kamar ternormalisasi, backfill nomor kamar lama, foreign key tenant ke kamar, kontrol okupansi server-side, dan KPI ketersediaan.
- `tenant-contract-migration.sql`: nomor kontrak dan tanggal mulai/akhir pada tenant; billing mengecek periode kontrak sebelum menerbitkan invoice.
- `tenant-contract-history-migration.sql`: snapshot append-only kontrak saat tarif, tanggal, jatuh tempo, nomor, atau status tenant berubah; riwayat dapat dibaca dari UI.
- `payment-verification-migration.sql`: memisahkan status pembayaran terlapor dan transfer terverifikasi; hanya transfer confirmed masuk kas/jurnal, dengan approval/rejection RPC dan audit log.
- `payment-evidence-migration.sql`: bucket bukti transfer privat, referensi bank, validasi pemilik file di RPC, signed URL singkat untuk staf, serta antrean pending transfer di dashboard.
- `accounting-period-control-migration.sql`: tutup periode hanya oleh admin setelah cek keseimbangan jurnal, draft/adjustment, dan transfer pending; trigger menolak perubahan jurnal pada periode tertutup.
- Pengingat WhatsApp: draft pesan invoice outstanding, pengiriman manual via `wa.me`, serta opsi generasi AI lewat Supabase Edge Function agar secret provider tidak berada di browser.
- `payment-verification-migration.sql`: transfer baru pending sampai staf konfirmasi; hanya confirmed membuat jurnal kas dan mengurangi piutang, sedangkan penolakan membatalkan alokasi dengan alasan audit.
- Dashboard menampilkan tenant aktif yang masa kontraknya berakhir dalam 30 hari atau telah lewat; ini peringatan UI, belum merupakan reminder terjadwal.

### Belum selesai / perlu keputusan operasional

- Dokumen/approval/renewal kontrak, invoice item/tax/discount lifecycle lengkap, pembatalan/kredit invoice, alokasi satu pembayaran lintas invoice, serta aging piutang lintas periode.
- CRM lead/booking, histori tarif dan kapasitas kamar, check-in/check-out, inventaris, dan biaya per properti.
- Akrual penuh untuk komponen non-sewa, pembayaran vendor sebagian, jurnal koreksi yang formal, pembukaan ulang periode dengan approval, dan rekonsiliasi bank.
- Pengiriman WhatsApp otomatis, webhook/status delivery, dan aktivasi AI masih memerlukan deploy Edge Function serta konfigurasi secret provider.
- Export laporan dan pengujian end-to-end terhadap project Supabase yang sebenarnya.
- SQL migration belum dapat diterapkan dari lingkungan lokal ini; jalankan sesuai urutan di `README.md` sebelum memakai modul billing/accounting.

Laporan dalam aplikasi adalah laporan manajemen berbasis transaksi yang sudah dijurnal, bukan opini kepatuhan atau laporan audit PSAK/SAK EMKM. Periksa Catatan atas Laporan Keuangan pada aplikasi dan validasikan dengan akuntan sebelum dipakai sebagai laporan resmi.
