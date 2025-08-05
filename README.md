# NicotineTracker

A Flask-based web application for tracking nicotine pouch consumption, setting goals, and monitoring usage patterns.

## Overview

NicotineTracker helps users monitor their nicotine pouch intake by providing detailed logging, analytics, and goal-setting features. The application tracks daily consumption, provides insights through charts and statistics, and helps users manage their nicotine usage effectively.

## Features

### Core Functionality
- **User Authentication**: Secure registration, login, and password reset
- **Consumption Logging**: Track nicotine pouch usage with date, time, quantity, and notes
- **Pouch Catalog**: Manage default and custom nicotine pouch brands with varying strengths
- **Goal Setting**: Set daily limits for pouches or nicotine content (mg)
- **Analytics Dashboard**: Visual charts and insights about usage patterns

### Analytics & Insights
- Daily intake tracking (pouches and nicotine mg)
- Weekly averages and trends
- Hourly usage distribution
- Goal progress monitoring with streak tracking
- Usage insights and comparisons

## Project Structure

```
NicotineTracker/
├── app.py                 # Main Flask application
├── config.py             # Configuration settings
├── extensions.py         # Flask extensions initialization
├── requirements.txt      # Python dependencies
├── package.json          # Node.js dependencies (Tailwind CSS)
├── models/               # Database models
│   ├── user.py          # User model with authentication
│   ├── pouch.py         # Nicotine pouch products
│   ├── log.py           # Consumption logs
│   └── goal.py          # User goals and targets
├── routes/               # Application routes/blueprints
│   ├── auth.py          # Authentication routes
│   ├── dashboard.py     # Main dashboard and analytics
│   ├── logging.py       # Consumption logging
│   ├── catalog.py       # Pouch management
│   ├── goals.py         # Goal setting and tracking
│   ├── profile.py       # User profile management
│   ├── settings.py      # Application settings
│   └── import_export.py # Data import/export
├── services/             # Business logic services
│   ├── user_service.py  # User-related operations
│   ├── pouch_service.py # Pouch management
│   ├── log_service.py   # Logging operations
│   └── goal_service.py  # Goal management
├── templates/            # HTML templates
│   ├── base.html        # Base template
│   ├── index.html       # Landing page
│   ├── auth/            # Authentication templates
│   ├── dashboard/       # Dashboard templates
│   ├── logging/         # Logging templates
│   ├── catalog/         # Catalog templates
│   ├── goals/           # Goal templates
│   └── errors/          # Error pages
├── static/               # Static assets
│   ├── css/             # Stylesheets (Tailwind CSS)
│   └── js/              # JavaScript files
├── migrations/           # Database migrations
└── instance/             # Instance-specific files (database)
```

## Technology Stack

### Backend
- **Flask**: Python web framework
- **SQLAlchemy**: Database ORM
- **Flask-Migrate**: Database migrations
- **Flask-Bcrypt**: Password hashing
- **Flask-Mail**: Email functionality
- **SQLite**: Database (development)

### Frontend
- **Tailwind CSS**: Utility-first CSS framework
- **Preline UI**: UI components
- **ApexCharts**: Interactive charts and graphs
- **Lodash**: JavaScript utility library

## Installation & Setup

### Prerequisites
- Python 3.8+
- Node.js 16+
- npm or yarn

