import { html } from 'hono/html';
import { page } from './layout.ts';

export interface UploadView {
  nickname: string;
  commonName: string;
  hasPhoto: boolean;
  status?: { kind: 'ok' } | { kind: 'error'; message: string };
  action: string;
}

export function uploadPage(view: UploadView) {
  return page(
    'Photo de la plante',
    html`<div class="logo" aria-hidden="true">📷</div>
      <h1>Photo de « ${view.nickname} »</h1>
      <p class="muted">${view.commonName}</p>
      ${
        view.status?.kind === 'ok'
          ? html`<p class="ok" role="status">Photo enregistrée ✓</p>
              <p class="muted">Tu peux fermer cette page, ou en choisir une autre pour la remplacer.</p>`
          : ''
      }
      ${view.status?.kind === 'error' ? html`<p class="error" role="alert">${view.status.message}</p>` : ''}
      ${
        view.status?.kind !== 'ok' && view.hasPhoto
          ? html`<p class="muted">Cette plante a déjà une photo : une nouvelle la remplacera.</p>`
          : ''
      }
      <form method="post" action="${view.action}" enctype="multipart/form-data">
        <label for="photo" class="muted">Choisis la photo (ou prends-en une) :</label>
        <p><input id="photo" name="photo" type="file" accept="image/*" required /></p>
        <button class="primary" type="submit">Envoyer la photo</button>
      </form>
      <p class="muted" style="margin-top:18px">
        Les informations de localisation de la photo sont supprimées à l’envoi.
        <a href="/">Ouvrir l’appli</a>
      </p>`,
  );
}
