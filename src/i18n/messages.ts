/**
 * Static-string translations for recruitment-facing pages.
 *
 * Keep keys flat + namespaced ("hero.headline"). Server components
 * call getMessages(lang) once and pass into JSX. Client components
 * use useLocale() if needed (none yet — server-rendered for now).
 *
 * Adding a language:
 *   1. Add the locale code to LOCALES below + the check constraint in
 *      migration 0036.
 *   2. Translate every key in EN to the new language and put under that
 *      locale key.
 *   3. Update LocaleSwitcher.tsx to include the new option.
 *
 * Translation policy: machine-translated strings are starting points,
 * not final. Native-speaker review before public-facing rollout. Note in
 * each language file when human review has happened.
 */

export const LOCALES = ["en", "id", "th", "ms", "vi"] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  id: "Bahasa Indonesia",
  th: "ภาษาไทย",
  ms: "Bahasa Melayu",
  vi: "Tiếng Việt",
};

type Messages = {
  // Keys mirror the CURRENT home hero (rewritten 2026-05; keys reconciled
  // 2026-07-07 — the old "Strap in / 100 emails" copy was stale + unwired).
  hero: {
    eyebrow: string;
    headlineTop: string;
    headlineAccent: string;
    lead: string;
    leadFlip: string;
    sub: string;
    statBannedStates: string;
    statImminent: string;
    statLocalBans: string;
    statBillsTracked: string;
    ctaDashboard: string;
    ctaJoin: string;
    ctaBanned: string;
    ctaTakeback: string;
    ctaPulse: string;
  };
  nav: {
    campaigns: string;
    legislators: string;
    bills: string;
    news: string;
    library: string;
    forum: string;
    communities: string;
    howItWorks: string;
    glossary: string;
  };
  intl: {
    farmerCallout: string;
  };
  footer: {
    languagePicker: string;
    nonpartisan: string;
  };
};