### Installation Steps

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd NicotineTracker
   ```

2. **Set up Python environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Install Node.js dependencies**
   ```bash
   npm install
   ```

4. **Environment Configuration**
   
   The application supports automatic environment detection and configuration switching. Choose your environment setup:

   #### Quick Start (Development)
   ```bash
   # Copy the development environment file
   cp .env.development .env
   
   # Or set environment variable directly
   export FLASK_ENV=development
   
   # Run the application
   python run.py
   ```

   #### Custom Environment Setup
   Create a `.env` file in the root directory with your specific configuration:
   ```env
   FLASK_ENV=development
   SECRET_KEY=your-secret-key-here
   DATABASE_URL=sqlite:///nicotine_tracker.db
   MAIL_SERVER=smtp.gmail.com
   MAIL_PORT=587
   MAIL_USERNAME=your-email@gmail.com
   MAIL_PASSWORD=your-app-password
   MAIL_DEFAULT_SENDER=your-email@gmail.com
   ```

5. **Initialize Database**
   ```bash
   flask db init
   flask db migrate -m "Initial migration"
   flask db upgrade
   ```

6. **Run the Application**
   ```bash
   python app.py
   ```

   The application will be available at `http://localhost:5050`

## Environment Configuration

### Environment Types

The application supports four environment types:

1. **Development** (`development`) - For local development
2. **Production** (`production`) - For production deployment
3. **Testing** (`testing`) - For running tests
4. **Staging** (`staging`) - For staging/pre-production environment

### How Environment Detection Works

The application automatically detects the environment using the `FLASK_ENV` environment variable:

- If `FLASK_ENV=production`, it uses `ProductionConfig`
- If `FLASK_ENV=development`, it uses `DevelopmentConfig`
- If `FLASK_ENV=testing`, it uses `TestingConfig`
- If `FLASK_ENV=staging`, it uses `StagingConfig`
- If `FLASK_ENV` is not set, it defaults to `DevelopmentConfig`

### Setting Up Different Environments

#### 1. Development Environment

For local development:

```bash
# Copy the development environment file
cp .env.development .env

# Or set environment variable directly
export FLASK_ENV=development

# Run the application
python run.py
```

**Development Features:**
- Debug mode enabled
- SQLite database
- CSRF protection disabled
- Relaxed security settings
- Console logging

#### 2. Production Environment

For production deployment:

```bash
# Copy and customize the production environment file
cp .env.production .env

# Edit .env with your production values:
# - Set a strong SECRET_KEY
# - Configure production database URL
# - Set up email configuration
# - Adjust file paths as needed

# Set environment variable
export FLASK_ENV=production

# Run with uWSGI (recommended for production)
uwsgi --ini uwsgi.ini
```

**Production Features:**
- Debug mode disabled
- Enhanced security (CSRF enabled, secure cookies)
- Production database (PostgreSQL/MySQL recommended)
- Structured logging
- Email functionality enabled

#### 3. Testing Environment

For running tests:

```bash
export FLASK_ENV=testing
python -m pytest
```

**Testing Features:**
- In-memory SQLite database
- Email sending disabled
- CSRF protection disabled
- Debug mode enabled

### Environment Variables Reference

#### Core Settings

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `FLASK_ENV` | Environment type | `development` | No |
| `SECRET_KEY` | Flask secret key | Auto-generated for dev | Yes (prod) |
| `DATABASE_URL` | Database connection string | SQLite file | Yes (prod) |

#### Security Settings

| Variable | Description | Default | Environment |
|----------|-------------|---------|-------------|
| `WTF_CSRF_ENABLED` | Enable CSRF protection | `False` (dev), `True` (prod) | All |
| `SESSION_LIFETIME` | Session duration in seconds | `86400` (24h) | All |

#### Email Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `MAIL_SERVER` | SMTP server | None | Prod |
| `MAIL_PORT` | SMTP port | `587` | No |
| `MAIL_USE_TLS` | Use TLS | `True` | No |
| `MAIL_USERNAME` | SMTP username | None | Prod |
| `MAIL_PASSWORD` | SMTP password | None | Prod |
| `MAIL_DEFAULT_SENDER` | Default sender email | None | Prod |

#### Application Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `MAX_CONTENT_LENGTH` | Max upload size in bytes | `16777216` (16MB) |
| `UPLOAD_FOLDER` | Upload directory | `uploads` |
| `LOGS_PER_PAGE` | Pagination size | `20` |
| `LOG_TO_STDOUT` | Log to console | `False` (dev), `True` (prod) |
| `LOG_LEVEL` | Logging level | `INFO` |

