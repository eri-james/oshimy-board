// Cloudflare Pages Edge Middleware
// Dynamically rewrites OpenGraph & Twitter image tags for Discord / social bot embeds

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);

    // Skip API routes and assets with file extensions (.js, .css, .png, etc.)
    if (url.pathname.startsWith('/api') || (url.pathname.includes('.') && !url.pathname.endsWith('.html'))) {
        return next();
    }

    const response = await next();
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
        return response;
    }

    // If Cloudflare D1 database is attached, query current banner_url
    if (env && env.DB) {
        try {
            const row = await env.DB.prepare('SELECT value FROM site_settings WHERE key = ?').bind('banner_url').first();
            if (row && row.value && row.value.trim()) {
                const bannerUrl = row.value.trim();
                return new HTMLRewriter()
                    .on('meta[property="og:image"]', {
                        element(el) {
                            el.setAttribute('content', bannerUrl);
                        }
                    })
                    .on('meta[name="twitter:image"]', {
                        element(el) {
                            el.setAttribute('content', bannerUrl);
                        }
                    })
                    .transform(response);
            }
        } catch (e) {
            console.error('Error rewriting social metadata:', e);
        }
    }

    return response;
}
