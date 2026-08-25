/**
 * Synthetic UI-style documents with exact transcripts for generic
 * extraction-quality benchmarking (see synthetic-eval.spec.ts).
 */

export interface SynthDoc {
  name: string;
  html: string;
  transcript: string;
}

const FONT_STACK = "font-family: 'Segoe UI', Arial, Helvetica, sans-serif;";

function shell(body: string, dark = false): string {
  const bg = dark ? '#111418' : '#ffffff';
  const fg = dark ? '#e8eaed' : '#202124';
  return `<html><body style="margin:0;background:${bg};">
  <div id="doc" style="width:420px;padding:16px;box-sizing:border-box;background:${bg};color:${fg};${FONT_STACK}">
  ${body}</div></body></html>`;
}

// --- A. Bank mutation -------------------------------------------------------
export function bankMutation(): SynthDoc {
  const rows: [string, string, string][] = [
    ['01/08', 'TRANSFER E BANKING CR', 'Rp 1.500.000'],
    ['03/08', 'BIAYA ADMIN', 'Rp 2.500'],
    ['05/08', 'PEMBELIAN QRIS INDOMARET', 'Rp 87.500'],
    ['08/08', 'TRANSFER MASUK DARI BUDI', 'Rp 500.000'],
    ['11/08', 'TAGIHAN PLN PASCA BAYAR', 'Rp 312.000'],
    ['14/08', 'PEMBELIAN QRIS KOPI KENANGAN', 'Rp 28.000'],
    ['17/08', 'TRANSFER KE SAKSITIA', 'Rp 750.000'],
    ['20/08', 'BUNGA TABUNGAN', 'Rp 12.340'],
    ['22/08', 'PEMBAYARAN INTERNET RUMAH', 'Rp 350.000'],
    ['24/08', 'SETORAN TUNJAI LOBI', 'Rp 1.000.000'],
  ];
  const body = `
  <div style="font-weight:700;font-size:18px;margin-bottom:4px;">CERDOCKY BANK</div>
  <div style="font-size:13px;color:#5f6368;margin-bottom:10px;">Rekening 1234567890 &middot; Periode 01 Ags - 24 Ags 2026</div>
  <table style="width:100%;border-collapse:collapse;font-size:13px;">
    ${rows
      .map(
        ([d, desc, amt]) =>
          `<tr><td style="padding:5px 4px;border-top:1px solid #e0e0e0;white-space:nowrap;">${d}</td>
           <td style="padding:5px 4px;border-top:1px solid #e0e0e0;">${desc}</td>
           <td style="padding:5px 4px;border-top:1px solid #e0e0e0;text-align:right;white-space:nowrap;">${amt}</td></tr>`
      )
      .join('')}
  </table>`;
  const transcript = [
    'CERDOCKY BANK',
    'Rekening 1234567890 Periode 01 Ags - 24 Ags 2026',
    ...rows.map(([d, desc, amt]) => `${d} ${desc} ${amt}`),
  ].join('\n');
  return { name: 'bank_mutation', html: shell(body), transcript };
}

// --- B. Social post ---------------------------------------------------------
export function socialPost(): SynthDoc {
  const handle = '@budi.santoso';
  const displayName = 'Budi Santoso';
  const time = '2 j';
  const postText =
    'Liburan ke Bandung tahun ini seru sekali. Kulineran di Jalan Braga, jalan-jalan ke Alun Alun, dan lihat Gedung Sate dari dekat. Wajib kesini kalau main ke Jawa Barat.';
  const hashtags = '#liburanbandung #kuliner #exploremountain';
  const stats = '1.284 suka  56 komentar  12 dibagikan';
  const body = `
  <div style="display:flex;gap:10px;">
    <div style="width:44px;height:44px;border-radius:50%;background:#cfd8dc;"></div>
    <div>
      <div style="font-weight:700;font-size:15px;">${displayName} <span style="color:#5f6368;font-weight:400;">${handle} &middot; ${time}</span></div>
      <div style="font-size:15px;line-height:1.5;margin-top:6px;">${postText}</div>
      <div style="font-size:15px;color:#1a73e8;margin-top:6px;">${hashtags}</div>
      <div style="font-size:13px;color:#5f6368;margin-top:10px;">${stats}</div>
    </div>
  </div>`;
  const transcript = [displayName, handle, time, postText, hashtags, stats].join('\n');
  return { name: 'social_post', html: shell(body), transcript };
}

