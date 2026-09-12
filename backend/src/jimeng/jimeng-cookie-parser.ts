export interface CookieItem {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: string;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
  [key: string]: any;
}

export interface ParsedCookieInput {
  cookieArr: CookieItem[];
  label?: string;
  source?: string;
  credits?: number;
  expireAtMeta?: Date;
}

export interface ExtractedSession {
  sessionid: string;
  expireAt: Date | null;
  cookieJson: string;
}

export function parseCookieInput(raw: string): ParsedCookieInput {
  const trimmed = (raw || '').trim();
  if (!trimmed) throw new Error('cookie 内容为空');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed);
      if (Array.isArray(obj)) {
        const arr = obj as any[];
        if (arr.length && typeof arr[0] === 'object') {
          return { cookieArr: normalizeCookieArr(arr) };
        }
      } else if (obj && typeof obj === 'object') {
        const o = obj as any;
        if (Array.isArray(o.cookieArr)) {
          return {
            cookieArr: normalizeCookieArr(o.cookieArr),
            label: o.label,
            source: o.source,
            credits: typeof o.credits === 'number' ? o.credits : undefined,
            expireAtMeta: o.expireAt ? new Date(o.expireAt) : undefined,
          };
        }
      }
    } catch {
    }
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.some((l) => l.includes("	"))) {
    return parseNetscape(trimmed);
  }

  return parseNameValue(trimmed);
}

function parseNetscape(raw: string): ParsedCookieInput {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const arr: CookieItem[] = [];
  for (const line of lines) {
    const parts = line.split("	");
    if (parts.length >= 7) {
      arr.push({
        domain: parts[0],
        httpOnly: parts[1] === 'TRUE',
        path: parts[2],
        secure: parts[3] === 'TRUE',
        expirationDate: parts[4] ? Number(parts[4]) : undefined,
        name: parts[5],
        value: parts[6],
      });
    }
  }
  if (arr.length === 0) throw new Error('无法解析 Netscape cookie 格式');
  return { cookieArr: arr };
}

function parseNameValue(raw: string): ParsedCookieInput {
  const arr: CookieItem[] = [];
  const parts = raw.split(';').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) {
      arr.push({
        name: part.slice(0, eqIdx).trim(),
        value: part.slice(eqIdx + 1).trim(),
      });
    }
  }
  if (arr.length === 0) throw new Error('无法解析 cookie 格式');
  return { cookieArr: arr };
}

function normalizeCookieArr(arr: any[]): CookieItem[] {
  return arr.map((c) => {
    if (!c || typeof c !== 'object') return null;
    const item: CookieItem = {
      name: c.name || '',
      value: c.value || '',
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      expirationDate: c.expirationDate,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    };
    for (const k of Object.keys(c)) {
      if (!(k in item)) (item as any)[k] = c[k];
    }
    return item;
  }).filter(Boolean) as CookieItem[];
}

export function extractSession(cookieArr: CookieItem[]): ExtractedSession {
  let sessionid = '';
  let expireAt: Date | null = null;

  for (const c of cookieArr) {
    if (c.name === 'sessionid' && c.value) {
      sessionid = c.value;
      if (c.expires) {
        const d = new Date(c.expires);
        if (!isNaN(d.getTime())) expireAt = d;
      } else if (c.expirationDate) {
        expireAt = new Date(c.expirationDate * 1000);
      }
      break;
    }
  }

  if (!sessionid) {
    for (const c of cookieArr) {
      if ((c.name === 'sessionid_ss' || c.name === 'sid_tt') && c.value) {
        sessionid = c.value;
        break;
      }
    }
  }

  return {
    sessionid,
    expireAt,
    cookieJson: JSON.stringify(cookieArr),
  };
}
