#!/usr/bin/env python3
"""
Background Tasks Runner for Nicotine Tracker
Run this script to process notification queues and send scheduled notifications.

Usage:
    python run_background_tasks.py

This should be run as a separate process or scheduled as a cron job.
"""
import os
import sys
from app import create_app
from services.background_tasks import run_background_tasks

def main():
    """Main entry point for background tasks"""
    print("Starting Nicotine Tracker Background Tasks...")
    
    # Create Flask app
    app = create_app()
    
    try:
        # Run background tasks
        run_background_tasks(app)
    except KeyboardInterrupt:
        print("\nBackground tasks stopped by user.")
        sys.exit(0)
    except Exception as e:
        print(f"Error running background tasks: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
