import os
from app import create_app

# Create application with automatic environment detection
application = create_app()

if __name__ == '__main__':
    # Get configuration for development server settings
    debug_mode = application.config.get('DEBUG', False)
    host = os.environ.get('FLASK_HOST', '0.0.0.0')
    port = int(os.environ.get('FLASK_PORT', 5050))
    
    print(f"Starting Flask app in {os.environ.get('FLASK_ENV', 'development')} mode")
    print(f"Debug mode: {debug_mode}")
    print(f"Database: {application.config.get('SQLALCHEMY_DATABASE_URI')}")
    
    application.run(debug=debug_mode, host=host, port=port)
