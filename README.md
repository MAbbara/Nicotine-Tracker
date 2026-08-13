# NicotineTracker

NicotineTracker is a Flask application for logging nicotine use, responding to
cravings, following a nicotine-first reduction plan, and reviewing trends. The
daily experience is built around Today, while Journey and Insights provide
progressive planning and analysis.

## Runtime

- Python 3.11 and Flask 2.3
- MariaDB 11.4 in production; SQLite is limited to development and tests
- Redis-backed Flask-Limiter counters in production
- Tailwind CSS 4.3
- uWSGI behind one trusted HTTPS reverse proxy
- One named PM2 notification worker (`TrackerNotifications`)

## Local development

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt -r requirements-dev.txt
npm ci
cp .env.dev.example .env
npm run build:css
python run.py
```

The development server listens on `0.0.0.0:5050` unless `FLASK_HOST` or
`FLASK_PORT` overrides it. Do not use the Flask development server in
production.

## Tests

```bash
.venv/bin/python -m pytest -q
npm test
npm run build:css
npx playwright test --workers=1 --retries=0
```

Migration tests can also run against a disposable MySQL 8.4 database. Point
`TEST_MYSQL_URL` at an empty database whose name begins exactly with
`nicotine_tracker_test_`, then invoke the selected suites with `--db=mysql`.

## Production configuration

Copy `.env.prod.example` to `.env`, replace every `CHANGE_ME` value, and
keep that file readable only by the service account.

Production startup fails closed unless all of these are true:

- `SECRET_KEY` is a high-entropy secret of at least 32 characters.
- `DATABASE_URL` names a MySQL database using the `mysql+pymysql` driver.
- `SERVER_NAME` is a canonical non-local hostname and
  `PREFERRED_URL_SCHEME=https`.
- `RATELIMIT_STORAGE_URI` is the approved single-host Redis endpoint
  `redis://127.0.0.1:6379/4` or a concrete non-loopback Redis endpoint.
- `RATELIMIT_HMAC_SECRET` is strong and independent from `SECRET_KEY`.
- `RATELIMIT_KEY_PREFIX` uniquely identifies this deployment.
- `RATELIMIT_TRUSTED_PROXY_COUNT` and `PROXY_FIX_X_PROTO_COUNT` match the exact
  number of trusted hops setting `X-Forwarded-For` and `X-Forwarded-Proto`.
- `LOG_TO_STDOUT=True`.

The supplied values assume one local reverse proxy. If the proxy topology is
different, determine the actual header chain before changing the hop counts.
Never increase a trusted hop count simply to make a header appear to work.

## Manual production deployment

Production uses uWSGI on `127.0.0.1:8090` and one PM2 worker named
`TrackerNotifications`. Back up the production database using the hosting
platform before applying migrations, then run as the `nicotinetracker` user:

```bash
cd /home/nicotinetracker/htdocs/nicotinetracker.com
git pull --ff-only
source venv/bin/activate
python -m pip install -r requirements.txt
npm ci
npm run build:css
flask db upgrade
pm2 restart TrackerNotifications --update-env
pm2 save
touch /home/nicotinetracker/reload.uwsgi
```

Confirm the website and worker are healthy after deployment. Keep `.env`
secrets out of terminal transcripts, screenshots, and source control.

## Background processing

The worker schedules notification delivery, reminders, weekly reports, goal
threshold checks, and token cleanup. Run exactly one scheduler process unless
the scheduling layer is redesigned for distributed leadership. Notification
delivery rows use database leases for safe concurrent processing, but the
in-process scheduler itself is not a distributed cron coordinator.

For local debugging only:

```bash
source .venv/bin/activate
python run_background_tasks.py
```

## Frontend build

Tailwind source is `static/css/tailwind.css`; `static/css/style.css` is the
generated artifact served by Flask.

```bash
npm run build:css
```

Commit source and generated CSS together when styles change. A production
deploy must rebuild after `npm ci` and before restarting the web service.

## Security notes

- Never commit `.env`, database dumps, SMTP credentials, Redis credentials, or
  Discord webhook URLs.
- Keep CSRF enabled and secure cookies on in production.
- Trust forwarded headers only from the known reverse proxy chain.
- Keep uWSGI bound to loopback; expose only the HTTPS reverse proxy.
- Monitor 429s, notification failures, authentication events, and service
  restart loops through centralized logs.

## License

See `LICENSE`.
