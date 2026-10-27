# Kost WGA - Sistem Akuntansi Piutang & Penerimaan Kas

Aplikasi web untuk membantu pengelolaan administrasi dan pencatatan akuntansi usaha kost, meliputi data penyewa, piutang sewa, penerimaan kas, dan maintenance.

> **Live Demo:** [Klik di sini untuk membuka aplikasi](https://ilmandiqie.github.io/Sistem-Akuntansi-Kost-WGA/)

---

## Deskripsi Proyek

**Sistem Akuntansi Kost WGA** dirancang untuk membantu pengelola usaha kost dalam mengelola transaksi dan informasi operasional secara terintegrasi.

Sistem mencakup pengelolaan **data penyewa dan kamar, kontrol piutang sewa, pencatatan penerimaan kas, serta pencatatan biaya maintenance**. Data tersimpan pada database PostgreSQL melalui Supabase sehingga dapat digunakan secara terintegrasi dengan aplikasi web.

Proyek ini dibuat untuk memenuhi tugas UTS **Pengkodean dan Pemrograman**.

---

## Fitur

- Login dan Register menggunakan Supabase Authentication
- Dashboard informasi operasional dan keuangan
- Dashboard visual dengan grafik jurnal posted, komposisi kamar, beban, dan status invoice; filter periode memakai data aktual
- Tampilan kamar berbentuk kartu atau tabel
- Pengelolaan data penyewa dan kamar
- Pengelolaan multi-properti dan master kamar dengan kontrol okupansi
- Peringatan dashboard untuk kontrak yang sudah lewat atau berakhir dalam 30 hari
- KPI dan antrean transfer yang menunggu verifikasi manual
- Draft pengingat WhatsApp berbantuan AI untuk invoice outstanding
- Profil penyewa: kontak, alamat, pekerjaan, tanggal mulai tinggal, dan kontak darurat
- Upload KTP privat (JPG/PNG/PDF, maksimal 5 MB)
- Pencatatan dan kontrol piutang sewa
- Pencatatan penerimaan kas dan cetak invoice untuk pembayaran lunas
- Pengelolaan biaya dan aktivitas maintenance
- Modul deposit dan permintaan refund dengan jurnal otomatis
- Invoice sewa bulanan, alokasi pembayaran parsial ke piutang, dan cetak invoice
- Laporan laba rugi, posisi keuangan, arus kas, perubahan ekuitas, serta catatan berbasis jurnal
- Filter periode dan cetak laporan keuangan
- CRUD data menggunakan database Supabase
- Session management dan Logout
- Status penyewa, pembayaran, dan maintenance

---

## Teknologi

- **HTML5** — Struktur halaman aplikasi
- **CSS3 & Tailwind CSS** — Tampilan dan styling
- **Vanilla JavaScript ES6** — Logika dan interaksi aplikasi
- **Chart.js** — Grafik responsif untuk dashboard dan laporan keuangan
- **Supabase JS v2** — Database dan Authentication
- **PostgreSQL** — Database
- **FontAwesome** — Icon aplikasi
- **GitHub Pages** — Deployment aplikasi

---

## Struktur Repository

```text
Sistem-Akuntansi-Kost-WGA/
│
├── index.html              # Halaman utama aplikasi
├── style.css               # Styling aplikasi
├── app.js                  # Logika dan fungsi aplikasi
├── supabase-config.js      # Konfigurasi koneksi Supabase
├── schema.sql              # Struktur database
├── seed.sql                # Data awal / dummy
└── README.md               # Dokumentasi proyek
```

---

## Struktur Database

Sistem menggunakan **Supabase PostgreSQL** dengan tabel utama:

| Tabel | Fungsi |
|---|---|
| `users_profile` | Menyimpan profil dan role pengguna |
| `tenants` | Menyimpan data penyewa dan kamar |
| `payments` | Menyimpan transaksi pembayaran sewa |
| `maintenance_records` | Menyimpan data maintenance dan pengeluaran |

### Relasi Database

```text
auth.users
     │
     │ 1 : 1
     ▼
users_profile

tenants
     │
     │ 1 : N
     ▼
payments

maintenance_records
     │
     └── Independent
         untuk kamar maupun area/fasilitas umum
```

---

## Authentication

Sistem menggunakan **Supabase Authentication** untuk proses Login dan Register.

Data yang digunakan saat registrasi:

- Full Name
- Email
- Password
- Role awal pengelola dan status menunggu persetujuan admin

Setelah registrasi berhasil, trigger PostgreSQL `handle_new_user()` secara otomatis membuat profil pengguna pada tabel `users_profile`.

---

## Setup

1. Buat project pada Supabase dan pastikan Authentication > Providers > Email aktif.
2. Untuk project Supabase baru, jalankan `schema.sql` melalui SQL Editor. Untuk database yang sudah berisi data, jangan jalankan ulang `schema.sql` karena file tersebut menghapus tabel; jalankan migration profil tenant hanya bila kolomnya belum tersedia.
3. Jalankan migration berurutan melalui Supabase SQL Editor: `accounting-migration.sql`, `accounting-advanced-migration.sql`, `security-role-migration.sql`, `property-room-migration.sql`, `tenant-contract-migration.sql`, `tenant-contract-history-migration.sql`, `billing-accounting-migration.sql`, `payment-verification-migration.sql`, `payment-evidence-migration.sql`, lalu `accounting-period-control-migration.sql`.
4. Masukkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` pada `supabase-config.js`.
5. Register akun melalui aplikasi. Akun baru menunggu persetujuan dan belum bisa membaca atau mengubah data.
6. Untuk mengaktifkan akun pertama, ambil UUID akun dari Authentication > Users, lalu jalankan ini di Supabase SQL Editor dengan mengganti UUID contoh. Gunakan role `admin` untuk akun pemilik sistem. Akun `pemilik` hanya dapat membaca; role `admin` dan `pengelola` dapat mengelola transaksi.

     ```sql
     update public.users_profile
     set role = 'admin', approved = true
     where id = 'GANTI_DENGAN_UUID_DARI_AUTH_USERS';
     ```
7. Jalankan `seed.sql` hanya bila ingin memasukkan data contoh.
8. Buka `index.html` menggunakan Live Server atau akses melalui GitHub Pages.

Migration accounting menambahkan jurnal dan COA; migration advanced menambahkan deposit, refund, jurnal otomatis saat deposit diterima/dicairkan, dan audit trail; migration role menerapkan RLS berdasarkan profil. Migration aman untuk dijalankan ulang dan tidak menghapus data lama. Jangan bagikan `service_role` key di frontend.

Jika kolom tanggal/status pembayaran vendor belum tersedia, jalankan kembali `accounting-advanced-migration.sql`, lalu `security-role-migration.sql`. Untuk database yang telah menjalankan migration sebelumnya, jalankan `tenant-contract-history-migration.sql` satu kali untuk membuat snapshot kontrak historis; jalankan ulang `billing-accounting-migration.sql` hanya jika belum berhasil atau jika versi sebelumnya belum memfilter masa kontrak. Migration properti mempertahankan `tenants.room_number` dan menghubungkan data lama ke properti Kost WGA. Laporan saat ini adalah laporan manajemen berbasis jurnal posted, bukan laporan audit atau jaminan kepatuhan penuh SAK EMKM. Histori dokumen/revisi dan tanda tangan kontrak, invoice multi-item, pajak/diskon yang dapat dikonfigurasi, pembatalan/kredit invoice, dan alokasi satu pembayaran ke banyak invoice belum tersedia.

`payment-verification-migration.sql` memisahkan status verifikasi transfer dari status pelunasan invoice. Pembayaran transfer baru menunggu pemeriksaan staf; hanya Cash yang langsung dikonfirmasi saat dicatat. Untuk database yang sudah menjalankan billing, jalankan migration verifikasi ini sekali. Pembayaran lama dianggap confirmed untuk menjaga kompatibilitas; konfirmasi tersebut tidak memverifikasi ulang bukti transfer historis.

`payment-evidence-migration.sql` membuat bucket bukti transfer privat. Jalankan sekali setelah migration verifikasi. Transfer baru wajib memiliki nomor referensi dan bukti, tetapi staf tetap harus memeriksa mutasi bank dan mengonfirmasi secara manual; gambar bukti bukan konfirmasi otomatis.

`accounting-period-control-migration.sql` menambahkan penutupan periode oleh admin. Uji dengan periode yang seimbang dan tanpa transfer pending; pastikan jurnal baru pada periode tertutup ditolak. Penutupan tidak menyediakan pembukaan ulang; koreksi harus dilakukan pada periode terbuka berikutnya.

Pengingat WhatsApp membuat draft dari invoice outstanding dan membuka percakapan melalui WhatsApp Web/aplikasi setelah staf meninjau pesan. Untuk mengaktifkan pembuatan draft AI, deploy `supabase/functions/draft-whatsapp-reminder` dengan `supabase functions deploy draft-whatsapp-reminder`, lalu simpan secret provider dengan `supabase secrets set OPENAI_API_KEY=...`. Jangan memasukkan API key ke frontend. Fungsi mengirim nilai tagihan, periode, dan jatuh tempo ke provider AI tanpa nama atau nomor telepon penyewa; pengiriman WhatsApp tetap dilakukan manual. Tanpa Edge Function/secret, fitur AI belum tersedia, tetapi draft dapat ditulis manual dan dibuka lewat WhatsApp.

Untuk memverifikasi alur: catat pembayaran dengan metode **Transfer**, pastikan statusnya **Menunggu** dan invoice masih menyisakan piutang; konfirmasikan lewat tombol centang, lalu pastikan jurnal kas muncul; atau tolak dengan alasan dan pastikan alokasi dilepas. Metode **Cash** langsung confirmed karena dicatat sebagai penerimaan tunai oleh staf.

### Verifikasi billing setelah migration

1. Masuk sebagai admin/pengelola, buka **Kontrol Piutang**, pilih bulan berjalan, lalu tekan **Terbitkan Invoice**.
2. Pastikan invoice muncul satu kali per penyewa aktif dan jurnalnya mendebit `1201 Piutang Usaha` serta mengkredit `4101 Pendapatan Sewa`.
3. Catat pembayaran sebagian; pastikan saldo invoice turun dan jurnalnya mendebit `1101 Kas & Bank` serta mengkredit `1201 Piutang Usaha`.
4. Batalkan pembayaran; pastikan jurnal pembalik dibuat dan saldo invoice kembali terbuka.
5. Untuk memeriksa alokasi melalui SQL Editor:

     ```sql
     select i.invoice_no, i.tenant_id, i.total_amount,
                coalesce(sum(case when p.status <> 'Dibatalkan' then a.amount else 0 end), 0) as allocated,
                i.status
     from public.invoices i
     left join public.payment_allocations a on a.invoice_id = i.id
     left join public.payments p on p.id = a.payment_id
     where i.period_month = to_char(current_date, 'YYYY-MM')
     group by i.id
     order by i.invoice_no;
     ```

### Verifikasi properti dan kamar

1. Pastikan migrasi `property-room-migration.sql` berhasil, lalu buka **Properti & Kamar**.
2. Properti lama akan muncul sebagai **Kost WGA** dan kamar lama akan di-backfill dari `tenants.room_number`.
3. Tambahkan kamar baru, lalu daftarkan penghuni dengan memilih kamar tersebut; status kamar harus berubah menjadi `occupied`.
4. Coba menempatkan penghuni aktif kedua pada kamar yang sama; database harus menolak transaksi.
5. Ubah penghuni pertama menjadi `Keluar`; kamar kembali `available` jika tidak ada penghuni aktif lain.

KTP disimpan dalam bucket privat `tenant-documents`. Akses berkas hanya tersedia bagi pengguna yang sudah login, melalui signed URL yang berlaku selama 60 detik. Invoice dapat dicetak atau disimpan sebagai PDF dari dialog cetak browser, dan hanya muncul pada pembayaran berstatus **Lunas**.

---

## Seed Data

File `seed.sql` menyediakan data awal untuk pengujian sistem, meliputi:

- 5 data penyewa
- 4 transaksi pembayaran
- 4 data maintenance
- Data `users_profile`

---

## Deployment

Aplikasi di-deploy menggunakan **GitHub Pages** dan menggunakan **Supabase** sebagai backend database dan authentication.

**Repository:**  
https://github.com/ilmandiqie/Sistem-Akuntansi-Kost-WGA/

**Live Demo:**  
https://ilmandiqie.github.io/Sistem-Akuntansi-Kost-WGA/
