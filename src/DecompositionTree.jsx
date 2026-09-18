import React, {
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
  useEffect,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import Papa from "papaparse";

/* ============================================================================
   DecompositionTree — gaya Power BI, perbandingan berbasis RENTANG TANGGAL
   ----------------------------------------------------------------------------
   v5 — terang saja, warna dasar #72003B.

   Yang berubah dari v4:
   · Dark mode dicopot seluruhnya. Tidak ada satu pun varian `dark:` di file ini.
   · Seluruh warna ditarik dari satu palet anggur (#72003B) yang ditulis sebagai
     custom property di kelas `.dt`. Mau ganti warna dasar? Ubah --brand-* di
     konstanta STYLES, sekali, dan seluruh antarmuka ikut.
   · Abu-abunya bukan abu netral, melainkan abu hangat yang hue-nya sama dengan
     anggur, supaya border dan teks sekunder tidak terlihat "dingin" di sebelah
     warna utama.
   · Naik/turun memakai hijau pinus dan merah bata — sengaja dijauhkan dari hue
     anggur supaya selisih negatif tidak tertukar dengan aksen merek.
   · Interaksi visual: menyorot sebuah node akan menyalakan garis penghubungnya,
     kurva tergambar saat level baru dibuka, bilah melar saat nilai berubah,
     menu muncul dari titik jangkarnya. Semuanya dimatikan otomatis kalau
     sistem operasi meminta prefers-reduced-motion.
   · Tambahan: garis tren mini (P1 vs P2) di bilah ringkasan, dan Δ% total.

   Logika perhitungan tidak disentuh sama sekali — parsing tanggal, preset,
   agregasi, dan pohonnya identik dengan v4.

     Slicer Date      -> Periode P1   (dari tanggal … sampai tanggal)
     Slicer Cmp Date  -> Periode P2   (dari tanggal … sampai tanggal)

   Saat mode bandingkan mati, rentang P1 berlaku sebagai filter tanggal biasa.
   Saat dinyalakan, nilai tiap node menjadi  P1 − P2, dan node menampilkan
   nilai kedua periode plus Δ%.

   KOLOM TANGGAL
   Nama kolomnya dideteksi otomatis dari header CSV (lihat DATE_CANDIDATES).
   Kalau salah tebak, isi DATE_FIELD secara manual.
   Format d/m/Y vs m/d/Y juga dideteksi otomatis dengan memindai nilainya.

   BENTUK DATA
   Baris flat yang sudah diagregasi per kombinasi dimensi PLUS tanggal harian.

     __d          branch_area   Branch    Channel   Revenue   __n
     2026-06-09   JAWA BARAT    Jakarta   Shopee    12500000   18
   ========================================================================== */

const DATA_SOURCE = "csv"; // "csv" | "supabase"

/* ------------------------------------------------------------- konfigurasi */

const DIMENSIONS = [
  "branch_area",
  "Lini_Produk",
  "Channel",
  "Year",
  "Quarter_Name",
  "Payment_Method",
  "Branch",
  "Category",
];

const SLICERS = ["branch_area", "Branch", "Channel", "Lini_Produk", "Payment_Method"];

const NUMERIC_FIELDS = ["Revenue", "__n"];

const MEASURES = [
  { key: "Revenue", label: "Pendapatan", field: "Revenue", format: "currency" },
  { key: "__n", label: "Jumlah transaksi", field: "__n", format: "int" },
];

// "auto" = dideteksi dari header. Isi manual kalau tebakannya meleset,
// misalnya DATE_FIELD = "Tanggal_Transaksi".
const DATE_FIELD = "auto";
const DATE_CANDIDATES = [
  "Date", "date", "DATE",
  "sale_date", "Sale_Date",
  "Tanggal", "tanggal", "Tanggal_Transaksi",
  "Order_Date", "order_date", "TransactionDate", "Transaction_Date",
];

// "auto" | "iso" | "dmy" | "mdy"
const DATE_FORMAT = "auto";

const DIMENSION_LABELS = {
  branch_area: "Wilayah",
  Branch: "Cabang",
  Channel: "Kanal",
  Lini_Produk: "Lini produk",
  Category: "Kategori produk",
  Payment_Method: "Metode bayar",
  Year: "Tahun",
  Quarter_Name: "Kuartal",
};

const labelOf = (dim) => DIMENSION_LABELS[dim] || String(dim).replace(/_/g, " ");

const NODE_LIMIT = 10;

// Diisi oleh loader supaya bisa ditampilkan di UI.
let DETECTED = { field: null, format: null };

/* ----------------------------------------------------------------- tema    */

/**
 * WARNA DASAR: #72003B  (--brand-700)
 *
 * Palet disimpan sebagai custom property di kelas `.dt`, bukan di
 * tailwind.config, supaya file ini tetap bisa dijatuhkan ke proyek mana pun
 * tanpa menyentuh konfigurasi kamu. Utility Tailwind memanggilnya lewat
 * arbitrary value, contohnya  text-[var(--brand-700)].
 *
 * Skala anggur dibuat dengan menahan hue di 329° dan hanya menggerakkan
 * kecerahan. Skala "ink" adalah abu dengan sedikit hue yang sama, jadi
 * hairline dan teks sekunder duduk tenang di sebelah warna utama alih-alih
 * terlihat kebiruan.
 */
const STYLES = `
.dt{
  --brand-50:#fcf3f8;
  --brand-100:#f8e3ee;
  --brand-200:#eec9dc;
  --brand-300:#db9ebe;
  --brand-400:#c66c9b;
  --brand-500:#b23475;
  --brand-600:#931556;
  --brand-700:#72003b;
  --brand-800:#57002d;
  --brand-900:#3d0020;

  --ink-900:#241a1f;
  --ink-800:#3a2c33;
  --ink-700:#4a3b42;
  --ink-600:#6b5a62;
  --ink-500:#8a737c;
  --ink-400:#a8949c;
  --ink-300:#cfc2c8;
  --ink-200:#e7dee2;
  --ink-100:#f2ecef;
  --ink-50:#faf7f8;

  --paper:#ffffff;
  --canvas:#fbf8f9;

  --pos:#0e6e52;
  --pos-soft:#12876a;
  --pos-bg:#e7f3ee;
  --neg:#b42318;
  --neg-soft:#d14134;
  --neg-bg:#fdeceb;

  --note:#8a5a00;
  --note-bg:#fdf7e8;
  --note-line:#eedcb4;

  color-scheme:light;
}

.dt ::selection{background:var(--brand-100);color:var(--brand-900)}

/* satu-satunya blok berwarna penuh di halaman ini */
.dt-topbar{background-image:linear-gradient(103deg,var(--brand-900) 0%,var(--brand-700) 46%,var(--brand-600) 100%)}

/* kanvas bertitik halus supaya kurva penghubung terbaca seperti digambar
   di atas kertas milimeter, bukan mengambang di ruang kosong */
.dt-canvas{
  background-color:var(--canvas);
  background-image:radial-gradient(rgba(114,0,59,.075) 1px,transparent 1px);
  background-size:24px 24px;
  background-position:-1px -1px;
}

.dt-fill{background-image:linear-gradient(90deg,var(--brand-500),var(--brand-700))}
.dt-fill-mute{background-image:linear-gradient(90deg,var(--brand-200),var(--brand-300))}
.dt-fill-pos{background-image:linear-gradient(90deg,var(--pos-soft),var(--pos))}
.dt-fill-neg{background-image:linear-gradient(90deg,var(--neg-soft),var(--neg))}

.dt-shadow{box-shadow:0 1px 2px rgba(36,26,31,.05),0 1px 1px rgba(36,26,31,.04)}
.dt-shadow-lift:hover{box-shadow:0 8px 20px -8px rgba(114,0,59,.26),0 2px 6px rgba(36,26,31,.06)}
.dt-shadow-pop{box-shadow:0 14px 34px -14px rgba(36,26,31,.38),0 2px 8px rgba(36,26,31,.08)}
.dt-glow{filter:drop-shadow(0 1px 3px rgba(114,0,59,.35))}

@keyframes dtRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes dtPop{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:none}}
@keyframes dtDraw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}
@keyframes dtSweep{from{background-position:-160% 0}to{background-position:260% 0}}

/* satu gerakan terorkestrasi per level baru: kolomnya naik, kurvanya tergambar */
.dt-rise{animation:dtRise .36s cubic-bezier(.22,1,.36,1) both}
.dt-pop{animation:dtPop .14s cubic-bezier(.22,1,.36,1) both}
.dt-draw{stroke-dasharray:1;animation:dtDraw .62s cubic-bezier(.22,1,.36,1) both}

.dt-skeleton{
  background-image:linear-gradient(90deg,var(--ink-100) 0%,var(--brand-50) 45%,var(--ink-100) 90%);
  background-size:220% 100%;
  animation:dtSweep 1.5s ease-in-out infinite;
}

.dt-scroll::-webkit-scrollbar{width:11px;height:11px}
.dt-scroll::-webkit-scrollbar-track{background:transparent}
.dt-scroll::-webkit-scrollbar-thumb{background:var(--ink-200);background-clip:content-box;border:3px solid transparent;border-radius:999px}
.dt-scroll::-webkit-scrollbar-thumb:hover{background:var(--brand-300);background-clip:content-box;border:3px solid transparent}

.dt input[type="date"]::-webkit-calendar-picker-indicator{opacity:.45;cursor:pointer}
.dt input[type="date"]:hover::-webkit-calendar-picker-indicator{opacity:.9}

@media (prefers-reduced-motion:reduce){
  .dt-rise,.dt-pop,.dt-draw,.dt-skeleton{animation:none}
  .dt *{transition-duration:1ms !important}
}
`;

// Satu keluarga huruf saja. IBM Plex Sans punya angka tabular yang rapi untuk
// kolom nilai, jadi tidak perlu face kedua untuk data.
const ROOT_FONT = {
  fontFamily:
    '"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
};

/* kelas yang berulang, disimpan supaya tidak terserak di seluruh berkas */
const LINE = "border-[var(--ink-200)]";
const CARD = `rounded-lg border ${LINE} bg-[var(--paper)]`;
const MUTED = "text-[var(--ink-500)]";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-300)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--paper)]";

const FIELD = `w-[122px] rounded-md border ${LINE} bg-[var(--ink-50)] px-2 py-1 text-[12px] text-[var(--ink-900)] transition-colors hover:border-[var(--brand-300)] focus:border-[var(--brand-400)] focus:bg-[var(--paper)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-200)]`;

const BTN = `rounded-md border ${LINE} bg-[var(--paper)] px-2.5 py-1.5 text-xs text-[var(--ink-700)] transition-colors hover:border-[var(--brand-300)] hover:text-[var(--brand-700)] disabled:cursor-default disabled:opacity-45 disabled:hover:border-[var(--ink-200)] disabled:hover:text-[var(--ink-700)] ${FOCUS}`;

const BTN_ON = `rounded-md border border-[var(--brand-600)] bg-[var(--brand-700)] px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-[var(--brand-600)] active:bg-[var(--brand-800)] disabled:cursor-default disabled:opacity-45 ${FOCUS}`;

const BTN_QUIET = `rounded px-1.5 py-1 text-[11px] text-[var(--ink-500)] transition-colors hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--ink-500)] ${FOCUS}`;

const SELECT = `cursor-pointer rounded-md border ${LINE} bg-[var(--paper)] px-2 py-1.5 text-xs font-medium text-[var(--ink-900)] transition-colors hover:border-[var(--brand-300)] ${FOCUS}`;

const MENU = `rounded-xl border ${LINE} bg-[var(--paper)] p-1 dt-shadow-pop`;

const MENU_ITEM = `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--ink-800)] transition-colors hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)] ${FOCUS}`;

const NOTE_BAR = `flex flex-wrap items-center gap-2 border-b border-[var(--note-line)] bg-[var(--note-bg)] px-4 py-2 text-xs text-[var(--note)]`;

// Dipakai Frame dan juga pembungkus portal, supaya menu yang dirender di luar
// pohon komponen tetap mewarisi palet dan huruf yang sama.
const ROOT_CLASS =
  "dt text-[13px] leading-[1.45] text-[var(--ink-900)] antialiased [font-variant-numeric:tabular-nums]";

