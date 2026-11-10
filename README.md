# 🪴 Plantes

Les plantes de la maison, partagées par tout le foyer :

- **Ajout uniquement via Claude** : on envoie une photo à Claude, il identifie la plante et remplit toute la fiche
  (espèce, lumière, arrosage, humidité, température, substrat, engrais, toxicité pour les animaux…) grâce au
  serveur **MCP** intégré. L'appli n'a volontairement pas de formulaire d'ajout.
- **Rappels d'arrosage** en notification push (PWA Android/iOS/desktop), une fois par jour à l'heure choisie par
  chacun, avec un rythme différent en saison de croissance (avril–septembre) et au repos.
- **Partagé** : n'importe quel membre coche « Arrosé », et les rappels s'arrêtent pour tout le monde.
- **Connexion Google** réservée à une **allowlist d'adresses e-mail**.

## Comment ça marche

```
 Téléphone / PC                         Serveur (un seul conteneur Node 26)
 ─────────────                          ─────────────────────────────────────
 Claude (appli, claude.ai, Claude Code)  ──MCP + OAuth 2.1──▶  /mcp          outils : add_plant, log_care…
        │ « ajoute cette plante »                              /oauth/*      serveur d'autorisation (PKCE, iss)
        │                                                      /p/<jeton>    envoi de la photo
 Navigateur / PWA  ──cookie de session──▶  /api/*  /photos/*   /auth/google  connexion Google + allowlist
        ▲                                                      SQLite (data/plantes.db) + data/photos
        └──────── Web Push (rappels) ◀── tâche planifiée chaque minute
```

### Ajouter une plante

1. Dans Claude (application mobile, claude.ai ou Claude Code), envoie une photo : « ajoute cette plante, elle est
   dans le salon près de la fenêtre est ».
