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
- **Notification System**: Email and Discord webhook notifications for goals, achievements, and reminders

### Analytics & Insights
- Daily intake tracking (pouches and nicotine mg)
- Weekly averages and trends
- Hourly usage distribution
- Goal progress monitoring with streak tracking
- Usage insights and comparisons

### Notification Features
- **Email Notifications**: Goal reminders, achievement alerts, daily/weekly reports
- **Discord Integration**: Real-time notifications via Discord webhooks
- **Customizable Timing**: Set daily reminder times and quiet hours
- **Notification Preferences**: Granular control over notification types
- **Background Processing**: Reliable delivery through queue-based system

## Project Structure

```
NicotineTracker/
├── app.py                      # Main Flask application
├── config.py                   # Configuration settings
├── extensions.py               # Flask extensions initialization
├── run_background_tasks.py     # Background notification processor
├── requirements.txt            # Python dependencies
├── package.json                # Node.js dependencies (Tailwind CSS)
├── models/                     # Database models
│   ├── user.py                # User model with authentication
│   ├── pouch.py               # Nicotine pouch products
│   ├── log.py                 # Consumption logs
│   ├── goal.py                # User goals and targets
│   ├── notification.py        # Notification queue and history
│   ├── user_preferences.py    # User notification preferences
│   └── user_settings.py       # User application settings
├── routes/                     # Application routes/blueprints
│   ├── auth.py                # Authentication routes
│   ├── dashboard.py           # Main dashboard and analytics
│   ├── logging.py             # Consumption logging
│   ├── catalog.py             # Pouch management
│   ├── goals.py               # Goal setting and tracking
│   ├── profile.py             # User profile management
│   ├── settings.py            # Application settings & notifications
│   └── import_export.py       # Data import/export
├── services/                   # Business logic services
│   ├── user_service.py        # User-related operations
│   ├── pouch_service.py       # Pouch management
│   ├── log_service.py         # Logging operations
│   ├── goal_service.py        # Goal management
│   ├── notification_service.py # Email and webhook notifications
│   ├── background_tasks.py    # Background task processing
│   └── user_preferences_service.py # User preference management
├── templates/                  # HTML templates
│   ├── base.html              # Base template
│   ├── index.html             # Landing page
│   ├── auth/                  # Authentication templates
│   ├── dashboard/             # Dashboard templates
│   ├── logging/               # Logging templates
│   ├── catalog/               # Catalog templates
│   ├── goals/                 # Goal templates
│   ├── settings/              # Settings templates (enhanced UI)
│   └── errors/                # Error pages
├── static/                     # Static assets
│   ├── css/                   # Stylesheets (Tailwind CSS)
│   └── js/                    # JavaScript files
├── migrations/                 # Database migrations
└── instance/                   # Instance-specific files (database)
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
2. **Use strong secret keys in production** - Generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`
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

## Notification System Setup

The NicotineTracker includes a comprehensive notification system that supports email and Discord webhook notifications. This section covers how to set up and configure the background notification processing system.

### Overview

The notification system consists of:
- **Notification Service**: Handles sending emails and Discord webhooks
- **Background Task Processor**: Processes queued notifications
- **User Preferences**: Granular control over notification types and timing
- **Queue Management**: Reliable delivery with retry logic

### Prerequisites

#### For Email Notifications
- SMTP server access (Gmail, SendGrid, etc.)
- Email credentials configured in environment variables

#### For Discord Notifications
- Discord server with webhook permissions
- Discord webhook URL from your server

### Setting Up Email Notifications

1. **Configure SMTP Settings**
   
   Add the following to your `.env` file:
   ```env
   # Email Configuration
   MAIL_SERVER=smtp.gmail.com
   MAIL_PORT=587
   MAIL_USE_TLS=True
   MAIL_USERNAME=your-email@gmail.com
   MAIL_PASSWORD=your-app-password
   MAIL_DEFAULT_SENDER=your-email@gmail.com
   ```

2. **Gmail Setup (Recommended)**
   
   For Gmail, you'll need an App Password:
   ```bash
   # 1. Enable 2-Factor Authentication on your Google account
   # 2. Go to Google Account settings > Security > App passwords
   # 3. Generate an app password for "Mail"
   # 4. Use this password in MAIL_PASSWORD (not your regular password)
   ```

3. **Alternative SMTP Providers**
   
   **SendGrid:**
   ```env
   MAIL_SERVER=smtp.sendgrid.net
   MAIL_PORT=587
   MAIL_USERNAME=apikey
   MAIL_PASSWORD=your-sendgrid-api-key
   MAIL_DEFAULT_SENDER=your-verified-sender@domain.com
   ```
   
   **Mailgun:**
   ```env
   MAIL_SERVER=smtp.mailgun.org
   MAIL_PORT=587
   MAIL_USERNAME=your-mailgun-username
   MAIL_PASSWORD=your-mailgun-password
   MAIL_DEFAULT_SENDER=your-verified-sender@domain.com
   ```

### Setting Up Discord Notifications