// --- C. Chat thread ---------------------------------------------------------
export function chatThread(name: string, dark = false): SynthDoc {
  const msgs: [boolean, string, string][] = [
    [true, '19.02', 'Bro besok jadi futsal jam 7?'],
    [false, '19.04', 'Jadi banget, gas'],
    [true, '19.05', 'Aku bawa bola baru ya'],
    [false, '19.06', 'Boleh, aku bawa keranjang'],
    [true, '19.07', 'Jangan telat lagi dong minggu lalu kamu telat 30 menit'],
    [false, '19.08', 'Wkwk siap bos, ketemu di parkiran bawah'],
  ];
  const bubble = (right: boolean) =>
    `background:${dark ? (right ? '#2d5a88' : '#262930') : right ? '#d3e3fd' : '#f1f3f4'};` +
    `border-radius:12px;padding:8px 12px;max-width:70%;font-size:14px;line-height:1.4;`;
  const body = `
  <div style="font-size:14px;font-weight:700;padding-bottom:8px;border-bottom:1px solid ${dark ? '#333' : '#e0e0e0'};margin-bottom:10px;">Grup Futsal Reuni</div>
  ${msgs
    .map(
      ([mine, t, m]) => `
      <div style="display:flex;justify-content:${mine ? 'flex-end' : 'flex-start'};margin-bottom:8px;">
        <div><div style="${bubble(mine)}">${m}<span style="font-size:11px;color:#9aa0a6;display:block;text-align:right;margin-top:2px;">${t}</span></div></div>
      </div>`
    )
    .join('')}`;
  const transcript = ['Grup Futsal Reuni', ...msgs.map(([, t, m]) => `${m} ${t}`)].join('\n');
  return { name, html: shell(body, dark), transcript };
}

// --- D. Receipt -------------------------------------------------------------
export function receipt(): SynthDoc {
  const items: [string, string][] = [
    ['Beras Premium 5kg', '68.000'],
    ['Gula Pasir 1kg', '14.500'],
    ['Minyak Goreng 2L', '36.000'],
    ['Telur Ayam 1kg', '27.500'],
    ['Kopi Sachet Isi 10', '12.000'],
    ['Mie Instan Karton', '105.000'],
  ];
  const totals: [string, string][] = [
    ['TOTAL', '263.000'],
    ['TUNAI', '300.000'],
    ['KEMBALI', '37.000'],
  ];
  const line = (l: string, r: string) =>
    `<div style="display:flex;justify-content:space-between;font-size:13px;"><span>${l}</span><span>${r}</span></div>`;
  const body = `
  <div style="text-align:center;">
    <div style="font-weight:700;font-size:16px;">TOKO SEMBAKO MAKMUR</div>
    <div style="font-size:12px;">Jl. Melati No. 12 Bandung</div>
    <div style="font-size:12px;margin-bottom:8px;">24/08/2026 14:32 Kasir: Rina</div>
    <div style="border-top:1px dashed #999;"></div>
    ${items.map(([n, p]) => line(n, p)).join('')}
    <div style="border-top:1px dashed #999;margin-top:6px;padding-top:6px;"></div>
    ${totals.map(([n, p]) => line(`<b>${n}</b>`, `<b>${p}</b>`)).join('')}
    <div style="border-top:1px dashed #999;margin-top:6px;padding-top:6px;font-size:12px;">Terima kasih sudah berbelanja</div>
  </div>`;
  const transcript = [
    'TOKO SEMBAKO MAKMUR',
    'Jl. Melati No. 12 Bandung',
    '24/08/2026 14:32 Kasir: Rina',
    ...items.map(([n, p]) => `${n} ${p}`),
    ...totals.map(([n, p]) => `${n} ${p}`),
    'Terima kasih sudah berbelanja',
  ].join('\n');
  return { name: 'receipt', html: shell(body), transcript };
}