const messages: Record<Locale, Messages> = {
  en: {
    hero: {
      eyebrow: "Nonpartisan kratom advocacy · live policy feed",
      headlineTop: "Kratom policy moves fast.",
      headlineAccent: "We move faster — together.",
      lead: "Every day, a city council, state legislature, or federal agency decides something about kratom. Most advocates don't hear about it until it's too late.",
      leadFlip: "iKratom flips that.",
      sub: "We track every bill, hearing, and ordinance in the United States, surface the ones that affect you, write the letter to your specific legislators, and put a one-click send button on it. You decide what to say. We make it possible to actually say it.",
      statBannedStates: "States banning kratom",
      statImminent: "Imminent state bans",
      statLocalBans: "County + city bans",
      statBillsTracked: "Bills tracked this year",
      ctaDashboard: "Go to your dashboard →",
      ctaJoin: "Join the network — 90 seconds →",
      ctaBanned: "See where it's banned",
      ctaTakeback: "Takeback plan",
      ctaPulse: "Live pulse",
    },
    nav: {
      campaigns: "Campaigns",
      legislators: "Legislators",
      bills: "Bills",
      news: "News",
      library: "Library",
      forum: "Forum",
      communities: "Communities",
      howItWorks: "How it works",
      glossary: "Glossary",
    },
    intl: {
      farmerCallout:
        "Indonesian farmer or distributor? You produce most of the world's kratom — your political voice matters. Sign up to coordinate with US advocates fighting for the same plant.",
    },
    footer: {
      languagePicker: "Language",
      nonpartisan:
        "iKratom is a nonpartisan advocacy tool. Not affiliated with any kratom organization. Kratom statements have not been evaluated by the FDA.",
    },
  },

  id: {
    hero: {
      eyebrow: "Advokasi kratom nonpartisan · umpan kebijakan langsung",
      headlineTop: "Kebijakan kratom bergerak cepat.",
      headlineAccent: "Kita bergerak lebih cepat — bersama.",
      lead: "Setiap hari, dewan kota, legislatif negara bagian, atau lembaga federal AS memutuskan sesuatu tentang kratom. Kebanyakan advokat baru mengetahuinya setelah terlambat.",
      leadFlip: "iKratom membalikkan itu.",
      sub: "Kami melacak setiap RUU, dengar pendapat, dan peraturan daerah di Amerika Serikat, menampilkan yang berdampak pada Anda, menulis suratnya untuk legislator Anda, dan menyediakan tombol kirim satu klik. Anda yang menentukan isi pesan. Kami yang membuatnya mungkin.",
      statBannedStates: "Negara bagian yang melarang kratom",
      statImminent: "Larangan negara bagian segera berlaku",
      statLocalBans: "Larangan kabupaten + kota",
      statBillsTracked: "RUU terpantau tahun ini",
      ctaDashboard: "Buka dasbor Anda →",
      ctaJoin: "Gabung jaringan — 90 detik →",
      ctaBanned: "Lihat di mana kratom dilarang",
      ctaTakeback: "Rencana merebut kembali",
      ctaPulse: "Denyut langsung",
    },
    nav: {
      campaigns: "Kampanye",
      legislators: "Legislator",
      bills: "RUU",
      news: "Berita",
      library: "Pustaka",
      forum: "Forum",
      communities: "Komunitas",
      howItWorks: "Cara kerja",
      glossary: "Glosarium",
    },
    intl: {
      farmerCallout:
        "Petani atau distributor Indonesia? Anda memproduksi sebagian besar kratom dunia — suara politik Anda penting. Daftar untuk berkoordinasi dengan advokat AS yang berjuang untuk tanaman yang sama.",
    },
    footer: {
      languagePicker: "Bahasa",
      nonpartisan:
        "iKratom adalah alat advokasi nonpartisan. Tidak berafiliasi dengan organisasi kratom mana pun. Pernyataan tentang kratom belum dievaluasi oleh FDA.",
    },
  },

  th: {
    hero: {
      eyebrow: "การผลักดันนโยบายกระท่อมแบบไม่ฝักใฝ่ฝ่ายใด · ฟีดนโยบายสด",
      headlineTop: "นโยบายกระท่อมเปลี่ยนเร็ว",
      headlineAccent: "เราเร็วกว่า — เมื่อร่วมมือกัน",
      lead: "ทุกวัน สภาเมือง สภานิติบัญญัติของรัฐ หรือหน่วยงานรัฐบาลกลางสหรัฐฯ ตัดสินใจบางอย่างเกี่ยวกับกระท่อม นักเคลื่อนไหวส่วนใหญ่รู้เมื่อสายเกินไป",
      leadFlip: "iKratom เปลี่ยนสิ่งนั้น",
      sub: "เราติดตามร่างกฎหมาย การประชุมรับฟังความคิดเห็น และข้อบัญญัติทุกฉบับในสหรัฐฯ คัดกรองเรื่องที่กระทบคุณ ร่างจดหมายถึงผู้แทนของคุณ พร้อมปุ่มส่งคลิกเดียว คุณตัดสินใจว่าจะพูดอะไร เราทำให้พูดได้จริง",
      statBannedStates: "รัฐที่แบนกระท่อม",
      statImminent: "รัฐที่ใกล้จะแบน",
      statLocalBans: "การแบนระดับเทศมณฑล + เมือง",
      statBillsTracked: "ร่างกฎหมายที่ติดตามปีนี้",
      ctaDashboard: "ไปที่แดชบอร์ดของคุณ →",
      ctaJoin: "เข้าร่วมเครือข่าย — 90 วินาที →",
      ctaBanned: "ดูว่าที่ไหนแบน",
      ctaTakeback: "แผนทวงคืน",
      ctaPulse: "ชีพจรสด",
    },
    nav: {
      campaigns: "แคมเปญ",
      legislators: "สมาชิกสภานิติบัญญัติ",
      bills: "ร่างกฎหมาย",
      news: "ข่าว",
      library: "ห้องสมุด",
      forum: "ฟอรั่ม",
      communities: "ชุมชน",
      howItWorks: "วิธีใช้งาน",
      glossary: "คำศัพท์",
    },
    intl: {
      farmerCallout:
        "เป็นเกษตรกรหรือผู้จำหน่ายชาวไทย? ประเทศไทยทำให้กระท่อมถูกกฎหมายในปี 2021 — เสียงของคุณช่วยรักษาแนวโน้มที่ก้าวหน้าได้ ลงทะเบียนเพื่อประสานงานกับนักเคลื่อนไหวทั่วโลก",
    },
    footer: {
      languagePicker: "ภาษา",
      nonpartisan:
        "iKratom เป็นเครื่องมือสนับสนุนที่ไม่ฝักใฝ่ฝ่ายใด ไม่สังกัดกับองค์กรกระท่อมใด ๆ คำกล่าวเกี่ยวกับกระท่อมยังไม่ได้รับการประเมินจาก FDA",
    },
  },

  ms: {
    hero: {
      eyebrow: "Advokasi kratom tanpa memihak · suapan dasar langsung",
      headlineTop: "Dasar kratom bergerak pantas.",
      headlineAccent: "Kita bergerak lebih pantas — bersama.",
      lead: "Setiap hari, majlis bandar, badan perundangan negeri, atau agensi persekutuan AS memutuskan sesuatu tentang kratom. Kebanyakan penyokong hanya tahu apabila sudah terlambat.",
      leadFlip: "iKratom mengubah keadaan itu.",
      sub: "Kami menjejaki setiap rang undang-undang, pendengaran awam, dan undang-undang kecil di Amerika Syarikat, menonjolkan yang memberi kesan kepada anda, menulis surat kepada penggubal undang-undang anda, dan menyediakan butang hantar satu klik. Anda tentukan apa yang mahu dikatakan. Kami menjadikannya mungkin.",
      statBannedStates: "Negeri yang mengharamkan kratom",
      statImminent: "Pengharaman negeri hampir berkuat kuasa",
      statLocalBans: "Pengharaman daerah + bandar",
      statBillsTracked: "Rang undang-undang dijejaki tahun ini",
      ctaDashboard: "Pergi ke papan pemuka anda →",
      ctaJoin: "Sertai rangkaian — 90 saat →",
      ctaBanned: "Lihat di mana ia diharamkan",
      ctaTakeback: "Pelan rampasan semula",
      ctaPulse: "Nadi langsung",
    },
    nav: {
      campaigns: "Kempen",
      legislators: "Penggubal undang-undang",
      bills: "Rang Undang-Undang",
      news: "Berita",
      library: "Perpustakaan",
      forum: "Forum",
      communities: "Komuniti",
      howItWorks: "Cara ia berfungsi",
      glossary: "Glosari",
    },
    intl: {
      farmerCallout:
        "Petani atau pengedar dari Malaysia? Suara anda membentuk dasar serantau. Daftar untuk berkoordinasi dengan penyokong di seluruh dunia.",
    },
    footer: {
      languagePicker: "Bahasa",
      nonpartisan:
        "iKratom ialah alat advokasi tidak berkecuali. Tidak bergabung dengan mana-mana organisasi kratom. Kenyataan kratom belum dinilai oleh FDA.",
    },
  },

  vi: {
    hero: {
      eyebrow: "Vận động chính sách kratom phi đảng phái · nguồn tin chính sách trực tiếp",
      headlineTop: "Chính sách kratom thay đổi nhanh.",
      headlineAccent: "Chúng ta nhanh hơn — khi cùng nhau.",
      lead: "Mỗi ngày, một hội đồng thành phố, cơ quan lập pháp tiểu bang hoặc cơ quan liên bang Hoa Kỳ lại quyết định điều gì đó về kratom. Phần lớn người vận động chỉ biết khi đã quá muộn.",
      leadFlip: "iKratom thay đổi điều đó.",
      sub: "Chúng tôi theo dõi mọi dự luật, phiên điều trần và sắc lệnh tại Hoa Kỳ, làm nổi bật những gì ảnh hưởng đến bạn, soạn sẵn thư gửi các nhà lập pháp của bạn, kèm nút gửi một cú nhấp. Bạn quyết định nội dung. Chúng tôi giúp bạn nói được điều đó.",
      statBannedStates: "Tiểu bang cấm kratom",
      statImminent: "Lệnh cấm tiểu bang sắp hiệu lực",
      statLocalBans: "Lệnh cấm quận + thành phố",
      statBillsTracked: "Dự luật theo dõi năm nay",
      ctaDashboard: "Đến bảng điều khiển của bạn →",
      ctaJoin: "Tham gia mạng lưới — 90 giây →",
      ctaBanned: "Xem nơi bị cấm",
      ctaTakeback: "Kế hoạch giành lại",
      ctaPulse: "Nhịp đập trực tiếp",
    },
    nav: {
      campaigns: "Chiến dịch",
      legislators: "Nhà lập pháp",
      bills: "Dự luật",
      news: "Tin tức",
      library: "Thư viện",
      forum: "Diễn đàn",
      communities: "Cộng đồng",
      howItWorks: "Cách hoạt động",
      glossary: "Từ điển",
    },
    intl: {
      farmerCallout:
        "Nông dân hoặc nhà phân phối từ Việt Nam? Tiếng nói của bạn ảnh hưởng đến chính sách kratom khu vực. Đăng ký để phối hợp với những người vận động trên toàn thế giới.",
    },
    footer: {
      languagePicker: "Ngôn ngữ",
      nonpartisan:
        "iKratom là công cụ vận động phi đảng phái. Không liên kết với bất kỳ tổ chức kratom nào. Các tuyên bố về kratom chưa được FDA đánh giá.",
    },
  },
};

export function getMessages(lang: string | null | undefined): Messages {
  const safe = (LOCALES as readonly string[]).includes(lang ?? "")
    ? (lang as Locale)
    : "en";
  return messages[safe];
}

export function isValidLocale(lang: string | null | undefined): lang is Locale {
  return (LOCALES as readonly string[]).includes(lang ?? "");
}
