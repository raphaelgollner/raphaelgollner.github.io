// Busca os jogos do itch.io e os vídeos do YouTube e grava em data/feed.json.
// Roda no GitHub Actions (Node 20+, sem dependências). Também dá pra rodar local:
//   node scripts/update-feed.mjs

import { writeFile, mkdir, readFile } from 'node:fs/promises';

const ITCH_USER = 'raphaelgollner';
const YT_CHANNEL = 'UCQ6ZV6V-MYi5WFcZnn1TT0w';
const MAX_VIDEOS = 9;
const OUT = new URL('../data/feed.json', import.meta.url);
const UA = { 'User-Agent': 'Mozilla/5.0 (portfolio feed updater)' };

let previous = {};
try { previous = JSON.parse(await readFile(OUT, 'utf8')); } catch {}

const decode = (s = '') =>
    s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
     .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
     .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).trim();

const pick = (html, re) => { const m = html.match(re); return m ? decode(m[1]) : ''; };

async function get(url) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`${r.status} em ${url}`);
    return r.text();
}

async function itch() {
    let html = await get(`https://${ITCH_USER}.itch.io/`);
    // A página de perfil também lista coleções ("Jogos que Gostei"), que não são jogos meus.
    const cut = html.indexOf('<section class="collections"');
    if (cut > -1) html = html.slice(0, cut);

    const cells = html.split('<div class="game_cell ').slice(1);
    const games = [];
    for (const c of cells) {
        const url = pick(c, /class="title game_link"[^>]*href="([^"]+)"/);
        if (!url.startsWith(`https://${ITCH_USER}.itch.io/`)) continue;
        const game = {
            id: pick(c, /data-game_id="(\d+)"/),
            title: pick(c, /class="title game_link"[^>]*>([^<]+)</),
            url,
            blurb: pick(c, /class="game_text"[^>]*>([^<]*)</),
            genre: pick(c, /class="game_genre">([^<]+)</),
            thumb: pick(c, /data-lazy_src="([^"]+)"/) || pick(c, /<img[^>]*src="([^"]+)"/),
            cover: '',
            status: '',
            updated: '',
            platforms: [],
        };
        // Mantém os detalhes da última execução caso a página do jogo falhe (o itch limita requisições).
        const old = (previous.games || []).find((g) => g.id === game.id);
        if (old) Object.assign(game, { cover: old.cover, status: old.status, updated: old.updated, platforms: old.platforms });
        try {
            await new Promise((r) => setTimeout(r, 1500));
            const page = await get(url);
            game.cover = pick(page, /property="og:image" content="([^"]+)"/);
            game.status = pick(page, /Status<\/td><td>(?:<a[^>]*>)?([^<]+)</);
            game.updated = pick(page, /(?:Updated|Published)<\/td><td><abbr title="([^"]+)"/);
            const plat = page.match(/Platforms<\/td><td>(.*?)<\/td>/);
            if (plat) game.platforms = [...plat[1].matchAll(/>([^<]+)<\/a>/g)].map((m) => decode(m[1]));
        } catch (e) {
            console.warn('Falhou detalhe do jogo', url, e.message);
        }
        games.push(game);
    }
    return games;
}

async function youtube() {
    const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL}`);
    return xml.split('<entry>').slice(1, MAX_VIDEOS + 1).map((e) => {
        const id = pick(e, /<yt:videoId>([^<]+)</);
        return {
            id,
            title: pick(e, /<title>([^<]+)</),
            url: `https://www.youtube.com/watch?v=${id}`,
            published: pick(e, /<published>([^<]+)</),
            views: Number(pick(e, /<media:statistics views="(\d+)"/)) || 0,
            thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        };
    });
}

async function github() {
    const r = await fetch(`https://api.github.com/users/${ITCH_USER}/repos?sort=pushed&per_page=30`, {
        headers: { ...UA, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) throw new Error(`${r.status} na API do GitHub`);
    const repos = await r.json();
    return repos
        .filter((x) => !x.fork && !x.archived)
        .map((x) => ({
            name: x.name,
            url: x.html_url,
            description: x.description || '',
            language: x.language || '',
            homepage: x.homepage || '',
            pushed: x.pushed_at,
            stars: x.stargazers_count,
        }));
}


const sources = { games: itch, videos: youtube, repos: github };
const results = await Promise.allSettled(Object.values(sources).map((fn) => fn()));
const feed = { updatedAt: new Date().toISOString() };
Object.keys(sources).forEach((key, i) => {
    const r = results[i];
    // Se uma fonte falhar, mantém o que já estava salvo em vez de esvaziar a seção.
    if (r.status === 'fulfilled' && r.value.length) feed[key] = r.value;
    else {
        if (r.status === 'rejected') console.warn(`${key} falhou:`, r.reason.message);
        feed[key] = previous[key] || [];
    }
});

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify(feed, null, 2) + '\n');
console.log(`ok: ${feed.games.length} jogos, ${feed.videos.length} vídeos, ${feed.repos.length} repos`);