#### Development Server Settings

| Variable | Description | Default |
|----------|-------------|---------|
| `FLASK_HOST` | Development server host | `0.0.0.0` |
| `FLASK_PORT` | Development server port | `5050` |

### Quick Start Examples

#### Local Development
```bash
# Quick start with development defaults
cp .env.development .env
python run.py
```

#### Production Deployment
```bash
# Set up production environment
cp .env.production .env
# Edit .env with your production values
export FLASK_ENV=production
uwsgi --ini uwsgi.ini
```

#### Testing
```bash
# Run tests
export FLASK_ENV=testing
python -m pytest
```

### Configuration Verification

When you start the application, it will display the current configuration:

```
Starting Flask app in development mode
Debug mode: True
Database: sqlite:///nicotine_tracker_dev.db
```

This helps verify that the correct environment is being used.

### Security Notes

1. **Never commit `.env` files** - They're already in `.gitignore`
2. **Use strong secret keys in production** - Generate with `python -c "import secrets; print(secrets.token_hex(32))"`
3. **Use production databases** - PostgreSQL or MySQL recommended over SQLite
4. **Enable HTTPS in production** - Required for secure cookies
5. **Set up proper email configuration** - Required for password resets and notifications

### Troubleshooting

#### Environment not detected correctly
- Check that `FLASK_ENV` is set correctly
- Verify `.env` file is in the project root
- Ensure `python-dotenv` is installed

#### Database issues
- Check `DATABASE_URL` format
- Ensure database server is running (for production)
- Run migrations: `flask db upgrade`

#### Email not working
- Verify SMTP settings
- Check firewall/network restrictions
- Test with a simple SMTP client first

## Usage Guide

### Getting Started
1. **Register**: Create a new account with email and password
2. **Set up Profile**: Add optional profile information (age, gender, weight)
3. **Add Pouches**: Browse the catalog or add custom nicotine pouch brands
4. **Start Logging**: Record your nicotine pouch consumption

### Logging Consumption
- Navigate to "Add Log" to record usage
- Select from existing pouches or add custom entries
- Specify quantity, date, time, and optional notes
- View logs in the "View Logs" section

### Setting Goals
- Create daily limits for pouches or nicotine content (mg)
- Track progress with visual indicators
- Monitor streaks and achievements
- Receive notifications when approaching limits

### Analytics Dashboard
- **Daily Intake**: Current day's consumption summary
- **Charts**: Visual representation of usage patterns
- **Weekly Trends**: Compare current week with previous weeks
- **Hourly Distribution**: See when you consume most pouches
- **Insights**: Automated analysis and recommendations

## Database Models

### User
- Authentication and profile information
- Preferences and settings
- Relationships to logs, goals, and custom pouches

### Pouch
- Nicotine pouch products with brand and strength
- Default system pouches and user-created custom pouches

### Log
- Individual consumption records
- Links to pouches or custom entries
- Quantity, date, time, and notes

### Goal
- User-defined consumption targets
- Daily limits for pouches or nicotine mg
- Streak tracking and progress monitoring

## API Endpoints

### Dashboard APIs
- `GET /dashboard/api/daily_intake_chart` - Daily consumption data
- `GET /dashboard/api/weekly_averages` - Weekly trend analysis
- `GET /dashboard/api/hourly_distribution` - Usage by hour
- `GET /dashboard/api/insights` - Usage insights and tips

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout
- `POST /auth/forgot-password` - Password reset

## Configuration

### Development Settings
- Debug mode enabled
- SQLite database
- Relaxed security settings
- CSRF protection disabled

### Production Settings
- Debug mode disabled
- MySQL/PostgreSQL database
- Enhanced security settings
- CSRF protection enabled

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For issues, questions, or contributions, please create an issue in the repository or contact the development team.