2. Claude identifie la plante (il demande une autre photo s'il hésite), vérifie les doublons et appelle `add_plant`
   avec une fiche complète en français.
3. **La photo** : Claude voit l'image mais ne peut pas en transmettre les octets à un outil MCP. `add_plant` renvoie
   donc un lien d'envoi à usage limité (24 h) :
   - dans **Claude Code**, Claude l'envoie lui-même : `curl -F "photo=@plante.jpg" <lien>` ;
   - sur **l'appli mobile / claude.ai**, Claude te donne le lien : un appui, tu choisis la photo, c'est fait.
     (Si l'exécution de code est activée avec ce domaine autorisé, Claude peut aussi l'envoyer depuis son bac à sable.)

Les photos sont réorientées, réduites (1600 px + vignette 480 px) et **toutes les métadonnées sont supprimées**
(position GPS du domicile comprise).

### Outils MCP

| Outil                      | Rôle                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------- |
| `list_plants`              | Plantes, pièces et état d'arrosage                                                            |
| `get_plant`                | Fiche complète, historique, photo (pour un diagnostic)                                        |
| `add_plant`                | Ajout avec fiche complète + lien photo                                                        |
| `update_plant`             | Modifier n'importe quel champ                                                                 |
| `log_care`                 | Arrosage (ou engrais, rempotage…) d'une ou plusieurs plantes, maintenant ou à une date passée |
| `get_due_plants`           | « Qu'est-ce que je dois arroser ? »                                                           |
| `snooze_watering`          | Reporter (terre encore humide)                                                                |
| `create_photo_upload_link` | Ajouter/remplacer une photo                                                                   |
| `archive_plant`            | Plante morte ou donnée (restaurable dans l'appli)                                             |

## Connecter Claude

L'URL du serveur MCP est `https://<ton-domaine>/mcp` (affichée dans Réglages).

- **claude.ai / application mobile / Claude Desktop** : Paramètres → Connecteurs → _Ajouter un connecteur
  personnalisé_ → nom « Plantes », l'URL ci-dessus → _Se connecter_. Tu passes par la connexion Google, puis tu
  autorises Claude. Le connecteur est ensuite disponible sur tous tes appareils.
- **Claude Code** : `claude mcp add --transport http plantes https://<ton-domaine>/mcp`, puis `/mcp` →
  _Authenticate_.

Chaque connexion apparaît dans Réglages → _Applications connectées_, d'où on peut la révoquer.

## Sécurité

- **Connexion** : OpenID Connect avec Google (code + PKCE + `state` + `nonce`, jeton d'identité vérifié par
  [openid-client](https://github.com/panva/openid-client)). Seules les adresses de `ALLOWED_EMAILS` dont l'e-mail
  est vérifié par Google entrent. L'allowlist est revérifiée **à chaque requête** : retirer une adresse coupe
  immédiatement ses sessions et ses connexions Claude.
- **Sessions** : cookie `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`, 30 jours glissants ; toutes les requêtes
  qui modifient quelque chose exigent l'en-tête `Origin` du site (anti-CSRF) ; le formulaire de consentement a en
  plus un jeton CSRF lié à la session.
- **Serveur d'autorisation MCP** ([spec 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)) :
  OAuth 2.1, PKCE S256 obligatoire, paramètre `iss` (RFC 9207), jetons liés à la ressource `/mcp` (RFC 8707),
  métadonnées RFC 8414 / RFC 9728. Enregistrement des clients par _Client ID Metadata Document_ (récupéré seulement
  depuis `claude.ai`, `claude.com`, `anthropic.com`) ou par enregistrement dynamique, dans les deux cas **limités aux
  adresses de retour exactes de Claude et au loopback** — un site tiers ne peut pas se faire passer pour un client.
  Écran de consentement explicite à chaque connexion.
- **Jetons** : aléatoires 256 bits, stockés uniquement hachés (SHA-256) ; accès 1 h, rafraîchissement 90 jours avec
  rotation et détection de réutilisation (révocation de toute la connexion), rejeu d'un code = révocation.
- **En-têtes** : CSP stricte (aucun script inline ni ressource externe), HSTS, `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`.
- **Abus** : corps de requête limités (256 Ko, 20 Mo pour les photos, vérifiés avant lecture), limitation de débit
  par IP (par /64 en IPv6) et par connexion Claude, plafonds de plantes, de liens photo et de lignes anonymes, une
  seule photo décodée à la fois (anti « bombe » d'image).
- **Conteneur** : utilisateur non-root, système de fichiers en lecture seule, aucune capacité Linux, mémoire et nombre
  de processus plafonnés.

## Déploiement

1. **Client OAuth Google** — [console Google Cloud](https://console.cloud.google.com/apis/credentials) →
   _Créer des identifiants_ → _ID client OAuth_ → _Application Web_ :
   - origine JavaScript autorisée : `https://<ton-domaine>`
   - URI de redirection autorisée : `https://<ton-domaine>/auth/google/callback`
   - écran de consentement : type _Externe_, champs d'application `openid`, `email`, `profile` uniquement.
2. **Configuration** : copie `.env.example` en `.env` et remplis `PUBLIC_URL`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAILS` (et éventuellement `HOUSEHOLD_CONTEXT`).
3. **Lancement** derrière Traefik avec [`compose.yaml`](compose.yaml) (image multi-arch
   `ghcr.io/tonyctalope/plantes:latest`, amd64 + arm64) :

   ```sh
   mkdir -p data && docker compose up -d
   docker compose logs -f
   ```

Mise à jour : `docker compose pull && docker compose up -d`.

**Données** : tout est dans `data/` (`plantes.db` + `photos/`). Une copie cohérente de la base est écrite chaque nuit
dans `data/backups/` (14 jours). Sauvegarde le dossier `data/` entier.

## Développement

Node 26 (le serveur tourne directement en TypeScript, sans compilation).

```sh
npm install
cp .env.example .env   # PUBLIC_URL=http://localhost:5173, NODE_ENV=development, DEV_LOGIN=1
npm run dev            # API sur :8787
npm run dev:web        # interface sur :5173 (proxy vers l'API)
npm test               # 46 tests : OAuth, MCP de bout en bout avec le SDK client officiel, OIDC, sécurité…
npm run typecheck
```

`DEV_LOGIN=1` remplace Google par une page qui connecte directement une adresse de l'allowlist ; il est refusé hors
de `localhost` et sans `NODE_ENV=development`.

## Licence

[MIT](LICENSE)