// --- E. News article --------------------------------------------------------
export function article(): SynthDoc {
  const headline = 'Pemerintah Percepat Digitalisasi UMKM Lewat Literasi Teknologi';
  const meta = 'Jakarta, Senin 24 Agustus 2026 - Redaksi Ekonomi';
  const paras = [
    'Program pelatihan digital ditujukan bagi pelaku usaha mikro dan kecil di dua puluh provinsi. Peserta akan belajar pembukuan sederhana, pemasaran daring, serta penggunaan pembayaran digital dalam transaksi harian.',
    'Menurut data resmi yang dirilis pekan lalu, jumlah usaha kecil yang memasarkan produk lewat internet naik dua puluh persen dibanding tahun lalu. Angka itu didorong tingginya penggunaan telepon genggam di daerah.',
    'Pemerintah menargetkan satu juta pelaku usaha mengikuti program ini hingga akhir tahun. Pelatihan dilaksanakan secara gratis melalui pusat pelatihan daerah dan modul daring yang bisa diakses kapan saja.',
  ];
  const body = `
  <div style="font-weight:700;font-size:19px;line-height:1.3;">${headline}</div>
  <div style="font-size:12px;color:#5f6368;margin:8px 0 12px;">${meta}</div>
  ${paras.map((p) => `<p style="font-size:14px;line-height:1.55;margin:0 0 10px;">${p}</p>`).join('')}`;
  const transcript = [headline, meta, ...paras].join('\n\n');
  return { name: 'article_news', html: shell(body), transcript };
}

