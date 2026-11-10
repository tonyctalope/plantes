import { html } from 'hono/html';
import { page } from './layout.ts';

export interface ConsentView {
  clientName: string;
  verifiedHost: string | null;
  redirect: { kind: 'web'; host: string } | { kind: 'loopback'; host: string };
  email: string;
  requestId: string;
  csrfToken: string;
  switchAccountUrl: string;
}

export function consentPage(view: ConsentView) {
  const destination =
    view.redirect.kind === 'web'
      ? html`<strong>${view.redirect.host}</strong>`
      : html`une application de cet appareil (<code>${view.redirect.host}</code>)`;
  return page(
    'Autoriser l’accès',
    html`<div class="logo" aria-hidden="true">🪴</div>
      <h1>Autoriser « ${view.clientName} » à accéder à tes plantes ?</h1>
      <dl class="box">
        <dt>Compte</dt>
        <dd>${view.email} · <a href="${view.switchAccountUrl}">changer</a></dd>
        <dt>Application</dt>
        <dd>
          ${view.clientName}
          ${
            view.verifiedHost
              ? html`<span class="muted">(identité publiée par ${view.verifiedHost})</span>`
              : html`<span class="muted">(nom déclaré par l’application)</span>`
          }
        </dd>
        <dt>Retour vers</dt>
        <dd>${destination}</dd>
      </dl>
      <p>Elle pourra :</p>
      <ul>
        <li>voir les plantes, leurs fiches et l’historique d’entretien ;</li>
        <li>ajouter et modifier des plantes, enregistrer les arrosages ;</li>
        <li>créer des liens d’envoi de photo.</li>
      </ul>
      ${
        view.redirect.kind === 'loopback'
          ? html`<p class="warn">
              N’accepte que si tu viens de lancer la connexion toi-même depuis Claude Code (ou une autre application)
              sur cet ordinateur.
            </p>`
          : ''
      }
      <div class="actions">
        <form method="post" action="/oauth/consent">
          <input type="hidden" name="request" value="${view.requestId}" />
          <input type="hidden" name="csrf" value="${view.csrfToken}" />
          <button class="secondary" name="decision" value="deny" type="submit">Refuser</button>
        </form>
        <form method="post" action="/oauth/consent">
          <input type="hidden" name="request" value="${view.requestId}" />
          <input type="hidden" name="csrf" value="${view.csrfToken}" />
          <button class="primary" name="decision" value="allow" type="submit">Autoriser</button>
        </form>
      </div>`,
  );
}
