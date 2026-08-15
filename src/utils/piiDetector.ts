export type PIIType = 'nik' | 'phone' | 'email' | 'id' | 'bank' | 'password' | 'custom';

const regexMap: Partial<Record<PIIType, RegExp>> = {
  // Indonesian NIK is 16 digits
  nik: /\b\d{16}\b/i,
  // Basic phone format (can be +62, 08, etc.)
  phone: /\+?\b\d{9,15}\b/i,
  // Standard email regex
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  // General ID / Passport format
  id: /\b[A-Z0-9-]{6,20}\b/i,
  // Basic bank account length (usually 10 to 16 digits)
  bank: /\b\d{10,16}\b/i,
  // High-entropy or password like patterns (e.g. "password: XXX")
  password: /(?:password|sandi|passwd|pwd|pass|pin)\s*[:=]\s*(\S+)/i
};

export function detectPII(text: string, activeTypes: PIIType[], customText?: string): boolean {
  for (const type of activeTypes) {
    if (type === 'custom') {
      if (customText && text.toLowerCase().includes(customText.toLowerCase())) {
        return true;
      }
      continue;
    }

    const regex = regexMap[type];
    if (regex && regex.test(text)) {
      return true;
    }
  }
  return false;
}
