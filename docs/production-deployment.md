# Production Deployment

This project is designed to use the same codebase in two separate environments:

- `DEV`: local/Kali, DEV Firebase, DEV R2 bucket, PawaPay sandbox
- `PROD`: VPS/CyberPanel, PROD Firebase, PROD R2 bucket, live PawaPay

Deploying moves code only. It does not copy users, movies, subscriptions, or uploads from DEV into PROD.

## One-Time VPS Preparation

1. Install Node.js 20+ and npm.
2. Install PM2 globally:

```bash
npm install -g pm2
```

3. Clone the repository onto the VPS:

```bash
git clone <your-github-repo-url> /home/your-user/apps/ugmovies247
cd /home/your-user/apps/ugmovies247
```

4. Create the production env file on the VPS:

```bash
cp .env.prod.example .env.production
nano .env.production
```

Fill in real production secrets and values. Do not reuse DEV secrets.

For this project, production should live in:

- `.env.production` on the VPS

DEV stays in:

- `.env.local` on your Kali development machine

5. Install dependencies and build once:

```bash
npm ci
npm run build
```

6. Start the web app and worker with PM2:

```bash
pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup
```

## Production Env Notes

Next.js automatically reads `.env.production` during `next build` and `next start`.

The video worker also loads the Next env files through `@next/env`, so it will read `.env.production` when run on the VPS from the project root.

That means this rollout can stay simple:

- keep DEV secrets in `.env.local`
- keep PROD secrets in `.env.production`
- do not commit either file

At minimum, production must provide:

- `NEXT_PUBLIC_APP_ENV=production`
- `APP_BASE_URL=https://ugmovies247.com`
- `PAWAPAY_ENV=production`
- `PAWAPAY_BASE_URL=https://api.pawapay.io`
- `PAWAPAY_API_TOKEN=<live token>`
- `R2_PUBLIC_BASE_URL=<your production public media base url>`

## Manual Deploy Workflow

From your Kali DEV machine:

```bash
git add .
git commit -m "Your change"
git push origin main
```

On the VPS:

```bash
cd /home/your-user/apps/ugmovies247
bash scripts/deploy-production.sh
```

The deploy script runs:

1. `git fetch`
2. `git checkout main`
3. `git pull --ff-only`
4. `npm ci`
5. `npm run build`
6. `pm2 startOrReload ecosystem.config.cjs --env production`
7. `pm2 save`

## Useful PM2 Commands

```bash
pm2 status
pm2 logs ugmovies247-web
pm2 logs ugmovies247-worker
pm2 restart ugmovies247-web
pm2 restart ugmovies247-worker
pm2 stop ugmovies247-web
pm2 stop ugmovies247-worker
```

If you customize the PM2 app names, set:

- `PM2_APP_NAME`
- `PM2_WORKER_NAME`

before starting the ecosystem.

## Production Checklist

- Production domain resolves to the VPS and serves HTTPS
- `APP_BASE_URL` matches the real domain exactly
- PawaPay live dashboard callback points to `/api/webhooks/pawapay`
- Firebase production project values are in the VPS env
- Firebase production Auth Email/Password is enabled
- Firestore production rules/indexes are deployed
- Production R2 bucket and public base URL are configured
- PM2 web app is running
- PM2 worker is running

## Known Production Risk

Premium playback still depends on public media URLs once a subscriber receives them. The current server-side access control prevents unsubscribed users from receiving premium playback metadata through the app, but direct leaked public URLs remain a residual risk.

Recommended next hardening step:

- move production media to private access with signed delivery or a protected media proxy
