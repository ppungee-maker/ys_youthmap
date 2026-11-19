/**
 * 우체국 게시판 서버 (Cloudflare Worker)
 *
 * 지도(index.html)는 정적 파일이라 글을 저장할 곳이 없어서, 글 저장과 관리자 확인을 여기서 한다.
 *   GET    /notices        누구나 — 소식 목록
 *   POST   /login          관리자 확인만 (아이디·비밀번호가 맞는지)
 *   POST   /notices        관리자 — 새 소식
 *   PUT    /notices/:id    관리자 — 소식 고치기
 *   DELETE /notices/:id    관리자 — 소식 지우기
 *
 * 관리자 요청은 헤더 Authorization: Basic base64(아이디:비밀번호) 를 붙인다.
 * 아이디·비밀번호는 코드에 적지 않는다 — Cloudflare 비밀값(secret) ADMIN_ID, ADMIN_PASSWORD 에 둔다.
 * 글은 KV 저장소(NOTICES 바인딩)의 'notices' 키 하나에 JSON 배열로 들어 있다.
 * KV 는 쓴 내용이 전 세계에 퍼지는 데 1분쯤 걸린다. 그래서 쓰기·고치기·지우기는 저장 직후의
 * 목록(notices)을 같이 돌려주고, 페이지는 다시 읽지 않고 그걸 쓴다.
 */

const MAX_TITLE = 40;
const MAX_BODY = 400;
const MAX_NOTICES = 100;     // 오래된 것부터 밀어낸다
const MAX_FAILS = 10;        // 10분 안에 로그인을 이만큼 틀리면
const LOCK_SECONDS = 600;    // 10분 동안 잠근다

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);   // ['notices', ':id']

    try {
      if (parts[0] === 'notices' && request.method === 'GET' && parts.length === 1) {
        return json({ ok: true, notices: await load(env) });
      }

      if (parts[0] === 'login' && request.method === 'POST') {
        const auth = await checkAdmin(request, env);
        return auth === true ? json({ ok: true }) : json({ ok: false, error: auth }, 401);
      }

      if (parts[0] === 'notices') {
        const auth = await checkAdmin(request, env);
        if (auth !== true) return json({ ok: false, error: auth }, 401);

        const list = await load(env);

        if (request.method === 'POST' && parts.length === 1) {
          const { title, body } = await readInput(request);
          if (!title) return json({ ok: false, error: 'empty' }, 400);
          const n = { id: newId(), date: today(), title, body, created: Date.now() };
          list.unshift(n);
          const kept = list.slice(0, MAX_NOTICES);
          await save(env, kept);
          return json({ ok: true, notice: n, notices: kept });
        }

        const i = list.findIndex(n => n.id === parts[1]);
        if (parts.length === 2 && i < 0) return json({ ok: false, error: 'not-found' }, 404);

        if (request.method === 'PUT' && parts.length === 2) {
          const { title, body } = await readInput(request);
          if (!title) return json({ ok: false, error: 'empty' }, 400);
          list[i] = { ...list[i], title, body, edited: Date.now() };
          await save(env, list);
          return json({ ok: true, notice: list[i], notices: list });
        }

        if (request.method === 'DELETE' && parts.length === 2) {
          list.splice(i, 1);
          await save(env, list);
          return json({ ok: true, notices: list });
        }
      }

      return json({ ok: false, error: 'not-found' }, 404);
    } catch (err) {
      return json({ ok: false, error: 'server' }, 500);
    }
  },
};

async function load(env) {
  const raw = await env.NOTICES.get('notices');
  const list = raw ? JSON.parse(raw) : [];
  // 최신 날짜가 위, 같은 날이면 나중에 쓴 글이 위
  return list.sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));
}

function save(env, list) {
  return env.NOTICES.put('notices', JSON.stringify(list));
}

// true 이거나, 실패 이유 문자열('locked' | 'password' | 'not-configured')
async function checkAdmin(request, env) {
  if (!env.ADMIN_ID || !env.ADMIN_PASSWORD) return 'not-configured';
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const failKey = 'fail:' + ip;
  const fails = Number(await env.NOTICES.get(failKey) || 0);
  if (fails >= MAX_FAILS) return 'locked';

  let id = '', pw = '';
  const h = request.headers.get('Authorization') || '';
  if (h.startsWith('Basic ')) {
    try {
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(h.slice(6)), c => c.charCodeAt(0)));
      const at = decoded.indexOf(':');
      id = decoded.slice(0, at).trim();
      pw = decoded.slice(at + 1);
    } catch (e) { /* 형식이 틀리면 빈 값으로 실패 처리 */ }
  }
  const ok = await same(id, env.ADMIN_ID) & await same(pw, env.ADMIN_PASSWORD);
  if (!ok) {
    await env.NOTICES.put(failKey, String(fails + 1), { expirationTtl: LOCK_SECONDS });
    return 'password';
  }
  return true;
}

// 글자 수가 달라도 비교 시간이 같도록 해시끼리 비교한다
async function same(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(v => crypto.subtle.digest('SHA-256', enc.encode(String(v)))));
  const u = new Uint8Array(x), w = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ w[i];
  return diff === 0;
}

async function readInput(request) {
  const data = await request.json().catch(() => ({}));
  const clean = (v, max) => String(v || '').replace(/\r/g, '').trim().slice(0, max);
  return { title: clean(data.title, MAX_TITLE), body: clean(data.body, MAX_BODY) };
}

function today() {
  // 한국 시간 기준 yyyy.MM.dd
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
