// functions/robots.txt.js - Dynamic robots.txt for Cloudflare Pages

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const origin = url.origin;

    const robots = `User-agent: *
Allow: /
Disallow: /api/admin/
Disallow: /api/auth/

# Dynamic XML Sitemap
Sitemap: ${origin}/sitemap.xml
`;

    return new Response(robots, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400'
        }
    });
}