/** Gabungkan className secara kondisional, mengabaikan nilai falsy. */
function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------- utilitas tanggal  */

const pad2 = (n) => String(n).padStart(2, "0");
const isoOf = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;

/**
 * Ubah nilai mentah jadi string ISO "YYYY-MM-DD".
 * Mengembalikan null kalau tidak bisa dibaca sebagai tanggal.
 */
function parseDate(raw, fmt = "dmy") {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // 2026-06-09 atau 2026-06-09 00:00:00.000
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoOf(m[1], +m[2], +m[3]);

  // 09/06/2026, 09-06-2026, 09.06.2026
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3];
    if (fmt === "mdy") return isoOf(y, a, b);
    return isoOf(y, b, a); // default d/m/Y, lazim di ekspor Indonesia
  }

  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

/**
 * Tebak d/m/Y atau m/d/Y dengan memindai nilai contoh.
 * Angka pertama > 12 berarti pasti hari; angka kedua > 12 berarti pasti bulan.
 */
function detectDateFormat(samples) {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    const m = String(s ?? "").match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    else if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? "mdy" : "dmy";
}

/** Cari kolom tanggal dari header, lalu dari isinya sebagai cadangan. */
function detectDateColumn(sample, headers) {
  for (const c of DATE_CANDIDATES) if (headers.includes(c)) return c;

  for (const h of headers) {
    let ok = 0;
    let n = 0;
    for (const r of sample) {
      const v = r[h];
      if (v == null || v === "") continue;
      // Wajib ada pemisah, supaya kolom Year (mis. "2026") tidak ikut tertebak.
      if (!/[/\-.]/.test(String(v))) continue;
      n++;
      if (parseDate(v)) ok++;
    }
    if (n > 10 && ok / n > 0.8) return h;
  }
  return null;
}

const toJs = (iso) => new Date(`${iso}T00:00:00`);
const fromJs = (d) => isoOf(d.getFullYear(), d.getMonth() + 1, d.getDate());

function shiftDays(iso, n) {
  const d = toJs(iso);
  d.setDate(d.getDate() + n);
  return fromJs(d);
}
function shiftMonths(iso, n) {
  const d = toJs(iso);
  d.setMonth(d.getMonth() + n);
  return fromJs(d);
}
function shiftYears(iso, n) {
  const d = toJs(iso);
  d.setFullYear(d.getFullYear() + n);
  return fromJs(d);
}
/* --- aritmetika kalender ---
   Dihitung dari komponen tahun/bulan/hari, bukan Date.setMonth, supaya
   31 Januari + 1 bulan tidak melompat ke 3 Maret. Pakai UTC agar bebas
   pengaruh zona waktu. Bulan boleh melewati batas (0 atau 13): tahunnya
   ikut bergeser sendiri. */
const ym = (iso) => ({ y: +iso.slice(0, 4), m: +iso.slice(5, 7), d: +iso.slice(8, 10) });

function monthStart(y, m) {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
function monthEnd(y, m) {
  const d = new Date(Date.UTC(y, m, 0)); // hari ke-0 bulan berikutnya = hari terakhir
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

const startOfMonth = (iso) => `${iso.slice(0, 7)}-01`;
const endOfMonth = (iso) => {
  const { y, m } = ym(iso);
  return monthEnd(y, m);
};

const quarterOf = (m) => Math.floor((m - 1) / 3) + 1;

/** Rentang satu kuartal. q boleh 0 atau 5; tahunnya otomatis bergeser. */
function quarterRange(y, q) {
  const yy = y + Math.floor((q - 1) / 4);
  const qq = (((q - 1) % 4) + 4) % 4 + 1;
  const m1 = (qq - 1) * 3 + 1;
  return { from: monthStart(yy, m1), to: monthEnd(yy, m1 + 2) };
}

const yearRange = (y) => ({ from: isoOf(y, 1, 1), to: isoOf(y, 12, 31) });

/** Geser tahun dengan aman: 29 Feb 2024 − 1 tahun menjadi 28 Feb 2023. */
function shiftYearSafe(iso, n) {
  const { y, m, d } = ym(iso);
  const last = +monthEnd(y + n, m).slice(8, 10);
  return isoOf(y + n, m, Math.min(d, last));
}

function daysBetween(a, b) {
  if (!a || !b) return 0;
  return Math.round((toJs(b) - toJs(a)) / 86400000) + 1;
}

const inRange = (d, r) => !!d && !!r && !!r.from && !!r.to && d >= r.from && d <= r.to;

/* --- daftar preset ---
   Semua preset dihitung dari TANGGAL ACUAN, yaitu isi kotak "dari" pada P1.
   Contoh: acuan 5 Juli 2025 + "Bulan penuh vs bulan sebelumnya" menghasilkan
   P1 = 1–31 Juli 2025 dan P2 = 1–30 Juni 2025.
   Dua preset terakhir tidak memakai acuan: P1 dibiarkan apa adanya, hanya
   P2 yang dihitung. Gunakan itu kalau rentang P1 diketik manual. */
const PRESETS = [
  { group: "Bulan", key: "month_prev", label: "Bulan penuh vs bulan sebelumnya" },
  { group: "Bulan", key: "month_yoy", label: "Bulan penuh vs bulan sama tahun lalu" },
  { group: "Bulan", key: "mtd_yoy", label: "MTD (awal bulan s/d acuan) vs tahun lalu" },

  { group: "Kuartal", key: "quarter_prev", label: "Kuartal penuh vs kuartal sebelumnya" },
  { group: "Kuartal", key: "quarter_yoy", label: "Kuartal penuh vs kuartal sama tahun lalu" },

  { group: "Tahun", key: "ytd_yoy", label: "YTD (1 Jan s/d acuan) vs tahun lalu" },
  { group: "Tahun", key: "year_prev", label: "Tahun penuh vs tahun sebelumnya" },

  { group: "Bergulir", key: "roll30", label: "30 hari s/d acuan vs 30 hari sebelumnya" },
  { group: "Bergulir", key: "roll90", label: "90 hari s/d acuan vs 90 hari sebelumnya" },

  { group: "Pertahankan P1", key: "keep_prev", label: "P2 = periode sebelumnya, panjang sama" },
  { group: "Pertahankan P1", key: "keep_yoy", label: "P2 = periode sama tahun lalu" },
];

const PRESET_LABEL = Object.fromEntries(PRESETS.map((p) => [p.key, p.label]));

/**
 * Hitung pasangan rentang untuk sebuah preset.
 * @param kind   kunci preset
 * @param anchor tanggal acuan (ISO) — biasanya isi kotak "dari" pada P1
 * @param cur    rentang P1 saat ini, dipakai oleh preset "Pertahankan P1"
 * @returns [P1, P2] atau null kalau tidak bisa dihitung
 */
function computePreset(kind, anchor, cur) {
  if (kind === "keep_prev") {
    const n = daysBetween(cur.from, cur.to);
    if (!n) return null;
    const to = shiftDays(cur.from, -1);
    return [{ ...cur }, { from: shiftDays(to, -(n - 1)), to }];
  }
  if (kind === "keep_yoy") {
    if (!cur.from || !cur.to) return null;
    return [
      { ...cur },
      { from: shiftYearSafe(cur.from, -1), to: shiftYearSafe(cur.to, -1) },
    ];
  }

  if (!anchor) return null;
  const { y, m } = ym(anchor);
  const q = quarterOf(m);

  switch (kind) {
    case "month_prev":
      return [
        { from: monthStart(y, m), to: monthEnd(y, m) },
        { from: monthStart(y, m - 1), to: monthEnd(y, m - 1) },
      ];

    case "month_yoy":
      return [
        { from: monthStart(y, m), to: monthEnd(y, m) },
        { from: monthStart(y - 1, m), to: monthEnd(y - 1, m) },
      ];

    case "mtd_yoy":
      return [
        { from: monthStart(y, m), to: anchor },
        { from: monthStart(y - 1, m), to: shiftYearSafe(anchor, -1) },
      ];

    case "quarter_prev":
      return [quarterRange(y, q), quarterRange(y, q - 1)];

    case "quarter_yoy":
      return [quarterRange(y, q), quarterRange(y - 1, q)];

    case "ytd_yoy":
      return [
        { from: isoOf(y, 1, 1), to: anchor },
        { from: isoOf(y - 1, 1, 1), to: shiftYearSafe(anchor, -1) },
      ];

    case "year_prev":
      return [yearRange(y), yearRange(y - 1)];

    case "roll30":
    case "roll90": {
      const n = kind === "roll30" ? 30 : 90;
      const P1 = { from: shiftDays(anchor, -(n - 1)), to: anchor };
      const to2 = shiftDays(P1.from, -1);
      return [P1, { from: shiftDays(to2, -(n - 1)), to: to2 }];
    }

    default:
      return null;
  }
}

const dLabel = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });
const shortRange = (r) =>
  r && r.from && r.to ? `${dLabel.format(toJs(r.from))} – ${dLabel.format(toJs(r.to))}` : "–";

/* --------------------------------------------------------- utilitas angka  */

const EMPTY = "(kosong)";

const nfCompact = new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 });
const nfFull = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });
const nfPct = new Intl.NumberFormat("id-ID", { style: "percent", maximumFractionDigits: 1 });

function fmt(value, format, compactMode = false) {
  if (value == null || Number.isNaN(value)) return "–";
  const n = compactMode ? nfCompact.format(Math.abs(value)) : nfFull.format(Math.abs(value));
  const sign = value < 0 ? "−" : "";
  return format === "currency" ? `${sign}Rp ${n}` : `${sign}${n}`;
}

const signedPct = (p) => (p == null ? "–" : `${p >= 0 ? "+" : ""}${nfPct.format(p)}`);

function keyOf(row, dim) {
  const v = row[dim];
  if (v === null || v === undefined || v === "") return EMPTY;
  const s = String(v).trim();
  return s === "" || s.toUpperCase() === "NULL" ? EMPTY : s;
}

function sumBy(rows, field) {
  let t = 0;
  for (const row of rows) t += Number(row[field]) || 0;
  return t;
}

/**
 * Agregasi satu dimensi.
 * Tanpa compare  → { label, value }
 * Dengan compare → { label, value: p1 - p2, p1, p2, pct }
 *
 * Catatan: pengecekan P1 dan P2 sengaja memakai dua `if` terpisah, bukan
 * if/else. Kalau kedua rentang bertumpang tindih, baris yang masuk keduanya
 * memang harus dihitung di dua sisi.
 */
