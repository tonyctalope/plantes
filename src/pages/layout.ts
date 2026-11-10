import { html, raw } from 'hono/html';

// Server-rendered pages (OAuth consent, photo upload, errors): no JavaScript,
// all interpolations escaped by hono/html.

const STYLE = raw(`<style>
:root{color-scheme:light dark;--bg:#f4f1ea;--card:#fffdf8;--ink:#1f2a1f;--muted:#5d6b5d;--line:#dcd6c8;--green:#2f6b3a;--green-ink:#fff;--warn-bg:#fff3d6;--warn-ink:#6b4a00;--danger:#a3341f}
@media (prefers-color-scheme:dark){:root{--bg:#121812;--card:#1b231b;--ink:#e8efe6;--muted:#a3b2a1;--line:#2e3a2e;--green:#7fc08a;--green-ink:#0f1a10;--warn-bg:#3a2f12;--warn-ink:#f5d58a;--danger:#ff8a73}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px 16px}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px 24px;box-shadow:0 10px 30px rgb(0 0 0/.06)}
.logo{font-size:40px;line-height:1;margin-bottom:8px}h1{font-size:1.35rem;margin:.2em 0 .6em;line-height:1.25}p{margin:.6em 0}.muted{color:var(--muted);font-size:.93rem}
.box{border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin:14px 0}.box dt{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.box dd{margin:0 0 8px;word-break:break-word}.box dd:last-child{margin-bottom:0}
.warn{background:var(--warn-bg);color:var(--warn-ink);border-radius:12px;padding:10px 12px;font-size:.92rem;margin:12px 0}
.actions{display:flex;gap:10px;margin-top:18px}.actions form{flex:1}
button,.button{display:block;width:100%;border:0;border-radius:12px;padding:13px 16px;font:600 1rem system-ui,sans-serif;cursor:pointer;text-align:center;text-decoration:none}
.primary{background:var(--green);color:var(--green-ink)}.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
button:focus-visible,.button:focus-visible,input:focus-visible{outline:3px solid var(--green);outline-offset:2px}
input[type=file]{width:100%;padding:14px;border:2px dashed var(--line);border-radius:14px;background:transparent;color:var(--ink);font-size:1rem}
.ok{color:var(--green);font-weight:600}.error{color:var(--danger);font-weight:600}ul{padding-left:1.2em}li{margin:.25em 0}code{font-size:.9em}
</style>`);

export function page(title: string, body: unknown) {
  return html`<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>${title} · Plantes</title>
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        ${STYLE}
      </head>
      <body>
        <main>${body}</main>
      </body>
    </html>`;
}

export function messagePage(title: string, message: string, link?: { href: string; label: string }) {
  return page(
    title,
    html`<div class="logo" aria-hidden="true">🪴</div>
      <h1>${title}</h1>
      <p>${message}</p>
      ${link ? html`<p><a class="button primary" href="${link.href}">${link.label}</a></p>` : ''}`,
  );
}
