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
   Create a `.env` file in the root directory:
   ```env
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
