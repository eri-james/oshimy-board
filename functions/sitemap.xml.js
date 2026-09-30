// functions/sitemap.xml.js - Dynamic XML Sitemap for Cloudflare Pages

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const origin = url.origin;

    const SFW_BOARDS = ['myvt', 'vt', 'vg', 'amg', 'ca', 'tech', 'mamak', 'rqr'];

    let threadUrlsXml = '';
    if (env && env.DB) {
        try {
            const placeholders = SFW_BOARDS.map(() => '?').join(',');
            const { results } = await env.DB.prepare(
                `SELECT id, board, bumped_at, created_at FROM threads WHERE board IN (${placeholders}) ORDER BY bumped_at DESC LIMIT 300`
            ).bind(...SFW_BOARDS).all();

            if (results && results.length > 0) {
                threadUrlsXml = results.map(t => {
                    const lastmod = new Date(t.bumped_at || t.created_at || Date.now()).toISOString();
                    return `  <url>\n    <loc>${origin}/?b=${t.board}&amp;t=${t.id}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>`;
                }).join('\n');
            }
        } catch (e) {
            console.error('Error generating sitemap threads:', e);
        }
    }

    const boardUrlsXml = SFW_BOARDS.map(b => `  <url>\n    <loc>${origin}/?b=${b}</loc>\n    <changefreq>hourly</changefreq>\n    <priority>0.8</priority>\n  </url>`).join('\n');

    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
${boardUrlsXml}
${threadUrlsXml ? '\n' + threadUrlsXml : ''}
</urlset>`.trim();

    return new Response(sitemap, {
        headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600'
        }
    });
}