function aggregate(rows, dim, field, compare) {
  const acc = new Map();

  if (!compare) {
    for (const row of rows) {
      const k = keyOf(row, dim);
      acc.set(k, (acc.get(k) || 0) + (Number(row[field]) || 0));
    }
    return Array.from(acc, ([label, value]) => ({ label, value })).sort(
      (a, b) => b.value - a.value
    );
  }

  for (const row of rows) {
    const k = keyOf(row, dim);
    let e = acc.get(k);
    if (!e) {
      e = { label: k, p1: 0, p2: 0 };
      acc.set(k, e);
    }
    const v = Number(row[field]) || 0;
    if (inRange(row.__d, compare.p1)) e.p1 += v;
    if (inRange(row.__d, compare.p2)) e.p2 += v;
  }

  return Array.from(acc.values())
    .map((e) => ({
      ...e,
      value: e.p1 - e.p2,
      pct: e.p2 ? (e.p1 - e.p2) / e.p2 : null,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Total lengkap: nilai yang dipakai pohon, plus kedua sisi dan Δ%. */
function totalsOf(rows, field, compare) {
  if (!compare) {
    const v = sumBy(rows, field);
    return { value: v, p1: v, p2: null, pct: null };
  }
  let p1 = 0;
  let p2 = 0;
  for (const row of rows) {
    const v = Number(row[field]) || 0;
    if (inRange(row.__d, compare.p1)) p1 += v;
    if (inRange(row.__d, compare.p2)) p2 += v;
  }
  return { value: p1 - p2, p1, p2, pct: p2 ? (p1 - p2) / p2 : null };
}

const totalOf = (rows, field, compare) => totalsOf(rows, field, compare).value;

function sortNodes(nodes, mode) {
  const out = nodes.slice();
  if (mode === "asc") out.sort((a, b) => a.value - b.value);
  else if (mode === "name") out.sort((a, b) => a.label.localeCompare(b.label, "id"));
  else out.sort((a, b) => b.value - a.value);
  return out;
}

/**
 * Tutup saat klik di luar. `ignoreSelector` dipakai supaya tombol yang membuka
 * panel tidak ikut menutupnya — tanpa itu, mousedown menutup lalu click
 * membuka lagi, dan tombolnya jadi tidak bisa dipakai untuk menutup.
 */
function useClickOutside(ref, onOut, active, ignoreSelector) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (ignoreSelector && e.target?.closest?.(ignoreSelector)) return;
      onOut();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onOut();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onOut, active, ignoreSelector]);
}

/* ------------------------------------------------------------------ Frame  */

/** Pembungkus akar: memasang palet, huruf, dan warna dasar halaman. */
function Frame({ children }) {
  return (
    <div
      className={cx(ROOT_CLASS, "flex h-full flex-col bg-[var(--canvas)]")}
      style={ROOT_FONT}
    >
      <style>{STYLES}</style>
      {children}
    </div>
  );
}

/** Potongan nama berkas atau konstanta di dalam kalimat. */
function Code({ children }) {
  return (
    <code className="rounded border border-[var(--brand-100)] bg-[var(--brand-50)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--brand-700)]">
      {children}
    </code>
  );
}

/* --------------------------------------------------------------- Sparkline */

/**
 * Garis tren harian. P1 digambar penuh dengan area tipis di bawahnya,
 * P2 sebagai garis putus-putus abu. Keduanya diskalakan ke puncak yang sama
 * supaya tingginya bisa dibandingkan langsung.
 */
function Sparkline({ a, b, tone = "brand" }) {
  const W = 172;
  const H = 40;
  const P = 4;

  const path = (arr) => {
    if (!arr || arr.length < 2) return null;
    let peak = 0;
    for (const v of arr) if (v > peak) peak = v;
    if (b) for (const v of b) if (v > peak) peak = v;
    if (!peak) peak = 1;
    const x = (i) => P + (i / (arr.length - 1)) * (W - P * 2);
    const y = (v) => H - P - (v / peak) * (H - P * 2);
    let d = `M ${x(0).toFixed(1)} ${y(arr[0]).toFixed(1)}`;
    for (let i = 1; i < arr.length; i++) d += ` L ${x(i).toFixed(1)} ${y(arr[i]).toFixed(1)}`;
    return { d, area: `${d} L ${x(arr.length - 1).toFixed(1)} ${H - P} L ${x(0).toFixed(1)} ${H - P} Z` };
  };

  const pa = path(a);
  if (!pa) return null;
  const pb = b ? path(b) : null;
  const stroke =
    tone === "pos" ? "var(--pos)" : tone === "neg" ? "var(--neg)" : "var(--brand-700)";

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" className="shrink-0">
      <path d={pa.area} fill={stroke} opacity=".08" />
      {pb && (
        <path
          d={pb.d}
          fill="none"
          stroke="var(--ink-300)"
          strokeWidth="1.25"
          strokeDasharray="3 3"
          strokeLinecap="round"
        />
      )}
      <path
        d={pa.d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ chart  */

const CHART_KINDS = [
  { key: "line", label: "Tren garis" },
  { key: "cumulative", label: "Tren kumulatif" },
  { key: "bar", label: "Batang per periode" },
  { key: "contribution", label: "Kontribusi per dimensi" },
  { key: "bridge", label: "Jembatan selisih", cmpOnly: true },
];

const GRANS = [
  { key: "auto", label: "Otomatis" },
  { key: "day", label: "Harian" },
  { key: "week", label: "Mingguan" },
  { key: "month", label: "Bulanan" },
];

const GRAN_WORD = { day: "harian", week: "mingguan", month: "bulanan" };

const fmtDayLabel = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" });
const fmtMonthLabel = new Intl.DateTimeFormat("id-ID", { month: "short", year: "2-digit" });

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Berapa ember (hari, minggu, atau bulan) yang menutupi sebuah rentang. */
function bucketCount(range, gran) {
  if (!range || !range.from || !range.to) return 0;
  if (gran === "month") {
    const a = ym(range.from);
    const b = ym(range.to);
    return (b.y - a.y) * 12 + (b.m - a.m) + 1;
  }
  const n = daysBetween(range.from, range.to);
  return gran === "week" ? Math.ceil(n / 7) : n;
}

/** Ember ke berapa sebuah tanggal jatuh, dihitung dari awal rentang. */
function bucketIndex(iso, range, gran) {
  if (gran === "month") {
    const a = ym(range.from);
    const b = ym(iso);
    return (b.y - a.y) * 12 + (b.m - a.m);
  }
  const days = Math.round((toJs(iso) - toJs(range.from)) / 86400000);
  return gran === "week" ? Math.floor(days / 7) : days;
}

/** Tanggal awal ember ke-i. */
function bucketStart(range, gran, i) {
  if (gran === "month") {
    const a = ym(range.from);
    const total = a.m - 1 + i;
    return monthStart(a.y + Math.floor(total / 12), (((total % 12) + 12) % 12) + 1);
  }
  return shiftDays(range.from, gran === "week" ? i * 7 : i);
}

function bucketText(iso, gran) {
  if (!iso) return "";
  return gran === "month" ? fmtMonthLabel.format(toJs(iso)) : fmtDayLabel.format(toJs(iso));
}

/** Nama panjang satu ember, dipakai di tooltip. */
function bucketFull(range, gran, i) {
  const from = bucketStart(range, gran, i);
  if (!from) return "";
  if (gran === "day") return dLabel.format(toJs(from));
  if (gran === "month") return new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(toJs(from));
  const to = shiftDays(from, 6);
  return `${fmtDayLabel.format(toJs(from))} – ${dLabel.format(toJs(to))}`;
}

/** Skala sumbu yang berhenti di angka bulat, bukan di angka hasil bagi. */
function niceScale(minIn, maxIn, count = 4) {
  let lo = Math.min(0, minIn);
  let hi = Math.max(0, maxIn);
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(raw) || 1)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  return { lo, hi, ticks };
}

/** Lebar sebuah elemen, diikuti terus lewat ResizeObserver. */
function useWidth(ref, fallback = 900) {
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setW(el.clientWidth || fallback);
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, fallback]);
  return w;
}

/** Kotak keterangan yang mengikuti kursor, dibalik kalau mepet tepi kanan. */
function ChartTip({ x, y, width, children }) {
  const flip = x > width - 176;
  return (
    <div
      className="dt-shadow-pop pointer-events-none absolute z-10 w-[164px] rounded-lg border border-[var(--ink-200)] bg-[var(--paper)] px-2.5 py-2 text-[11px]"
      style={{ left: flip ? x - 174 : x + 14, top: Math.max(2, y - 16) }}
    >
      {children}
    </div>
  );
}

function TipRow({ name, value, muted }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-2">
      <span className="text-[var(--ink-500)]">{name}</span>
      <span className={cx("font-medium", muted ? "text-[var(--ink-600)]" : "text-[var(--ink-900)]")}>
        {value}
      </span>
    </div>
  );
}

const AXIS = "var(--ink-400)";
const GRID = "var(--ink-100)";

/* --- tren, kumulatif, dan batang ---------------------------------------- */

function TimeChart({ data, measure, compare, kind, width, height }) {
  const [at, setAt] = useState(null);

  const M = { top: 14, right: 16, bottom: 28, left: 74 };
  const n = data.a.length;
  const iw = Math.max(60, width - M.left - M.right);
  const ih = Math.max(60, height - M.top - M.bottom);

  const { a, b } = useMemo(() => {
    if (kind !== "cumulative") return { a: data.a, b: data.b };
    const run = (arr) => {
      if (!arr) return null;
      let t = 0;
      return arr.map((v) => (t += v));
    };
    return { a: run(data.a), b: run(data.b) };
  }, [data, kind]);

  const scale = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const v of a) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (b) {
      for (const v of b) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return niceScale(lo, hi);
  }, [a, b]);

  const isBar = kind === "bar";
  const band = iw / Math.max(1, n);
  const px = (i) =>
    isBar ? M.left + band * (i + 0.5) : M.left + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const py = (v) => M.top + ih - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * ih;

  const linePath = (arr) =>
    arr.map((v, i) => `${i ? "L" : "M"} ${px(i).toFixed(1)} ${py(v).toFixed(1)}`).join(" ");

  const xIdx = useMemo(() => {
    const want = Math.max(2, Math.min(8, Math.floor(iw / 100)));
    const out = new Set();
    for (let k = 0; k < want; k++) out.add(Math.round((k / (want - 1)) * (n - 1)));
    return Array.from(out).sort((x, y) => x - y);
  }, [iw, n]);

  const readAt = (e) => {
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget;
    const rel = e.clientX - svg.getBoundingClientRect().left;
    const i = isBar
      ? Math.floor((rel - M.left) / band)
      : Math.round(((rel - M.left) / iw) * (n - 1));
    setAt(Math.max(0, Math.min(n - 1, i)));
  };

  const barW = Math.max(1, (compare ? band * 0.34 : band * 0.66));
  const zeroY = py(0);

  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`Grafik ${measure.label}`}>
        <defs>
          <linearGradient id="dtArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-700)" stopOpacity=".16" />
            <stop offset="100%" stopColor="var(--brand-700)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {scale.ticks.map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={M.left + iw}
              y1={py(t)}
              y2={py(t)}
              stroke={t === 0 && scale.lo < 0 ? "var(--ink-300)" : GRID}
              strokeWidth="1"
            />
            <text x={M.left - 10} y={py(t) + 3.5} textAnchor="end" fontSize="10" fill={AXIS}>
              {fmt(t, measure.format, true)}
            </text>
          </g>
        ))}

        {xIdx.map((i) => (
          <text key={i} x={px(i)} y={height - 9} textAnchor="middle" fontSize="10" fill={AXIS}>
            {bucketText(data.labels[i], data.gran)}
          </text>
        ))}

        {isBar ? (
          <g>
            {a.map((v, i) => (
              <rect
                key={`a${i}`}
                x={compare ? px(i) - barW - 1 : px(i) - barW / 2}
                y={Math.min(py(v), zeroY)}
                width={barW}
                height={Math.max(1, Math.abs(py(v) - zeroY))}
                rx={Math.min(2, barW / 2)}
                fill="var(--brand-700)"
                opacity={at == null || at === i ? 1 : 0.42}
              />
            ))}
            {b &&
              b.map((v, i) => (
                <rect
                  key={`b${i}`}
                  x={px(i) + 1}
                  y={Math.min(py(v), zeroY)}
                  width={barW}
                  height={Math.max(1, Math.abs(py(v) - zeroY))}
                  rx={Math.min(2, barW / 2)}
                  fill="var(--ink-300)"
                  opacity={at == null || at === i ? 1 : 0.42}
                />
              ))}
          </g>
        ) : (
          <g>
            <path
              d={`${linePath(a)} L ${px(n - 1)} ${zeroY} L ${px(0)} ${zeroY} Z`}
              fill="url(#dtArea)"
              stroke="none"
            />
            {b && (
              <path
                className="dt-draw"
                pathLength={1}
                d={linePath(b)}
                fill="none"
                stroke="var(--ink-400)"
                strokeWidth="1.4"
                strokeDasharray="4 4"
                strokeLinecap="round"
              />
            )}
            <path
              className="dt-draw"
              pathLength={1}
              d={linePath(a)}
              fill="none"
              stroke="var(--brand-700)"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}

        {at != null && (
          <g pointerEvents="none">
            <line
              x1={px(at)}
              x2={px(at)}
              y1={M.top}
              y2={M.top + ih}
              stroke="var(--brand-300)"
              strokeWidth="1"
            />
            {!isBar && (
              <>
                {b && <circle cx={px(at)} cy={py(b[at])} r="3" fill="var(--paper)" stroke="var(--ink-400)" strokeWidth="1.4" />}
                <circle cx={px(at)} cy={py(a[at])} r="3.5" fill="var(--brand-700)" stroke="var(--paper)" strokeWidth="1.5" />
              </>
            )}
          </g>
        )}

        <rect
          x={M.left}
          y={M.top}
          width={iw}
          height={ih}
          fill="transparent"
          onMouseMove={readAt}
          onMouseLeave={() => setAt(null)}
        />
      </svg>

      {at != null && (
        <ChartTip x={px(at)} y={py(Math.max(a[at], b ? b[at] : a[at]))} width={width}>
          <div className="font-medium text-[var(--ink-900)]">
            {bucketFull(data.range1, data.gran, at)}
          </div>
          <TipRow name={compare ? "P1" : measure.label} value={fmt(a[at], measure.format, true)} />
          {b && (
            <>
              <TipRow name="P2" value={fmt(b[at], measure.format, true)} muted />
              <div className="mt-1 border-t border-[var(--ink-200)] pt-1 text-[var(--ink-500)]">
                {bucketFull(data.range2, data.gran, at)}
              </div>
              <TipRow
                name="Selisih"
                value={`${fmt(a[at] - b[at], measure.format, true)}${
                  b[at] ? ` · ${signedPct((a[at] - b[at]) / b[at])}` : ""
                }`}
              />
            </>
          )}
        </ChartTip>
      )}
    </>
  );
}

