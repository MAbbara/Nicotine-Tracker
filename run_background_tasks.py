#!/usr/bin/env python3
"""
Background Tasks Runner for Nicotine Tracker
Run this script to process notification queues and send scheduled notifications.

Usage:
    python run_background_tasks.py

This should be run as a separate process or scheduled as a cron job.
"""
import sys
import logging
from app import create_app
from services.background_tasks import run_background_tasks

def setup_background_logger():
    """Log to stdout; the process manager owns persistence and rotation."""
    logger = logging.getLogger('background_tasks')
    logger.setLevel(logging.DEBUG)

    if not logger.handlers:
        formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(logging.INFO)
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        logger.propagate = False

    return logger

def main():
    """Main entry point for background tasks"""
    logger = setup_background_logger()
    logger.info("Starting Nicotine Tracker Background Tasks...")
    
    # Create Flask app
    app = create_app()
    
    try:
        # Run background tasks
        run_background_tasks(app)
    except KeyboardInterrupt:
        logger.info("\nBackground tasks stopped by user.")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Error running background tasks: {e}", exc_info=True)
        sys.exit(1)


if __name__ == '__main__':
    main()
