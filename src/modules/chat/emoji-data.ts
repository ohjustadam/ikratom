/**
 * The Lounge emoji picker's set (B8): a short, hand-picked list in six plain
 * groups rather than a 3,000-emoji library, so it loads instantly, needs no
 * new package, and an older member can find a smile without searching.
 * Everything here is Unicode 13 or older, so it shows on older phones too.
 */
export const EMOJI_GROUPS: { label: string; icon: string; emoji: string[] }[] = [
  {
    label: "Smileys",
    icon: "😀",
    emoji: ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "😉", "😍", "🥰", "😘", "😋", "😎", "🤗", "🤔", "😐", "😏", "😴", "😢", "😭", "😤", "😡", "😱", "🥳"],
  },
  {
    label: "Hands",
    icon: "👍",
    emoji: ["👍", "👎", "👏", "🙌", "🙏", "💪", "👋", "🤝", "✌️", "🤞", "👌", "✊", "👊", "☝️", "👉", "✍️"],
  },
  {
    label: "Hearts",
    icon: "❤️",
    emoji: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍", "💖", "💯", "✨", "🔥", "⭐", "🎉", "🎊"],
  },
  {
    label: "Nature",
    icon: "🌿",
    emoji: ["🌿", "🍃", "🌱", "🌳", "🌻", "🌸", "🌞", "🌙", "🌈", "☔", "❄️", "🐶", "🐱", "🦋", "🐝", "🌎"],
  },
  {
    label: "Food and drink",
    icon: "☕",
    emoji: ["☕", "🍵", "🧉", "🍎", "🍌", "🍓", "🍕", "🍔", "🌮", "🍰", "🍪", "🍫"],
  },
  {
    label: "Things",
    icon: "📣",
    emoji: ["📣", "📢", "🗳️", "🏛️", "📜", "✉️", "📞", "📅", "✅", "❌", "⚠️", "❓", "❗", "💡", "📌", "🇺🇸"],
  },
];
