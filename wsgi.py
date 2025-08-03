#!/usr/bin/env python3
"""
WSGI entry point for NicotineTracker application.
This file is used by uWSGI to serve the Flask application.
"""

import os
import sys

# Add the project directory to Python path
sys.path.insert(0, os.path.dirname(__file__))

from app import create_app

# Create the Flask application instance
application = create_app()

if __name__ == "__main__":
    application.run()
