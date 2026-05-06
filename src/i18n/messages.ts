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
  hero: {
    eyebrow: string;
    headline: string;
    sub: string;
    ctaJoin: string;
    ctaBrowse: string;
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
      eyebrow: "The advocate's toolbelt",
      headline: "Strap in. Send 100 emails across 50 states in one click.",
      sub: "Pre-written letters to your specific legislators. AI-tracked bills. Coalition waves. Built for kratom advocates and farmers who want this plant to stay legal — globally.",
      ctaJoin: "Join the war room",
      ctaBrowse: "Browse active campaigns",
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
      eyebrow: "Perangkat advokat",
      headline: "Bersiaplah. Kirim 100 email ke 50 negara bagian AS dengan satu klik.",
      sub: "Surat siap-tulis ke legislator spesifik Anda. Pelacakan RUU dengan AI. Gelombang koalisi. Dibuat untuk advokat dan petani kratom yang ingin tanaman ini tetap legal — secara global.",
      ctaJoin: "Bergabung dengan ruang perang",
      ctaBrowse: "Lihat kampanye aktif",
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
      eyebrow: "เครื่องมือสำหรับนักเคลื่อนไหว",
      headline: "เตรียมตัวให้พร้อม ส่งอีเมล 100 ฉบับไปยัง 50 รัฐในคลิกเดียว",
      sub: "จดหมายสำเร็จรูปถึงผู้แทนของคุณ ติดตามร่างกฎหมายด้วย AI คลื่นการเคลื่อนไหวร่วม สร้างขึ้นเพื่อนักเคลื่อนไหวและเกษตรกรกระท่อมที่ต้องการให้พืชชนิดนี้ถูกกฎหมาย — ทั่วโลก",
      ctaJoin: "เข้าร่วมห้องวอร์รูม",
      ctaBrowse: "ดูแคมเปญที่กำลังดำเนินอยู่",
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
      eyebrow: "Alat pendukung",
      headline: "Bersedia. Hantar 100 e-mel merentasi 50 negeri AS dengan satu klik.",
      sub: "Surat siap tulis kepada penggubal undang-undang khusus anda. Pengesanan rang undang-undang dengan AI. Gelombang gabungan. Dibina untuk penyokong dan petani kratom yang mahu tumbuhan ini kekal sah — secara global.",
      ctaJoin: "Sertai bilik perang",
      ctaBrowse: "Lihat kempen aktif",
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
      eyebrow: "Công cụ của người vận động",
      headline: "Sẵn sàng. Gửi 100 email tới 50 tiểu bang Hoa Kỳ chỉ với một cú nhấp.",
      sub: "Thư mẫu sẵn sàng gửi đến các nhà lập pháp cụ thể của bạn. Theo dõi dự luật bằng AI. Làn sóng liên minh. Xây dựng cho những người vận động và nông dân kratom muốn cây này được hợp pháp — trên toàn cầu.",
      ctaJoin: "Tham gia phòng chiến lược",
      ctaBrowse: "Xem các chiến dịch đang hoạt động",
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