/* --- kontribusi per anggota dimensi ------------------------------------- */

function DimChart({ nodes, measure, compare, width, height }) {
  const [at, setAt] = useState(null);

  const M = { top: 6, right: 104, bottom: 6, left: 138 };
  const iw = Math.max(60, width - M.left - M.right);
  const ih = Math.max(40, height - M.top - M.bottom);
  const rowH = Math.max(16, Math.min(34, ih / Math.max(1, nodes.length)));
  const used = rowH * nodes.length;

  const scale = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const nd of nodes) {
      if (nd.value < lo) lo = nd.value;
      if (nd.value > hi) hi = nd.value;
    }
    return niceScale(lo, hi);
  }, [nodes]);

  const x = (v) => M.left + ((v - scale.lo) / (scale.hi - scale.lo || 1)) * iw;
  const x0 = x(0);
  const y = (i) => M.top + (ih - used) / 2 + i * rowH;

  return (
    <>
      <svg width={width} height={height} role="img" aria-label={`Kontribusi ${measure.label}`}>
        <line x1={x0} x2={x0} y1={M.top} y2={M.top + ih} stroke="var(--ink-300)" strokeWidth="1" />

        {nodes.map((nd, i) => {
          const neg = nd.value < 0;
          const bw = Math.max(1.5, Math.abs(x(nd.value) - x0));
          const top = y(i) + rowH * 0.22;
          const bh = rowH * 0.56;
          const dim = at != null && at !== i;
          return (
            <g
              key={nd.label}
              onMouseEnter={() => setAt(i)}
              onMouseLeave={() => setAt((k) => (k === i ? null : k))}
            >
              <rect x={0} y={y(i)} width={width} height={rowH} fill={at === i ? "var(--brand-50)" : "transparent"} />
              <text
                x={M.left - 12}
                y={y(i) + rowH / 2 + 3.5}
                textAnchor="end"
                fontSize="11"
                fill={at === i ? "var(--brand-700)" : "var(--ink-700)"}
              >
                {clip(nd.label, 20)}
              </text>
              <rect
                x={neg ? x0 - bw : x0}
                y={top}
                width={bw}
                height={bh}
                rx="2"
                fill={compare ? (neg ? "var(--neg)" : "var(--pos)") : "var(--brand-700)"}
                opacity={dim ? 0.38 : 1}
                style={{ transition: "opacity .18s ease" }}
              />
              <text
                x={width - 12}
                y={y(i) + rowH / 2 + 3.5}
                textAnchor="end"
                fontSize="11"
                fill={
                  compare
                    ? neg
                      ? "var(--neg)"
                      : "var(--pos)"
                    : "var(--ink-900)"
                }
              >
                {fmt(nd.value, measure.format, true)}
              </text>
            </g>
          );
        })}
      </svg>

      {at != null && nodes[at] && (
        <ChartTip x={Math.min(x(nodes[at].value), width - 180)} y={y(at) + rowH} width={width}>
          <div className="font-medium text-[var(--ink-900)]">{nodes[at].label}</div>
          {compare ? (
            <>
              <TipRow name="P1" value={fmt(nodes[at].p1, measure.format, true)} />
              <TipRow name="P2" value={fmt(nodes[at].p2, measure.format, true)} muted />
              <TipRow
                name="Selisih"
                value={`${fmt(nodes[at].value, measure.format, true)}${
                  nodes[at].pct == null ? "" : ` · ${signedPct(nodes[at].pct)}`
                }`}
              />
            </>
          ) : (
            <TipRow name={measure.label} value={fmt(nodes[at].value, measure.format, true)} />
          )}
        </ChartTip>
      )}
    </>
  );
}

/* --- jembatan: dari total P2 ke total P1 -------------------------------- */

function BridgeChart({ steps, startVal, endVal, measure, width, height }) {
  const [at, setAt] = useState(null);

  const M = { top: 16, right: 16, bottom: 34, left: 74 };
  const iw = Math.max(60, width - M.left - M.right);
  const ih = Math.max(60, height - M.top - M.bottom);

  const cols = useMemo(() => {
    const out = [{ label: "Total P2", kind: "total", from: 0, to: startVal, value: startVal }];
    let run = startVal;
    for (const s of steps) {
      out.push({ label: s.label, kind: "step", from: run, to: run + s.value, value: s.value });
      run += s.value;
    }
    out.push({ label: "Total P1", kind: "total", from: 0, to: endVal, value: endVal });
    return out;
  }, [steps, startVal, endVal]);

  const scale = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const c of cols) {
      lo = Math.min(lo, c.from, c.to);
      hi = Math.max(hi, c.from, c.to);
    }
    return niceScale(lo, hi);
  }, [cols]);

  const band = iw / cols.length;
  const bw = Math.max(6, band * 0.58);
  const cx0 = (i) => M.left + band * (i + 0.5);
  const py = (v) => M.top + ih - ((v - scale.lo) / (scale.hi - scale.lo || 1)) * ih;

  return (
    <>
      <svg width={width} height={height} role="img" aria-label="Jembatan selisih">
        {scale.ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={M.left + iw} y1={py(t)} y2={py(t)} stroke={GRID} strokeWidth="1" />
            <text x={M.left - 10} y={py(t) + 3.5} textAnchor="end" fontSize="10" fill={AXIS}>
              {fmt(t, measure.format, true)}
            </text>
          </g>
        ))}

        {cols.map((c, i) => {
          if (i === cols.length - 1) return null;
          const yTo = py(c.to);
          return (
            <line
              key={`c${i}`}
              x1={cx0(i) - bw / 2}
              x2={cx0(i + 1) + bw / 2}
              y1={yTo}
              y2={yTo}
              stroke="var(--ink-300)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          );
        })}

        {cols.map((c, i) => {
          const yA = py(c.from);
          const yB = py(c.to);
          const neg = c.kind === "step" && c.value < 0;
          const fill =
            c.kind === "total"
              ? i === 0
                ? "var(--ink-300)"
                : "var(--brand-700)"
              : neg
              ? "var(--neg)"
              : "var(--pos)";
          return (
            <g
              key={c.label + i}
              onMouseEnter={() => setAt(i)}
              onMouseLeave={() => setAt((k) => (k === i ? null : k))}
            >
              <rect
                x={cx0(i) - bw / 2}
                y={Math.min(yA, yB)}
                width={bw}
                height={Math.max(2, Math.abs(yB - yA))}
                rx="2"
                fill={fill}
                opacity={at == null || at === i ? 1 : 0.42}
                style={{ transition: "opacity .18s ease" }}
              />
              <text
                x={cx0(i)}
                y={height - 20}
                textAnchor="middle"
                fontSize="10"
                fill={at === i ? "var(--brand-700)" : AXIS}
              >
                {clip(c.label, Math.max(4, Math.floor(band / 6.6)))}
              </text>
              <text
                x={cx0(i)}
                y={height - 7}
                textAnchor="middle"
                fontSize="10"
                fill={c.kind === "total" ? "var(--ink-600)" : neg ? "var(--neg)" : "var(--pos)"}
              >
                {fmt(c.value, measure.format, true)}
              </text>
            </g>
          );
        })}
      </svg>

      {at != null && cols[at] && (
        <ChartTip x={cx0(at)} y={py(Math.max(cols[at].from, cols[at].to))} width={width}>
          <div className="font-medium text-[var(--ink-900)]">{cols[at].label}</div>
          <TipRow
            name={cols[at].kind === "total" ? measure.label : "Sumbangan"}
            value={fmt(cols[at].value, measure.format, true)}
          />
          {cols[at].kind === "step" && startVal !== 0 && (
            <TipRow name="Dari total P2" value={signedPct(cols[at].value / startVal)} muted />
          )}
        </ChartTip>
      )}
    </>
  );
}

/* --- panel: pemilih grafik, granularitas, dan dimensi -------------------- */

/** Sisakan k anggota terbesar, sisanya dilebur jadi satu baris. */
function topWithRest(nodes, k) {
  if (nodes.length <= k + 1) return nodes.slice().sort((a, b) => b.value - a.value);
  const byMag = nodes.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const rest = byMag.slice(k);
  const acc = { label: `${rest.length} lainnya`, value: 0, p1: 0, p2: 0, pct: null };
  for (const r of rest) {
    acc.value += r.value;
    acc.p1 += r.p1 || 0;
    acc.p2 += r.p2 || 0;
  }
  if (acc.p2) acc.pct = (acc.p1 - acc.p2) / acc.p2;
  return [...byMag.slice(0, k), acc].sort((a, b) => b.value - a.value);
}

