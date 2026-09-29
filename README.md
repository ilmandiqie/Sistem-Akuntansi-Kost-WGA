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
- Pengelolaan data penyewa dan kamar
- Profil penyewa: kontak, alamat, pekerjaan, tanggal mulai tinggal, dan kontak darurat
- Upload KTP privat (JPG/PNG/PDF, maksimal 5 MB)
- Pencatatan dan kontrol piutang sewa
- Pencatatan penerimaan kas dan cetak invoice untuk pembayaran lunas
- Pengelolaan biaya dan aktivitas maintenance
- CRUD data menggunakan database Supabase
- Session management dan Logout
- Status penyewa, pembayaran, dan maintenance

---

## Teknologi

- **HTML5** — Struktur halaman aplikasi
- **CSS3 & Tailwind CSS** — Tampilan dan styling
- **Vanilla JavaScript ES6** — Logika dan interaksi aplikasi
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
- Role

Setelah registrasi berhasil, trigger PostgreSQL `handle_new_user()` secara otomatis membuat profil pengguna pada tabel `users_profile`.

---

## Setup

1. Buat project pada Supabase.
2. Untuk project Supabase baru, jalankan `schema.sql` melalui SQL Editor. Untuk database yang sudah berisi data, jalankan `tenant-profile-migration.sql` saja; jangan jalankan ulang `schema.sql` karena file tersebut menghapus tabel sebelum membuat ulang.
3. Pastikan Authentication > Providers > Email aktif.
4. Masukkan `SUPABASE_URL` dan `SUPABASE_ANON_KEY` pada `supabase-config.js`.
5. Register akun melalui aplikasi.
6. Jalankan `seed.sql` jika ingin menggunakan data awal.
7. Buka `index.html` menggunakan Live Server atau akses melalui GitHub Pages.

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