1. **Create Discord Webhook**
   
   In your Discord server:
   ```
   1. Go to Server Settings > Integrations > Webhooks
   2. Click "New Webhook"
   3. Choose the channel for notifications
   4. Copy the webhook URL
   ```

2. **Configure in Application**
   
   Users can add their Discord webhook URL in:
   ```
   Settings > Integrations > Discord > Discord Webhook URL
   ```

### Background Task Setup

The notification system uses a background task processor to handle queued notifications reliably.

#### Development Environment

1. **Run Background Tasks Manually**
   ```bash
   # In a separate terminal, activate your virtual environment
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   
   # Run the background task processor
   python run_background_tasks.py
   ```

2. **Verify Background Tasks**
   ```bash
   # The processor will show output like:
   # Starting background task processor...
   # Processing notification queue...
   # Processed 0 notifications
   ```

#### Production Environment

For production, you should run the background task processor as a service.

1. **Using systemd (Linux)**
   
   Create `/etc/systemd/system/nicotine-tracker-notifications.service`:
   ```ini
   [Unit]
   Description=NicotineTracker Notification Processor
   After=network.target
   
   [Service]
   Type=simple
   User=your-app-user
   WorkingDirectory=/path/to/NicotineTracker
   Environment=PATH=/path/to/NicotineTracker/venv/bin
   Environment=FLASK_ENV=production
   ExecStart=/path/to/NicotineTracker/venv/bin/python run_background_tasks.py
   Restart=always
   RestartSec=10
   
   [Install]
   WantedBy=multi-user.target
   ```
   
   Enable and start the service:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable nicotine-tracker-notifications
   sudo systemctl start nicotine-tracker-notifications
   sudo systemctl status nicotine-tracker-notifications
   ```

2. **Using Docker**
   
   Add to your `docker-compose.yml`:
   ```yaml
   version: '3.8'
   services:
     web:
       # Your main app service
       
     notifications:
       build: .
       command: python run_background_tasks.py
       environment:
         - FLASK_ENV=production
         - DATABASE_URL=${DATABASE_URL}
         - MAIL_SERVER=${MAIL_SERVER}
         - MAIL_USERNAME=${MAIL_USERNAME}
         - MAIL_PASSWORD=${MAIL_PASSWORD}
       depends_on:
         - db
       restart: unless-stopped
   ```

3. **Using Supervisor**
   
   Create `/etc/supervisor/conf.d/nicotine-tracker-notifications.conf`:
   ```ini
   [program:nicotine-tracker-notifications]
   command=/path/to/NicotineTracker/venv/bin/python run_background_tasks.py
   directory=/path/to/NicotineTracker
   user=your-app-user
   autostart=true
   autorestart=true
   redirect_stderr=true
   stdout_logfile=/var/log/nicotine-tracker-notifications.log
   environment=FLASK_ENV=production
   ```
   
   Update supervisor:
   ```bash
   sudo supervisorctl reread
   sudo supervisorctl update
   sudo supervisorctl start nicotine-tracker-notifications
   ```

4. **Using PM2 (Node.js Process Manager)**
   ```bash
   # Install PM2
   npm install -g pm2
   
   # Create ecosystem file
   cat > ecosystem.config.js << EOF
   module.exports = {
     apps: [{
       name: 'nicotine-tracker-notifications',
       script: 'run_background_tasks.py',
       interpreter: '/path/to/venv/bin/python',
       cwd: '/path/to/NicotineTracker',
       env: {
         FLASK_ENV: 'production'
       },
       restart_delay: 10000,
       max_restarts: 10
     }]
   }
   EOF
   
   # Start the process
   pm2 start ecosystem.config.js
   pm2 save
   pm2 startup
   ```

### Configuration Options

#### Background Task Settings

You can configure the background task processor by setting these environment variables:

```env
# Notification processing interval (seconds)
NOTIFICATION_PROCESS_INTERVAL=30

# Maximum retry attempts for failed notifications
NOTIFICATION_MAX_RETRIES=3

# Batch size for processing notifications
NOTIFICATION_BATCH_SIZE=10