// --- F. Phone app screen (dense UI, small fonts, status/nav chrome) --------
export function appScreen(): SynthDoc {
  const rows: [string, string, string][] = [
    ['GoFood Ayam Geprek', 'Hari ini 19.24', '-Rp32.000'],
    ['Top Up ShopeePay', 'Kemarin 20.01', '-Rp100.000'],
    ['Transfer ke Rina Wati', 'Kemarin 18.45', '-Rp250.000'],
    ['Gopay Driver', '22 Ags 07.12', '-Rp18.000'],
    ['Cashback Kembali', '21 Ags 23.59', '+Rp5.000'],
    ['Token Listrik PLN', '21 Ags 06.30', '-Rp50.000'],
    ['Netflix Premium', '20 Ags 13.00', '-Rp54.000'],
  ];
  const row = ([title, sub, amt]: [string, string, string]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #f1f1f1;">
      <div>
        <div style="font-size:14px;font-weight:600;">${title}</div>
        <div style="font-size:11px;color:#80868b;margin-top:2px;">${sub}</div>
      </div>
      <div style="font-size:13px;font-weight:600;color:#202124;">${amt}</div>
    </div>`;
  const body = `
  <div style="display:flex;justify-content:space-between;font-size:9px;color:#5f6368;padding-bottom:6px;">
    <span>09.41</span><span>4G 87%</span>
  </div>
  <div style="font-size:16px;font-weight:700;">DompetKu</div>
  <div style="background:#e8f0fe;border-radius:10px;padding:12px;margin:10px 0;">
    <div style="font-size:10px;color:#5f6368;">Saldo tersedia</div>
    <div style="font-size:20px;font-weight:700;">Rp 4.285.500</div>
    <div style="font-size:11px;color:#5f6368;margin-top:2px;">0812-3456-7890</div>
  </div>
  <div style="font-size:11px;color:#5f6368;text-transform:uppercase;margin:6px 0 2px;">Transaksi Terakhir</div>
  ${rows.map(row).join('')}
  <div style="display:flex;justify-content:space-between;font-size:11px;color:#5f6368;border-top:1px solid #e0e0e0;padding-top:8px;margin-top:8px;">
    <span>Beranda</span><span>Riwayat</span><span>Kartu</span><span>Promo</span><span>Profil</span>
  </div>`;
  const transcript = [
    '09.41 4G 87%',
    'DompetKu',
    'Saldo tersedia Rp 4.285.500',
    '0812-3456-7890',
    'Transaksi Terakhir',
    ...rows.map(([t, s, a]) => `${t} ${s} ${a}`),
    'Beranda Riwayat Kartu Promo Profil',
  ].join('\n');
  return { name: 'app_screen', html: shell(body), transcript };
}

// --- G. Dense bank mutation (more rows, smaller font) ------------------------
export function denseMutation(): SynthDoc {
  const rows: [string, string, string][] = [
    ['25/07', 'QRIS INDOMARET PPOB', 'Rp 45.500'],
    ['26/07', 'TRANSFER MASUK BCA', 'Rp 2.750.000'],
    ['27/07', 'BIAYA TARIK TUNAI ATM', 'Rp 6.500'],
    ['28/07', 'PEMBELIAN TOKOPEDIA', 'Rp 189.000'],
    ['29/07', 'TAGIHAN KARTU KREDIT', 'Rp 1.200.000'],
    ['30/07', 'BUNGA DAN PAJAK', 'Rp 8.245'],
    ['31/07', 'TRANSFER KE DONI PRATAMA', 'Rp 320.000'],
    ['01/08', 'QRIS ALFAMART EXPRESS', 'Rp 67.900'],
    ['02/08', 'SETORAN TUNAI BRILINK', 'Rp 900.000'],
    ['03/08', 'PEMBAYARAN BPJS KESEHATAN', 'Rp 168.000'],
    ['04/08', 'TOP UP OVO DRIVER', 'Rp 150.000'],
    ['05/08', 'TRANSFER MASUK MANDIRI', 'Rp 475.000'],
    ['06/08', 'LANGGANAN SPOTIFY PREMIUM', 'Rp 54.999'],
    ['07/08', 'PEMBELIAN SHOPEE FOOD', 'Rp 42.750'],
    ['08/08', 'ADMIN REKENING GIRO', 'Rp 12.500'],
    ['09/08', 'TRANSFER KE SITI AMINAH', 'Rp 1.050.000'],
  ];
  const body = `
  <div style="font-weight:700;font-size:15px;margin-bottom:2px;">CERDOCKY BANK MUTASI</div>
  <div style="font-size:10px;color:#5f6368;margin-bottom:6px;">Rekening 9876543210 &middot; Periode 25 Jul - 09 Ags 2026 &middot; Mata uang IDR</div>
  <table style="width:100%;border-collapse:collapse;font-size:11px;">
    <tr><th style="text-align:left;padding:3px 3px;border-bottom:1px solid #bbb;">Tgl</th>
        <th style="text-align:left;padding:3px 3px;border-bottom:1px solid #bbb;">Deskripsi</th>
        <th style="text-align:right;padding:3px 3px;border-bottom:1px solid #bbb;">Jumlah</th></tr>
    ${rows
      .map(
        ([d, desc, amt]) =>
          `<tr><td style="padding:2px 3px;white-space:nowrap;">${d}</td>
           <td style="padding:2px 3px;">${desc}</td>
           <td style="padding:2px 3px;text-align:right;white-space:nowrap;">${amt}</td></tr>`
      )
      .join('')}
  </table>
  <div style="font-size:10px;color:#5f6368;margin-top:6px;">Saldo akhir Rp 12.483.662 &middot; Cetak 25/08/2026 10.15 WIB</div>`;
  const transcript = [
    'CERDOCKY BANK MUTASI',
    'Rekening 9876543210 Periode 25 Jul - 09 Ags 2026 Mata uang IDR',
    'Tgl Deskripsi Jumlah',
    ...rows.map(([d, desc, amt]) => `${d} ${desc} ${amt}`),
    'Saldo akhir Rp 12.483.662 Cetak 25/08/2026 10.15 WIB',
  ].join('\n');
  return { name: 'mutation_dense', html: shell(body), transcript };
}

export const SYNTH_DOCS: SynthDoc[] = [
  bankMutation(),
  socialPost(),
  chatThread('chat_light'),
  chatThread('chat_dark', true),
  receipt(),
  article(),
  appScreen(),
  denseMutation(),
];

/**
 * Degradation twins: real-world inputs are rarely clean renders. Each entry
 * re-runs one base doc through a distortion applied to the rasterized PNG,
 * exercising small-text scaling, compression artifacts, and soft focus.
 */
export type DegradeMode = 'half' | 'jpeg' | 'blur';

export const DEGRADE_TWINS: { docName: string; mode: DegradeMode }[] = [
  { docName: 'bank_mutation', mode: 'jpeg' },
  { docName: 'article_news', mode: 'half' },
  { docName: 'app_screen', mode: 'half' },
  { docName: 'chat_dark', mode: 'blur' },
];