function ChartPanel({ rows, measure, compare, p1, dimensions, trailText, open, onToggle }) {
  const [kind, setKind] = useState("line");
  const [granPick, setGranPick] = useState("auto");
  const [dim, setDim] = useState(dimensions[0]);

  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const height = 212;

  const range1 = compare ? compare.p1 : { from: p1.from, to: p1.to };
  const range2 = compare ? compare.p2 : null;
  const span = daysBetween(range1.from, range1.to);

  const autoGran = span <= 200 ? "day" : span <= 900 ? "week" : "month";
  let gran = granPick === "auto" ? autoGran : granPick;
  if (gran === "day" && span > 1500) gran = "week"; // jaga-jaga, bukan batas keras

  const kinds = CHART_KINDS.filter((k) => !k.cmpOnly || compare);
  const activeKind = kinds.some((k) => k.key === kind) ? kind : "line";
  const isTime = activeKind === "line" || activeKind === "cumulative" || activeKind === "bar";
  const needsDim = activeKind === "contribution" || activeKind === "bridge";

  /* --- deret waktu, kedua periode disejajarkan per nomor ember --- */
  const timeData = useMemo(() => {
    if (!range1.from || !range1.to) return null;
    const n = Math.max(bucketCount(range1, gran), range2 ? bucketCount(range2, gran) : 0);
    if (!n) return null;

    const a = new Array(n).fill(0);
    const b = range2 ? new Array(n).fill(0) : null;

    for (const row of rows) {
      const d = row.__d;
      if (!d) continue;
      const v = Number(row[measure.field]) || 0;
      if (inRange(d, range1)) {
        const i = bucketIndex(d, range1, gran);
        if (i >= 0 && i < n) a[i] += v;
      }
      if (b && inRange(d, range2)) {
        const i = bucketIndex(d, range2, gran);
        if (i >= 0 && i < n) b[i] += v;
      }
    }

    const labels = Array.from({ length: n }, (_, i) => bucketStart(range1, gran, i));
    return { a, b, labels, gran, range1, range2 };
  }, [rows, measure.field, gran, range1.from, range1.to, range2?.from, range2?.to]);

  const dimNodes = useMemo(() => {
    if (!needsDim) return null;
    const all = aggregate(rows, dim, measure.field, compare);
    return topWithRest(all, activeKind === "bridge" ? 7 : 10);
  }, [rows, dim, measure.field, compare, needsDim, activeKind]);

  const totals = useMemo(() => totalsOf(rows, measure.field, compare), [rows, measure.field, compare]);

  const spark = useMemo(() => {
    if (open || !timeData) return null;
    return timeData;
  }, [open, timeData]);

  const legend = compare ? (
    isTime ? (
      <span className={cx("flex items-center gap-3 text-[11px]", MUTED)}>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-[var(--brand-700)]" />P1
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0 w-4 border-t border-dashed border-[var(--ink-400)]" />P2
        </span>
      </span>
    ) : (
      <span className={cx("flex items-center gap-3 text-[11px]", MUTED)}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[var(--pos)]" />naik
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-[var(--neg)]" />turun
        </span>
      </span>
    )
  ) : null;

  const empty = isTime ? !timeData : !dimNodes || !dimNodes.length;

  return (
    <section className="border-b border-[var(--ink-200)] bg-[var(--paper)]">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <button
          className={cx(BTN_QUIET, "flex items-center gap-1.5 font-medium")}
          type="button"
          onClick={onToggle}
          aria-expanded={open}
        >
          <svg
            className={cx("h-2.5 w-2.5 transition-transform duration-200", !open && "-rotate-90")}
            viewBox="0 0 10 6"
            fill="none"
            aria-hidden="true"
          >
            <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          Grafik
        </button>

        <select
          className={SELECT}
          value={activeKind}
          onChange={(e) => setKind(e.target.value)}
          aria-label="Jenis grafik"
        >
          {kinds.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>

        {isTime && (
          <select
            className={SELECT}
            value={granPick}
            onChange={(e) => setGranPick(e.target.value)}
            aria-label="Rentang tiap titik"
          >
            {GRANS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.key === "auto" ? `Otomatis, ${GRAN_WORD[autoGran]}` : g.label}
              </option>
            ))}
          </select>
        )}

        {needsDim && (
          <select
            className={SELECT}
            value={dim}
            onChange={(e) => setDim(e.target.value)}
            aria-label="Dimensi yang dipecah"
          >
            {dimensions.map((d) => (
              <option key={d} value={d}>
                {labelOf(d)}
              </option>
            ))}
          </select>
        )}

        {open && legend}

        <div className="ml-auto flex items-center gap-3">
          <span className={cx("text-[11px]", MUTED)}>{trailText}</span>
          {spark && <Sparkline a={spark.a} b={spark.b} />}
        </div>
      </div>

      {open && (
        <div className="relative pb-2" ref={wrapRef}>
          {empty ? (
            <div className={cx("px-3 py-10 text-center text-xs", MUTED)}>
              Tidak ada baris pada rentang ini.
            </div>
          ) : isTime ? (
            <TimeChart
              data={timeData}
              measure={measure}
              compare={compare}
              kind={activeKind}
              width={width}
              height={height}
            />
          ) : activeKind === "contribution" ? (
            <DimChart
              nodes={dimNodes}
              measure={measure}
              compare={compare}
              width={width}
              height={height}
            />
          ) : (
            <BridgeChart
              steps={dimNodes}
              startVal={totals.p2 || 0}
              endVal={totals.p1 || 0}
              measure={measure}
              width={width}
              height={height}
            />
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- DateRange   */

function DateRange({ tone, name, value, min, max, onChange }) {
  const days = daysBetween(value.from, value.to);
  const p1 = tone === "p1";
  return (
    <div className={cx(CARD, "dt-shadow flex items-center gap-2 px-2.5 py-1.5")}>
      <span
        className={cx(
          "h-2 w-2 shrink-0 rounded-full",
          p1 ? "bg-[var(--brand-700)]" : "border border-[var(--ink-400)] bg-[var(--paper)]"
        )}
      />
      <span
        className={cx(
          "text-[11px] font-medium",
          p1 ? "text-[var(--brand-700)]" : "text-[var(--ink-600)]"
        )}
      >
        {name}
      </span>
      <input
        className={FIELD}
        type="date"
        value={value.from || ""}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        aria-label={`${name}, tanggal mulai`}
      />
      <span className="text-[var(--ink-300)]">–</span>
      <input
        className={FIELD}
        type="date"
        value={value.to || ""}
        min={min || undefined}
        max={max || undefined}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        aria-label={`${name}, tanggal akhir`}
      />
      {days > 0 && (
        <span className="rounded-full bg-[var(--ink-100)] px-2 py-0.5 text-[10px] font-medium text-[var(--ink-600)]">
          {days} hari
        </span>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Slicer   */

function Slicer({ dim, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

  const shown = useMemo(() => {
    if (!q.trim()) return options;
    const needle = q.trim().toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(needle));
  }, [options, q]);

  const active = selected.size > 0;
  const summary = !active
    ? "Semua"
    : selected.size === 1
    ? Array.from(selected)[0]
    : `${selected.size} dipilih`;

  const toggle = (val) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    onChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className={cx(
          "dt-shadow flex max-w-[240px] items-center gap-2 rounded-full border px-3 py-1.5 transition-colors",
          FOCUS,
          active
            ? "border-[var(--brand-600)] bg-[var(--brand-50)]"
            : `${LINE} bg-[var(--paper)] hover:border-[var(--brand-300)]`
        )}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={cx(
            "text-xs font-medium",
            active ? "text-[var(--brand-700)]" : "text-[var(--ink-800)]"
          )}
        >
          {labelOf(dim)}
        </span>
        <span
          className={cx(
            "truncate text-xs",
            active ? "text-[var(--brand-600)]" : "text-[var(--ink-500)]"
          )}
        >
          {summary}
        </span>
        <svg
          className={cx(
            "h-2.5 w-2.5 shrink-0 transition-transform duration-200",
            open && "rotate-180",
            active ? "text-[var(--brand-500)]" : "text-[var(--ink-400)]"
          )}
          viewBox="0 0 10 6"
          fill="none"
          aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className={cx(
            MENU,
            "dt-pop absolute left-0 top-[calc(100%+6px)] z-40 flex max-h-80 w-[260px] origin-top flex-col"
          )}
        >
          <input
            className={cx(
              "m-1 rounded-lg border bg-[var(--ink-50)] px-2.5 py-2 text-xs text-[var(--ink-900)] transition-colors focus:border-[var(--brand-400)] focus:bg-[var(--paper)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-200)]",
              LINE
            )}
            placeholder={`Cari ${labelOf(dim).toLowerCase()}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="dt-scroll overflow-auto px-1 pb-1">
            {shown.map((opt) => {
              const on = selected.has(opt);
              return (
                <button
                  key={opt}
                  className={cx(MENU_ITEM, on && "text-[var(--brand-700)]")}
                  type="button"
                  onClick={() => toggle(opt)}
                >
                  <span
                    className={cx(
                      "grid h-4 w-4 flex-none place-items-center rounded border transition-colors",
                      on
                        ? "border-[var(--brand-700)] bg-[var(--brand-700)] text-white"
                        : "border-[var(--ink-300)] bg-[var(--paper)]"
                    )}
                  >
                    {on && (
                      <svg className="h-2.5 w-2.5" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                        <path
                          d="M1 4l2.5 2.5L9 1"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{opt}</span>
                </button>
              );
            })}
            {!shown.length && (
              <div className={cx("px-2.5 py-3 text-xs", MUTED)}>Tidak ada yang cocok</div>
            )}
          </div>
          <div className={cx("flex gap-1 border-t px-1 py-1", LINE)}>
            <button className={BTN_QUIET} type="button" onClick={() => onChange(new Set(options))}>
              Pilih semua
            </button>
            <button className={BTN_QUIET} type="button" onClick={() => onChange(new Set())}>
              Bersihkan
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ SplitMenu    */

/**
 * Menu "uraikan". Dirender lewat portal ke <body> dengan posisi terkunci ke
 * layar, bukan di dalam kanvas.
 *
 * Alasannya: kanvas punya overflow-auto. Menu absolut di dalamnya akan
 * terpotong begitu tingginya melebihi ruang yang tersisa — itulah kenapa baris
 * pertama sempat hilang saat tombol + ditekan di node paling atas. Dengan
 * portal, satu-satunya batas adalah jendela browser, dan posisinya dijepit
 * supaya seluruh isi menu selalu terbaca.
 *
 * Menu tumbuh ke bawah dari tepi atas node, bukan dari titik tengahnya, jadi
 * baris pertama muncul lebih dulu dan baris terakhirlah yang bergeser kalau
 * ruangnya kurang.
 */
function SplitMenu({ anchorEl, dims, onPick, onAi, onClose }) {
  const boxRef = useRef(null);
  const [pos, setPos] = useState(null);

  const place = useCallback(() => {
    const box = boxRef.current;
    if (!box || !anchorEl) return;
    const a = anchorEl.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const pad = 12;

    let top = a.top - 6;
    if (top + h > window.innerHeight - pad) top = window.innerHeight - h - pad;
    if (top < pad) top = pad;

    // Menu menumpuk di atas node yang diuraikan, seperti Power BI. Kalau mepet
    // tepi kanan, dibalik ke sisi kiri node.
    let left = a.left + 14;
    if (left + w > window.innerWidth - pad) left = a.right - w - 14;
    if (left < pad) left = pad;

    setPos({ top, left });
  }, [anchorEl]);

  useLayoutEffect(() => {
    place();
  }, [place, dims]);

  useEffect(() => {
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  useClickOutside(boxRef, onClose, true, "[data-dt-split]");

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className={ROOT_CLASS} style={ROOT_FONT}>
      <div
        className={cx(MENU, "dt-pop dt-scroll fixed z-[9999] max-h-[min(70vh,520px)] w-[238px] origin-top-left overflow-auto")}
        style={{
          top: pos ? pos.top : 0,
          left: pos ? pos.left : 0,
          visibility: pos ? "visible" : "hidden",
        }}
        ref={boxRef}
        role="menu"
      >
        <div className={cx("px-2.5 pb-1 pt-1.5 text-[11px]", MUTED)}>Biar dicarikan</div>
        <button className={MENU_ITEM} type="button" onClick={() => onAi("high")}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pos)]" />
          Dimensi dengan nilai tertinggi
        </button>
        <button className={MENU_ITEM} type="button" onClick={() => onAi("low")}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--neg)]" />
          Dimensi dengan nilai terendah
        </button>

        {dims.length > 0 && <div className="mx-1 my-1 h-px bg-[var(--ink-200)]" />}
        {dims.length > 0 && (
          <div className={cx("px-2.5 pb-1 pt-1.5 text-[11px]", MUTED)}>Uraikan berdasarkan</div>
        )}
        {dims.map((d) => (
          <button key={d} className={MENU_ITEM} type="button" onClick={() => onPick(d)}>
            {labelOf(d)}
          </button>
        ))}
        {dims.length === 0 && (
          <div className={cx("px-2.5 py-2 text-xs", MUTED)}>Semua dimensi sudah dipakai</div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* --------------------------------------------------------- komponen utama  */

const PLUS_BASE = `absolute -right-3 top-1/2 z-[3] grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full border transition-all duration-200 hover:scale-110 active:scale-95 ${FOCUS}`;

/** Tanda merek: satu akar yang bercabang dua. */
function Mark({ className }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden="true">
      <path
        d="M3.4 10h2.1c1.6 0 1.6-3.6 3.2-3.6h2.3M5.5 10c1.6 0 1.6 3.6 3.2 3.6h2.3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="2.6" cy="10" r="1.7" fill="currentColor" />
      <circle cx="12.6" cy="6.4" r="1.7" fill="currentColor" />
      <circle cx="12.6" cy="13.6" r="1.7" fill="currentColor" />
      <circle cx="17.4" cy="6.4" r="1.1" fill="currentColor" opacity=".55" />
      <circle cx="17.4" cy="13.6" r="1.1" fill="currentColor" opacity=".55" />
    </svg>
  );
}

export function DecompositionTree({
  rows = [],
  dimensions = DIMENSIONS,
  slicerDims = SLICERS,
  measures = MEASURES,
  nodeLimit = NODE_LIMIT,
}) {
  const [measureKey, setMeasureKey] = useState(measures[0].key);
  const measure = measures.find((m) => m.key === measureKey) || measures[0];

  const [levels, setLevels] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [menuAt, setMenuAt] = useState(null);
  const [shareMode, setShareMode] = useState("parent");
  const [hoverKey, setHoverKey] = useState(null);
  const [chartOpen, setChartOpen] = useState(true);

  // Rentang tanggal — inilah padanan slicer Date dan Cmp Date di Power BI.
  const [cmpOn, setCmpOn] = useState(false);
  const [p1, setP1] = useState({ from: "", to: "" });
  const [p2, setP2] = useState({ from: "", to: "" });

  const [slicers, setSlicers] = useState(() =>
    Object.fromEntries(slicerDims.map((d) => [d, new Set()]))
  );

  /* --- batas tanggal yang ada di data --- */
  const bounds = useMemo(() => {
    let min = null;
    let max = null;
    for (const r of rows) {
      const d = r.__d;
      if (!d) continue;
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    return { min, max };
  }, [rows]);

  const hasDates = !!bounds.min;

  /* --- isi rentang awal sekali saja, setelah data termuat --- */
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current || !bounds.max) return;
    initRef.current = true;
    const to = bounds.max;
    const from0 = startOfMonth(shiftMonths(to, -5)); // enam bulan terakhir
    const from = from0 < bounds.min ? bounds.min : from0;
    setP1({ from, to });
    setP2({ from: shiftYears(from, -1), to: shiftYears(to, -1) });
  }, [bounds]);

  /* --- preset ---
     Acuannya adalah tanggal di kotak "dari" pada P1, yaitu tanggal yang
     kamu pilih sendiri. Kalau masih kosong, dipakai tanggal terakhir
     yang ada di data. */
  const [lastPreset, setLastPreset] = useState(null);

  const anchor = p1.from || p1.to || bounds.max || null;

  const applyPreset = useCallback(
    (kind) => {
      const res = computePreset(kind, anchor, p1);
      if (!res) return;
      const [a, b] = res;
      setP1(a);
      setP2(b);
      setLastPreset(kind);
      setCmpOn(true);
    },
    [anchor, p1]
  );

  // Samakan panjang P2 dengan P1, dihitung mundur dari tanggal akhir P2.
  const matchLength = useCallback(() => {
    const n = daysBetween(p1.from, p1.to);
    if (!n || !p2.to) return;
    setP2((prev) => ({ ...prev, from: shiftDays(prev.to, -(n - 1)) }));
  }, [p1.from, p1.to, p2.to]);

  /* --- objek compare, identitas stabil lewat useMemo --- */
  const compare = useMemo(() => {
    if (!cmpOn) return null;
    if (!p1.from || !p1.to || !p2.from || !p2.to) return null;
    return { p1: { from: p1.from, to: p1.to }, p2: { from: p2.from, to: p2.to } };
  }, [cmpOn, p1.from, p1.to, p2.from, p2.to]);

  /* --- terapkan slicer dimensi lalu filter tanggal --- */
  const scoped = useMemo(() => {
    let out = rows;

    const active = Object.entries(slicers).filter(([, set]) => set.size > 0);
    if (active.length) {
      out = out.filter((r) => active.every(([dim, set]) => set.has(keyOf(r, dim))));
    }

    if (compare) {
      // Ambil baris yang masuk salah satu rentang; pemisahannya di aggregate().
      out = out.filter((r) => inRange(r.__d, compare.p1) || inRange(r.__d, compare.p2));
    } else if (hasDates && p1.from && p1.to) {
      out = out.filter((r) => inRange(r.__d, p1));
    }

    return out;
  }, [rows, slicers, compare, p1, hasDates]);

  const grandTotals = useMemo(
    () => totalsOf(scoped, measure.field, compare),
    [scoped, measure.field, compare]
  );
  const grandTotal = grandTotals.value;

  const levelData = useMemo(() => {
    const out = [];
    let scope = scoped;
    for (let i = 0; i < levels.length; i++) {
      const { dim, sort } = levels[i];
      const nodes = sortNodes(aggregate(scope, dim, measure.field, compare), sort);
      const total = totalOf(scope, measure.field, compare);
      const max = nodes.reduce((m, n) => Math.max(m, Math.abs(n.value)), 0);
      out.push({ nodes, total, max });
      const picked = levels[i].selected;
      if (picked == null) break;
      scope = scope.filter((r) => keyOf(r, dim) === picked);
    }
    return out;
  }, [scoped, levels, measure.field, compare]);

  /**
   * Lingkup yang sedang difokuskan pohon: slicer, rentang tanggal, lalu setiap
   * node yang sudah dipilih di jalur. Grafik memakai ini, jadi menekan sebuah
   * node langsung mempersempit grafiknya juga.
   */
  const focusScope = useMemo(() => {
    let out = scoped;
    for (const l of levels) {
      if (l.selected == null) break;
      out = out.filter((r) => keyOf(r, l.dim) === l.selected);
    }
    return out;
  }, [scoped, levels]);

  /** Pilihan slicer dihitung sekali dari data mentah, bukan tiap render. */
  const slicerOptions = useMemo(() => {
    const out = {};
    for (const d of slicerDims) {
      const s = new Set();
      for (const row of rows) s.add(keyOf(row, d));
      out[d] = Array.from(s).sort((a, b) => a.localeCompare(b, "id"));
    }
    return out;
  }, [rows, slicerDims]);

  const scopeFor = useCallback(
    (levelIndex, label) => {
      let scope = scoped;
      for (let i = 0; i < levelIndex; i++) {
        scope = scope.filter((r) => keyOf(r, levels[i].dim) === levels[i].selected);
      }
      if (levelIndex >= 0) {
        scope = scope.filter((r) => keyOf(r, levels[levelIndex].dim) === label);
      }
      return scope;
    },
    [scoped, levels]
  );

  const unusedAt = useCallback(
    (levelIndex) => {
      const used = new Set(levels.slice(0, levelIndex + 1).map((l) => l.dim));
      return dimensions.filter((d) => !used.has(d));
    },
    [levels, dimensions]
  );

  /* --- aksi --- */

  const splitFrom = useCallback((levelIndex, label, dim) => {
    setLevels((prev) => {
      const next = prev.slice(0, levelIndex + 1);
      if (levelIndex >= 0) next[levelIndex] = { ...next[levelIndex], selected: label };
      return [...next, { dim, selected: null, sort: "desc" }];
    });
    setMenuAt(null);
  }, []);

  const aiSplit = useCallback(
    (levelIndex, label, mode) => {
      const scope = scopeFor(levelIndex, label);
      const candidates = unusedAt(levelIndex);
      let best = null;
      for (const dim of candidates) {
        const nodes = aggregate(scope, dim, measure.field, compare);
        if (!nodes.length) continue;
        const pick = mode === "high" ? nodes[0] : nodes[nodes.length - 1];
        if (!best || (mode === "high" ? pick.value > best.value : pick.value < best.value)) {
          best = { dim, ...pick };
        }
      }
      if (!best) {
        setMenuAt(null);
        return;
      }
      setLevels((prev) => {
        const next = prev.slice(0, levelIndex + 1);
        if (levelIndex >= 0) next[levelIndex] = { ...next[levelIndex], selected: label };
        return [...next, { dim: best.dim, selected: best.label, sort: "desc" }];
      });
      setMenuAt(null);
    },
    [scopeFor, unusedAt, measure.field, compare]
  );

  const pickNode = useCallback((levelIndex, label) => {
    setLevels((prev) => {
      const next = prev.slice(0, levelIndex + 1);
      const already = next[levelIndex].selected === label;
      next[levelIndex] = { ...next[levelIndex], selected: already ? null : label };
      return next;
    });
  }, []);

  const changeDim = useCallback((levelIndex, dim) => {
    setLevels((prev) => {
      const next = prev.slice(0, levelIndex + 1);
      next[levelIndex] = { dim, selected: null, sort: next[levelIndex].sort };
      return next;
    });
  }, []);

  const cycleSort = useCallback((levelIndex) => {
    setLevels((prev) => {
      const next = prev.slice();
      const order = { desc: "asc", asc: "name", name: "desc" };
      next[levelIndex] = { ...next[levelIndex], sort: order[next[levelIndex].sort] || "desc" };
      return next;
    });
  }, []);

  const removeLevel = useCallback((levelIndex) => {
    setLevels((prev) => prev.slice(0, levelIndex));
  }, []);

  const reset = useCallback(() => {
    setLevels([]);
    setExpanded({});
    setMenuAt(null);
  }, []);

  const clearSlicers = useCallback(() => {
    setSlicers(Object.fromEntries(slicerDims.map((d) => [d, new Set()])));
  }, [slicerDims]);

  /* --- garis penghubung --- */

  const canvasRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const [links, setLinks] = useState([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const sigRef = useRef("");

  const setNodeRef = useCallback(
    (key) => (el) => {
      if (el) nodeRefs.current.set(key, el);
      else nodeRefs.current.delete(key);
    },
    []
  );

  const measureLinks = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const base = canvas.getBoundingClientRect();
    const next = [];

    for (let i = 0; i < levelData.length; i++) {
      const parentKey = i === 0 ? "root" : `${i - 1}:${levels[i - 1].selected}`;
      const parentEl = nodeRefs.current.get(parentKey);
      if (!parentEl) continue;
      const pr = parentEl.getBoundingClientRect();
      const x1 = pr.right - base.left;
      const y1 = pr.top - base.top + pr.height / 2;

      for (const node of levelData[i].nodes) {
        const el = nodeRefs.current.get(`${i}:${node.label}`);
        if (!el) continue;
        const cr = el.getBoundingClientRect();
        const x2 = cr.left - base.left;
        const y2 = cr.top - base.top + cr.height / 2;
        const mid = x1 + (x2 - x1) / 2;
        next.push({
          key: `${i}:${node.label}`,
          d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
          on: levels[i].selected === node.label,
        });
      }
    }

    // Hanya perbarui state kalau geometrinya benar-benar berubah,
    // supaya tidak terjadi render loop.
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const sig = `${w}x${h}|${next.map((l) => `${l.key}~${l.on}~${l.d}`).join("|")}`;
    if (sig === sigRef.current) return;
    sigRef.current = sig;

    setLinks(next);
    setCanvasSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [levelData, levels]);

  useLayoutEffect(() => {
    measureLinks();
  }, [measureLinks, expanded, shareMode, compare]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measureLinks());
    ro.observe(canvas);
    window.addEventListener("resize", measureLinks);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureLinks);
    };
  }, [measureLinks]);

  /* --- render --- */

  if (!rows.length) {
    return (
      <Frame>
        <div className="max-w-[56ch] p-10">
          <h2 className="text-[17px] font-semibold text-[var(--ink-900)]">
            Tidak ada baris untuk diuraikan
          </h2>
          <p className={cx("mt-2", MUTED)}>
            Letakkan <Code>dummy_dataset.csv</Code> di folder <Code>public/</Code>, lalu muat ulang
            halaman.
          </p>
          <p className={cx("mt-2", MUTED)}>
            Kalau berkasnya sudah ada, cocokkan <Code>DIMENSIONS</Code> dan{" "}
            <Code>NUMERIC_FIELDS</Code> di bagian atas berkas ini dengan nama kolom di CSV-nya.
          </p>
        </div>
      </Frame>
    );
  }

  const trail = levels.filter((l) => l.selected != null);
  const trailText = trail.length
    ? `Mengikuti ${trail.map((l) => `${labelOf(l.dim)} ${l.selected}`).join(" › ")}`
    : "Seluruh baris terpilih";
  const anySlicer = Object.values(slicers).some((s) => s.size > 0);
  const sortLabel = { desc: "Nilai ↓", asc: "Nilai ↑", name: "A–Z" };

  const d1 = daysBetween(p1.from, p1.to);
  const d2 = daysBetween(p2.from, p2.to);
  const lengthMismatch = cmpOn && d1 > 0 && d2 > 0 && d1 !== d2;
  const cmpIncomplete = cmpOn && (!p1.from || !p1.to || !p2.from || !p2.to);

  // Peringatkan kalau sebuah periode jatuh sepenuhnya di luar data.
  // Tanpa ini, hasil nol terlihat seperti penurunan drastis, padahal
  // datanya memang tidak ada.
  const offData = (r, name) =>
    hasDates && r.from && r.to && (r.to < bounds.min || r.from > bounds.max) ? name : null;
  const outOfData =
    offData(p1, "Periode P1") || (cmpOn ? offData(p2, "Periode pembanding P2") : null);

  const toneText = (v) =>
    v < 0 ? "text-[var(--neg)]" : v > 0 ? "text-[var(--pos)]" : "text-[var(--ink-600)]";

  const renderNodeBody = (node, level) => {
    const share =
      shareMode === "total"
        ? grandTotal
          ? node.value / grandTotal
          : 0
        : level.total
        ? node.value / level.total
        : 0;
    const width = level.max ? (Math.abs(node.value) / level.max) * 100 : 0;
    const on = node.__on;

    const valueColor = compare ? toneText(node.value) : "text-[var(--ink-900)]";
    const fill = compare
      ? node.value < 0
        ? "dt-fill-neg"
        : "dt-fill-pos"
      : on
      ? "dt-fill"
      : "dt-fill-mute";

    return (
      <>
        <div
          className={cx(
            "truncate text-xs transition-colors",
            on ? "text-[var(--brand-700)]" : "text-[var(--ink-600)]"
          )}
        >
          {node.label}
        </div>

        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className={cx("text-[16px] font-semibold tracking-[-.015em]", valueColor)}>
            {fmt(node.value, measure.format, true)}
          </span>
          {compare && node.pct != null && (
            <span
              className={cx(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                node.value < 0
                  ? "bg-[var(--neg-bg)] text-[var(--neg)]"
                  : "bg-[var(--pos-bg)] text-[var(--pos)]"
              )}
            >
              {signedPct(node.pct)}
            </span>
          )}
        </div>

        {compare && (
          <div
            className={cx(
              "mt-1.5 grid grid-cols-2 gap-x-2 border-t pt-1.5 text-[11px]",
              LINE
            )}
          >
            <div>
              <div className="text-[var(--ink-500)]">P1</div>
              <div className="font-medium text-[var(--ink-900)]">
                {fmt(node.p1, measure.format, true)}
              </div>
            </div>
            <div>
              <div className="text-[var(--ink-500)]">P2</div>
              <div className="font-medium text-[var(--ink-600)]">
                {fmt(node.p2, measure.format, true)}
              </div>
            </div>
          </div>
        )}

        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ink-100)]">
          <div
            className={cx("h-full rounded-full transition-[width] duration-500 ease-out", fill)}
            style={{ width: `${width}%` }}
          />
        </div>

        <div className="mt-1.5 text-[11px] text-[var(--ink-500)]">
          {compare
            ? node.pct == null
              ? "Tidak ada nilai di P2"
              : `dibanding P2`
            : `${nfPct.format(share)} dari ${shareMode === "total" ? "total" : "induk"}`}
        </div>
      </>
    );
  };

  return (
    <Frame>
      {/* ---------------- bilah judul ---------------- */}
      <header className="dt-topbar flex items-center gap-2.5 px-4 py-2.5 text-white">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15">
          <Mark className="h-[18px] w-[18px]" />
        </span>
        <h1 className="text-[13px] font-semibold tracking-[.01em]">Pohon dekomposisi</h1>
        <span className="text-[12px] text-white/55">{measure.label}</span>
        {hasDates && (
          <span className="ml-auto text-[11px] text-white/60">
            Data {dLabel.format(toJs(bounds.min))} – {dLabel.format(toJs(bounds.max))}
          </span>
        )}
      </header>

      {/* ---------------- periode ---------------- */}
      {hasDates ? (
        <div
          className={cx(
            "flex flex-wrap items-center gap-2.5 border-b bg-[var(--paper)] px-4 py-2.5",
            LINE
          )}
        >
          <DateRange
            tone="p1"
            name="Periode"
            value={p1}
            min={bounds.min}
            max={bounds.max}
            onChange={setP1}
          />

          {cmpOn && <DateRange tone="p2" name="Pembanding" value={p2} onChange={setP2} />}

          <select
            className={SELECT}
            value=""
            onChange={(e) => {
              if (e.target.value) applyPreset(e.target.value);
              e.target.value = "";
            }}
            aria-label="Pilih preset periode"
          >
            <option value="">Preset…</option>
            {Array.from(new Set(PRESETS.map((p) => p.group))).map((g) => (
              <optgroup key={g} label={g}>
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {lastPreset && (
            <span className="rounded-full border border-[var(--brand-200)] bg-[var(--brand-50)] px-2.5 py-1 text-[11px] text-[var(--brand-700)]">
              {PRESET_LABEL[lastPreset]}
            </span>
          )}

          <span className={cx("text-[11px]", MUTED)}>
            Preset dihitung dari{" "}
            <b className="font-medium text-[var(--ink-900)]">
              {anchor ? dLabel.format(toJs(anchor)) : "–"}
            </b>
          </span>
        </div>
      ) : (
        <div className={NOTE_BAR}>
          Kolom tanggal tidak terbaca, jadi perbandingan periode dimatikan. Isi{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">DATE_FIELD</code>{" "}
          di bagian atas berkas dengan nama kolom tanggal di CSV kamu.
        </div>
      )}

      {/* ---------------- slicer dimensi ---------------- */}
      <div
        className={cx("flex flex-wrap items-center gap-2 border-b bg-[var(--paper)] px-4 py-2", LINE)}
      >
        <span className={cx("mr-1 text-[11px]", MUTED)}>Saring</span>
        {slicerDims.map((d) => (
          <Slicer
            key={d}
            dim={d}
            options={slicerOptions[d] || []}
            selected={slicers[d] || new Set()}
            onChange={(set) => setSlicers((p) => ({ ...p, [d]: set }))}
          />
        ))}
        <button className={BTN_QUIET} type="button" onClick={clearSlicers} disabled={!anySlicer}>
          Bersihkan semua
        </button>
      </div>

      {/* ---------------- catatan ---------------- */}
      {lengthMismatch && (
        <div className={NOTE_BAR}>
          <span>
            Panjang periode berbeda — P1 {d1} hari, P2 {d2} hari. Selisihnya jadi tidak setara.
          </span>
          <button
            className="rounded-md border border-current px-2 py-0.5 text-[11px] transition-colors hover:bg-white/60"
            type="button"
            onClick={matchLength}
          >
            Samakan jadi {d1} hari
          </button>
        </div>
      )}
      {cmpIncomplete && (
        <div className={NOTE_BAR}>Lengkapi kedua tanggal P1 dan P2 supaya perbandingan aktif.</div>
      )}
      {outOfData && (
        <div className={NOTE_BAR}>
          {outOfData} berada di luar rentang data ({dLabel.format(toJs(bounds.min))} –{" "}
          {dLabel.format(toJs(bounds.max))}), jadi nilainya nol.
        </div>
      )}

      {/* ---------------- ringkasan ---------------- */}
      <div className={cx("flex flex-wrap items-center gap-x-5 gap-y-3 border-b px-4 py-3", LINE)}>
        <select
          className={SELECT}
          value={measureKey}
          onChange={(e) => setMeasureKey(e.target.value)}
          aria-label="Pilih metrik"
        >
          {measures.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>

        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={cx(
                "text-[26px] font-semibold tracking-[-.02em]",
                compare ? toneText(grandTotal) : "text-[var(--brand-700)]"
              )}
            >
              {fmt(grandTotal, measure.format)}
            </span>
            {compare && grandTotals.pct != null && (
              <span
                className={cx(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  grandTotal < 0
                    ? "bg-[var(--neg-bg)] text-[var(--neg)]"
                    : "bg-[var(--pos-bg)] text-[var(--pos)]"
                )}
              >
                {signedPct(grandTotals.pct)}
              </span>
            )}
          </div>
          <div className={cx("mt-0.5 text-[11px]", MUTED)}>
            {compare
              ? `${shortRange(compare.p1)} dikurangi ${shortRange(compare.p2)}`
              : `Total ${measure.label.toLowerCase()}, ${shortRange(p1)}`}
          </div>
        </div>

        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            className={BTN}
            type="button"
            onClick={() => setShareMode((m) => (m === "parent" ? "total" : "parent"))}
          >
            Porsi dari {shareMode === "parent" ? "induk" : "total"}
          </button>
          <button
            className={cmpOn ? BTN_ON : BTN}
            type="button"
            disabled={!hasDates}
            onClick={() => setCmpOn((v) => !v)}
            aria-pressed={cmpOn}
          >
            Bandingkan periode
          </button>
          <button className={BTN} type="button" onClick={reset} disabled={!levels.length}>
            Mulai ulang
          </button>
        </div>
      </div>

      {/* ---------------- jejak ---------------- */}
      {trail.length > 0 && (
        <div
          className={cx(
            "flex flex-wrap items-center gap-1.5 border-b bg-[var(--paper)] px-4 py-2 text-xs",
            LINE
          )}
        >
          <span className={MUTED}>Jalur</span>
          {trail.map((l, i) => (
            <React.Fragment key={l.dim}>
              {i > 0 && <span className="text-[var(--ink-300)]">›</span>}
              <span className="rounded-full border border-[var(--brand-200)] bg-[var(--brand-50)] px-2.5 py-0.5 font-medium text-[var(--brand-700)]">
                <span className="font-normal text-[var(--ink-500)]">{labelOf(l.dim)} </span>
                {l.selected}
              </span>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ---------------- grafik ---------------- */}
      {hasDates && (
        <ChartPanel
          rows={focusScope}
          measure={measure}
          compare={compare}
          p1={p1}
          dimensions={dimensions}
          trailText={trailText}
          open={chartOpen}
          onToggle={() => setChartOpen((v) => !v)}
        />
      )}

      {/* ---------------- kanvas ---------------- */}
      <div className="dt-canvas dt-scroll flex-1 overflow-auto px-5 pb-8 pt-6">
        <div className="relative flex w-max min-w-full items-start gap-16" ref={canvasRef}>
          <svg
            className="pointer-events-none absolute inset-0 overflow-visible"
            width={canvasSize.w}
            height={canvasSize.h}
            aria-hidden="true"
          >
            {links.map((l) => {
              const hot = l.on || l.key === hoverKey;
              return (
                <path
                  key={l.key}
                  className={cx("dt-draw", hot && "dt-glow")}
                  pathLength={1}
                  d={l.d}
                  fill="none"
                  strokeLinecap="round"
                  stroke={
                    l.on
                      ? "var(--brand-700)"
                      : l.key === hoverKey
                      ? "var(--brand-500)"
                      : "var(--ink-300)"
                  }
                  strokeWidth={hot ? 2 : 1.25}
                  opacity={hot ? 1 : 0.7}
                  style={{ transition: "stroke .18s ease, stroke-width .18s ease, opacity .18s ease" }}
                />
              );
            })}
          </svg>

          {/* akar */}
          <div className="dt-rise relative z-[1] w-[244px] flex-none">
            <div
              className={cx(
                "mb-3 flex h-9 items-center rounded-lg border bg-[var(--ink-50)] px-2.5",
                LINE
              )}
            >
              <span className="truncate text-xs font-semibold text-[var(--ink-800)]">
                {measure.label}
              </span>
            </div>

            <div className="group relative">
              <div
                className={cx(
                  CARD,
                  "dt-shadow relative overflow-hidden px-3 py-2.5 pr-7 border-[var(--brand-200)]"
                )}
                ref={setNodeRef("root")}
              >
                <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-[var(--brand-700)]" />
                <div className="text-xs text-[var(--ink-600)]">
                  {compare ? "Selisih P1 − P2" : "Seluruh data"}
                </div>
                <div
                  className={cx(
                    "mt-1 text-[16px] font-semibold tracking-[-.015em]",
                    compare ? toneText(grandTotal) : "text-[var(--brand-700)]"
                  )}
                >
                  {fmt(grandTotal, measure.format, true)}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--ink-100)]">
                  <div className="dt-fill h-full w-full rounded-full" />
                </div>
                <div className="mt-1.5 text-[11px] text-[var(--ink-500)]">
                  {scoped.length.toLocaleString("id-ID")} baris
                  {anySlicer ? ", tersaring" : ""}
                </div>
              </div>

              <button
                className={cx(
                  PLUS_BASE,
                  menuAt === "root"
                    ? "border-[var(--brand-700)] bg-[var(--brand-700)] text-white"
                    : "border-[var(--ink-300)] bg-[var(--paper)] text-[var(--ink-500)] hover:border-[var(--brand-600)] hover:text-[var(--brand-700)]"
                )}
                type="button"
                data-dt-split=""
                aria-label="Uraikan dari akar"
                aria-expanded={menuAt === "root"}
                onClick={() => setMenuAt((m) => (m === "root" ? null : "root"))}
              >
                <svg className="h-3 w-3" viewBox="0 0 12 12" aria-hidden="true">
                  <path
                    d="M6 1.5v9M1.5 6h9"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {menuAt === "root" && (
                <SplitMenu
                  anchorEl={nodeRefs.current.get("root")}
                  dims={unusedAt(-1)}
                  onPick={(d) => splitFrom(-1, null, d)}
                  onAi={(mode) => aiSplit(-1, null, mode)}
                  onClose={() => setMenuAt(null)}
                />
              )}
            </div>
          </div>

          {/* level */}
          {levelData.map((level, i) => {
            const showAll = expanded[i];
            const visible = showAll ? level.nodes : level.nodes.slice(0, nodeLimit);
            const hidden = level.nodes.length - visible.length;
            const options = [levels[i].dim, ...unusedAt(i)];
            const hasPick = levels[i].selected != null;

            return (
              <div
                className="dt-rise relative z-[1] w-[244px] flex-none"
                key={`${i}-${levels[i].dim}`}
              >
                <div
                  className={cx(
                    "mb-3 flex h-9 items-center gap-0.5 rounded-lg border bg-[var(--ink-50)] pl-1 pr-1",
                    LINE
                  )}
                >
                  <select
                    className={cx(
                      "min-w-0 flex-1 cursor-pointer rounded-md border-0 bg-transparent px-1.5 py-1 text-xs font-semibold text-[var(--ink-800)]",
                      FOCUS
                    )}
                    value={levels[i].dim}
                    onChange={(e) => changeDim(i, e.target.value)}
                    aria-label={`Dimensi untuk level ${i + 1}`}
                  >
                    {options.map((d) => (
                      <option key={d} value={d}>
                        {labelOf(d)}
                      </option>
                    ))}
                  </select>
                  <button
                    className={BTN_QUIET}
                    type="button"
                    onClick={() => cycleSort(i)}
                    title="Ganti urutan"
                  >
                    {sortLabel[levels[i].sort] || "Nilai ↓"}
                  </button>
                  <button
                    className={cx(BTN_QUIET, "hover:text-[var(--neg)]")}
                    type="button"
                    onClick={() => removeLevel(i)}
                    aria-label={`Hapus level ${labelOf(levels[i].dim)}`}
                  >
                    <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" aria-hidden="true">
                      <path
                        d="M1 1l8 8M9 1l-8 8"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {visible.map((node) => {
                    const on = levels[i].selected === node.label;
                    const menuKey = `${i}:${node.label}`;
                    return (
                      <div
                        className="group relative"
                        key={node.label}
                        onMouseEnter={() => setHoverKey(menuKey)}
                        onMouseLeave={() => setHoverKey((k) => (k === menuKey ? null : k))}
                      >
                        <button
                          className={cx(
                            "dt-shadow dt-shadow-lift relative block w-full overflow-hidden rounded-lg border px-3 py-2.5 pr-7 text-left transition-all duration-200 hover:-translate-y-px",
                            FOCUS,
                            on
                              ? "border-[var(--brand-600)] bg-[var(--brand-50)]"
                              : `${LINE} bg-[var(--paper)] hover:border-[var(--brand-300)]`,
                            hasPick && !on ? "opacity-55 hover:opacity-100" : ""
                          )}
                          type="button"
                          ref={setNodeRef(menuKey)}
                          onFocus={() => setHoverKey(menuKey)}
                          onBlur={() => setHoverKey((k) => (k === menuKey ? null : k))}
                          onClick={() => pickNode(i, node.label)}
                          aria-pressed={on}
                          title={`${node.label} — ${fmt(node.value, measure.format)}`}
                        >
                          <span
                            className={cx(
                              "absolute inset-y-2 left-0 w-[3px] rounded-r-full transition-colors",
                              on ? "bg-[var(--brand-700)]" : "bg-transparent"
                            )}
                          />
                          {renderNodeBody({ ...node, __on: on }, level)}
                        </button>

                        <button
                          className={cx(
                            PLUS_BASE,
                            "opacity-70 group-hover:opacity-100 focus-visible:opacity-100",
                            menuAt === menuKey
                              ? "border-[var(--brand-700)] bg-[var(--brand-700)] text-white opacity-100"
                              : "border-[var(--ink-300)] bg-[var(--paper)] text-[var(--ink-500)] hover:border-[var(--brand-600)] hover:text-[var(--brand-700)]"
                          )}
                          type="button"
                          data-dt-split=""
                          aria-label={`Uraikan ${node.label}`}
                          aria-expanded={menuAt === menuKey}
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuAt((m) => (m === menuKey ? null : menuKey));
                          }}
                        >
                          <svg className="h-3 w-3" viewBox="0 0 12 12" aria-hidden="true">
                            <path
                              d="M6 1.5v9M1.5 6h9"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>

                        {menuAt === menuKey && (
                          <SplitMenu
                            anchorEl={nodeRefs.current.get(menuKey)}
                            dims={unusedAt(i)}
                            onPick={(d) => splitFrom(i, node.label, d)}
                            onAi={(mode) => aiSplit(i, node.label, mode)}
                            onClose={() => setMenuAt(null)}
                          />
                        )}
                      </div>
                    );
                  })}

                  {hidden > 0 && (
                    <button
                      className={cx(
                        "w-full rounded-lg border border-dashed py-2 text-xs text-[var(--ink-500)] transition-colors hover:border-[var(--brand-300)] hover:bg-[var(--brand-50)] hover:text-[var(--brand-700)]",
                        LINE,
                        FOCUS
                      )}
                      type="button"
                      onClick={() => setExpanded((p) => ({ ...p, [i]: true }))}
                    >
                      Tampilkan {hidden} lainnya
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Frame>
  );
}

/* ---------------------------------------------------------- data & halaman */

/**
 * Baca CSV dari public/ lalu agregasi per kombinasi dimensi PLUS tanggal.
 * Tanggal wajib ikut di kunci agregasi, karena rentang P1/P2 baru ditentukan
 * saat runtime. Hasilnya tetap ringan: jumlah baris tidak akan melebihi
 * jumlah baris mentah.
 */
async function loadFromCsv() {
  const res = await fetch("/dummy_dataset.csv");
  if (!res.ok) throw new Error("dummy_dataset.csv tidak ada di folder public/");
  const text = await res.text();

  const parsed = Papa.parse(text.replace(/^\uFEFF/, ""), {
    header: true,
    delimiter: ";", // file ini dipisah titik koma, bukan koma
    skipEmptyLines: true,
  });

  const data = parsed.data || [];
  const headers = parsed.meta?.fields || Object.keys(data[0] || {});

  const dateField =
    DATE_FIELD !== "auto" ? DATE_FIELD : detectDateColumn(data.slice(0, 300), headers);

  const dateFormat =
    DATE_FORMAT !== "auto"
      ? DATE_FORMAT
      : detectDateFormat(dateField ? data.slice(0, 300).map((r) => r[dateField]) : []);

  DETECTED = { field: dateField, format: dateFormat };
  if (dateField) {
    // Membantu saat menyetel konfigurasi.
    console.info(`[DecompositionTree] kolom tanggal: "${dateField}", format: ${dateFormat}`);
  } else {
    console.warn(
      "[DecompositionTree] kolom tanggal tidak terdeteksi. Isi DATE_FIELD secara manual."
    );
  }

  const acc = new Map();
  for (const row of data) {
    const d = dateField ? parseDate(row[dateField], dateFormat) : null;
    const parts = DIMENSIONS.map((k) => keyOf(row, k));
    const key = `${d || ""}\u0001${parts.join("\u0001")}`;

    let rec = acc.get(key);
    if (!rec) {
      rec = { __d: d };
      DIMENSIONS.forEach((k, i) => (rec[k] = parts[i]));
      for (const f of NUMERIC_FIELDS) rec[f] = 0;
      acc.set(key, rec);
    }
    for (const f of NUMERIC_FIELDS) {
      if (f === "__n") rec.__n += 1;
      else rec[f] += Number(row[f]) || 0;
    }
  }
  return Array.from(acc.values());
}

/**
 * Ambil data dari Supabase. Aktifkan setelah view teragregasi dibuat.
 * View-nya harus mengembalikan kolom tanggal harian, contohnya:
 *
 *   CREATE VIEW fact_transaksi_agg AS
 *   SELECT CAST(sale_date AS DATE) AS __d,
 *          branch_area, Branch, Channel, Lini_Produk, Year,
 *          Quarter_Name, Payment_Method, Category,
 *          SUM(Revenue) AS Revenue, COUNT(*) AS __n
 *   FROM v_sales_enriched
 *   GROUP BY CAST(sale_date AS DATE), branch_area, Branch, Channel,
 *            Lini_Produk, Year, Quarter_Name, Payment_Method, Category;
 */
async function loadFromSupabase() {
  // const { data, error } = await supabase
  //   .from("fact_transaksi_agg")
  //   .select(["__d", ...DIMENSIONS, ...NUMERIC_FIELDS].join(","));
  // if (error) throw error;
  // return (data || []).map((r) => ({ ...r, __d: parseDate(r.__d) }));
  throw new Error("loadFromSupabase() belum dihubungkan. Isi dulu bagian ini.");
}

/** Rangka kolom yang berdenyut selagi CSV dibaca. */
function LoadingCanvas() {
  return (
    <Frame>
      <header className="dt-topbar flex items-center gap-2.5 px-4 py-2.5 text-white">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15">
          <Mark className="h-[18px] w-[18px]" />
        </span>
        <h1 className="text-[13px] font-semibold tracking-[.01em]">Pohon dekomposisi</h1>
        <span className="text-[12px] text-white/55">Membaca data</span>
      </header>
      <div className="dt-canvas flex flex-1 items-start gap-16 px-5 pt-6">
        {[0, 1, 2].map((col) => (
          <div className="w-[244px] flex-none" key={col} style={{ opacity: 1 - col * 0.28 }}>
            <div className="dt-skeleton mb-3 h-9 rounded-lg" />
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((n) => (
                <div className="dt-skeleton h-[88px] rounded-lg" key={n} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}

export default function DecompositionTreePage() {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  /**
   * Filter dari dashboard Metabase lewat query string.
   * Dimensi     : ?Branch=Bandung  atau  ?Branch=Bandung,Jakarta
   * Rentang P1  : ?p1_from=2026-01-01&p1_to=2026-06-30
   * Rentang P2  : ?p2_from=2025-01-01&p2_to=2025-06-30
   */
  const urlFilters = useMemo(() => {
    if (typeof window === "undefined") return {};
    const params = new URLSearchParams(window.location.search);
    const out = {};
    for (const dim of DIMENSIONS) {
      const v = params.get(dim);
      if (v) out[dim] = new Set(v.split(",").map((s) => s.trim()).filter(Boolean));
    }
    return out;
  }, []);

  useEffect(() => {
    let alive = true;
    const load = DATA_SOURCE === "supabase" ? loadFromSupabase : loadFromCsv;
    load()
      .then((data) => {
        if (!alive) return;
        setRows(data || []);
        setStatus("ready");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err.message);
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const entries = Object.entries(urlFilters);
    if (!entries.length) return rows;
    return rows.filter((r) => entries.every(([dim, set]) => set.has(keyOf(r, dim))));
  }, [rows, urlFilters]);

  if (status === "loading") return <LoadingCanvas />;

  if (status === "error") {
    return (
      <Frame>
        <div className="max-w-[56ch] p-10">
          <h2 className="text-[17px] font-semibold text-[var(--ink-900)]">Data tidak bisa dimuat</h2>
          <p className={cx("mt-2", MUTED)}>{error}</p>
          <p className={cx("mt-2", MUTED)}>
            Periksa lagi sumbernya di <Code>DATA_SOURCE</Code>, lalu muat ulang halaman.
          </p>
        </div>
      </Frame>
    );
  }

  return <DecompositionTree rows={filtered} />;
}