# Enable debug logging for notifications
NOTIFICATION_DEBUG=False
```

#### Notification Types

The system supports these notification types:
- `goal_reminder` - When approaching daily limits
- `achievement` - When goals are completed
- `daily_reminder` - Daily usage reminders
- `weekly_report` - Weekly summary reports

### Testing Notifications

1. **Test Email Configuration**
   ```bash
   # Test email configuration with Flask app context
   python3 -c "
   from app import create_app
   from services.notification_service import NotificationService
   
   app = create_app()
   with app.app_context():
       service = NotificationService()
       success = service.send_test_email('your-email@example.com')
       if success:
           print('✅ Email test completed successfully!')
       else:
           print('❌ Email test failed. Check your SMTP configuration.')
   "
   ```

2. **Test Discord Webhook**
   
   Use the built-in test feature in the web interface:
   ```
   1. Go to Settings > Integrations > Discord
   2. Enter your webhook URL
   3. Click "Test" button
   4. Check your Discord channel for the test message
   ```
   
   Or test programmatically:
   ```bash
   # Test Discord webhook with Flask app context
   python3 -c "
   from app import create_app
   from services.notification_service import NotificationService
   
   app = create_app()
   with app.app_context():
       service = NotificationService()
       success, message = service.test_discord_webhook('YOUR_WEBHOOK_URL_HERE')
       print(f'Discord test: {message}')
   "
   ```

3. **Test Background Processing**
   ```bash
   # Queue a test notification with Flask app context
   python3 -c "
   from app import create_app
   from services.notification_service import NotificationService
   
   app = create_app()
   with app.app_context():
       service = NotificationService()
       success = service.queue_notification(
           user_id=1,
           notification_type='email',
           category='test',
           subject='Test Notification',
           message='This is a test notification from the queue system',
           recipient='your-email@example.com'
       )
       if success:
           print('✅ Test notification queued successfully!')
           print('Run the background processor to send it: python run_background_tasks.py')
       else:
           print('❌ Failed to queue test notification. Check user_id and database.')
   "
   ```

4. **Test SMTP Connection**
   ```bash
   # Test raw SMTP connection
   python3 -c "
   import smtplib
   from email.mime.text import MIMEText
   
   try:
       server = smtplib.SMTP('smtp.gmail.com', 587)
       server.starttls()
       server.login('your-email@gmail.com', 'your-app-password')
       print('✅ SMTP connection successful!')
       server.quit()
   except Exception as e:
       print(f'❌ SMTP connection failed: {e}')
   "
   ```

5. **Test Complete Notification Flow**
   ```bash
   # Test the complete flow: queue -> process -> send
   python3 -c "
   from app import create_app
   from services.notification_service import NotificationService
   from services.background_tasks import BackgroundTaskService
   
   app = create_app()
   with app.app_context():
       # Queue a notification
       notification_service = NotificationService()
       success = notification_service.queue_notification(
           user_id=1,
           notification_type='email',
           category='test',
           subject='Complete Flow Test',
           message='Testing the complete notification flow',
           recipient='your-email@example.com'
       )
       
       if success:
           print('✅ Notification queued')
           
           # Process the queue
           background_service = BackgroundTaskService()
           processed = background_service.process_notifications()
           print(f'✅ Processed {processed} notifications')
       else:
           print('❌ Failed to queue notification')
   "
   ```

### Monitoring and Logging

1. **Check Notification Queue**
   ```sql
   -- View pending notifications
   SELECT * FROM notification_queue WHERE status = 'pending';
   
   -- View failed notifications
   SELECT * FROM notification_queue WHERE status = 'failed';
   ```

2. **Check Notification History**
   ```sql
   -- View recent notification history
   SELECT * FROM notification_history 
   ORDER BY sent_at DESC 
   LIMIT 10;
   ```

3. **Application Logs**
   
   The notification system logs to the main application log:
   ```bash
   # View recent notification logs
   tail -f logs/app.log | grep -i notification
   ```

### Troubleshooting

#### Common Issues

1. **Background Tasks Not Running**
   ```bash
   # Check if the process is running
   ps aux | grep run_background_tasks.py
   
   # Check system service status
   sudo systemctl status nicotine-tracker-notifications
   ```

2. **Email Not Sending**
   ```bash
   # Test SMTP connection
   python3 -c "
   import smtplib
   from email.mime.text import MIMEText
   
   server = smtplib.SMTP('smtp.gmail.com', 587)
   server.starttls()
   server.login('your-email@gmail.com', 'your-app-password')
   print('SMTP connection successful')
   server.quit()
   "
   ```

3. **Discord Webhook Failing**
   ```bash
   # Test webhook URL
   curl -X POST "YOUR_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d '{"content": "Test message from NicotineTracker"}'
   ```

4. **Database Connection Issues**
   ```bash
   # Check database connectivity
   python3 -c "
   from extensions import db
   from app import create_app
   
   app = create_app()
   with app.app_context():
       db.engine.execute('SELECT 1')
       print('Database connection successful')
   "
   ```

#### Performance Optimization

1. **Adjust Processing Interval**
   ```env
   # Process notifications every 60 seconds instead of 30
   NOTIFICATION_PROCESS_INTERVAL=60
   ```

2. **Increase Batch Size**
   ```env
   # Process more notifications per batch
   NOTIFICATION_BATCH_SIZE=25
   ```

3. **Database Indexing**
   ```sql
   -- Add indexes for better performance
   CREATE INDEX idx_notification_queue_status ON notification_queue(status);
   CREATE INDEX idx_notification_queue_scheduled ON notification_queue(scheduled_for);
   ```

### Security Considerations

1. **Protect Webhook URLs**
   - Store Discord webhook URLs securely
   - Validate webhook URLs before saving
   - Use HTTPS for all webhook communications

2. **Email Security**
   - Use app passwords instead of regular passwords
   - Enable TLS for SMTP connections
   - Validate email addresses before sending

3. **Rate Limiting**
   - The system includes built-in rate limiting
   - Discord webhooks are limited to prevent spam
   - Email sending respects SMTP server limits

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
