#!/usr/bin/env python3
"""
Test script to verify UTC datetime functionality for logs.
This script tests:
1. Log creation with UTC storage
2. Timezone conversion when retrieving logs
3. Database storage verification
"""

import os
import sys
from datetime import datetime, date, time
from sqlalchemy import text

# Add the project root to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app
from extensions import db
from models import User, Log
from services.log_service import add_log_entry
from services.timezone_service import convert_user_time_to_utc, convert_utc_to_user_time

def test_utc_functionality():
    """Test UTC datetime functionality"""
    app = create_app()
    
    with app.app_context():
        print("🧪 Testing UTC Datetime Functionality")
        print("=" * 50)
        
        # Create a test user
        test_user = User(
            email='utc_test@example.com',
            password_hash='test_hash',
            timezone='America/New_York'  # EST/EDT timezone
        )
        
        # Check if user already exists
        existing_user = User.query.filter_by(email='utc_test@example.com').first()
        if existing_user:
            test_user = existing_user
            print(f"✅ Using existing test user: {test_user.email}")
        else:
            db.session.add(test_user)
            db.session.commit()
            print(f"✅ Created test user: {test_user.email}")
        
        print(f"   User timezone: {test_user.timezone}")
        
        # Test 1: Create a log entry with timezone conversion
        print("\n📝 Test 1: Creating log entry with timezone conversion")
        user_date = date(2024, 1, 15)  # January 15, 2024
        user_time = time(14, 30, 0)    # 2:30 PM in user's timezone
        
        print(f"   Input (user timezone): {user_date} {user_time}")
        
        # Convert to UTC for verification
        utc_datetime, utc_date, utc_time = convert_user_time_to_utc(
            test_user.timezone, user_date, user_time
        )
        print(f"   Expected UTC: {utc_datetime}")
        
        # Create log entry
        log_entry = add_log_entry(
            user_id=test_user.id,
            log_date=user_date,
            log_time=user_time,
            quantity=2,
            notes="Test log entry for UTC functionality",
            custom_brand="Test Brand",
            custom_nicotine_mg=6,
            user_timezone=test_user.timezone
        )
        
        print(f"   ✅ Created log entry ID: {log_entry.id}")
        
        # Test 2: Verify database storage
        print("\n🗄️  Test 2: Verifying database storage")
        
        # Query the database directly to see raw stored values
        result = db.session.execute(
            text("SELECT log_time, created_at FROM log WHERE id = :log_id"),
            {"log_id": log_entry.id}
        ).fetchone()
        
        if result:
            stored_log_time, created_at = result
            print(f"   Raw stored log_time: {stored_log_time}")
            print(f"   Raw created_at: {created_at}")
            
            # Verify it's stored as UTC datetime
            if isinstance(stored_log_time, datetime):
                print(f"   ✅ log_time is stored as datetime: {type(stored_log_time)}")
                print(f"   ✅ Stored UTC datetime: {stored_log_time}")
            else:
                print(f"   ❌ log_time is not datetime: {type(stored_log_time)}")
        
        # Test 3: Test timezone conversion methods
        print("\n🌍 Test 3: Testing timezone conversion methods")
        
        # Refresh the log entry from database
        log_entry = Log.query.get(log_entry.id)
        
        # Test get_user_date method
        user_date_converted = log_entry.get_user_date(test_user.timezone)
        print(f"   get_user_date(): {user_date_converted}")
        print(f"   Expected: {user_date}")
        print(f"   ✅ Date conversion: {'PASS' if user_date_converted == user_date else 'FAIL'}")
        
        # Test get_user_time method
        user_time_converted = log_entry.get_user_time(test_user.timezone)
        print(f"   get_user_time(): {user_time_converted}")
        print(f"   Expected: {user_time}")
        print(f"   ✅ Time conversion: {'PASS' if user_time_converted == user_time else 'FAIL'}")
        
        # Test 4: Test with different timezone
        print("\n🌏 Test 4: Testing with different timezone (Pacific Time)")
        
        # Test conversion to Pacific Time
        pacific_date = log_entry.get_user_date('America/Los_Angeles')
        pacific_time = log_entry.get_user_time('America/Los_Angeles')
        
        print(f"   Pacific date: {pacific_date}")
        print(f"   Pacific time: {pacific_time}")
        
        # Pacific is 3 hours behind Eastern, so 2:30 PM EST = 11:30 AM PST
        expected_pacific_time = time(11, 30, 0)
        print(f"   Expected Pacific time: {expected_pacific_time}")
        print(f"   ✅ Pacific conversion: {'PASS' if pacific_time == expected_pacific_time else 'FAIL'}")
        
        # Test 5: Test multiple log entries
        print("\n📊 Test 5: Testing multiple log entries")
        
        # Create a few more log entries
        test_times = [
            (time(9, 0, 0), "Morning"),
            (time(12, 0, 0), "Noon"), 
            (time(18, 30, 0), "Evening")
        ]
        
        created_logs = []
        for test_time, label in test_times:
            log = add_log_entry(
                user_id=test_user.id,
                log_date=user_date,
                log_time=test_time,
                quantity=1,
                notes=f"{label} test entry",
                custom_brand="Test Brand",
                custom_nicotine_mg=6,
                user_timezone=test_user.timezone
            )
            created_logs.append(log)
            print(f"   ✅ Created {label} log: {test_time} -> UTC: {log.log_time}")
        
        # Test 6: Query and display all logs for user
        print("\n📋 Test 6: Querying all user logs")
        
        all_logs = Log.query.filter_by(user_id=test_user.id).order_by(Log.log_time).all()
        print(f"   Found {len(all_logs)} logs for user")
        
        for i, log in enumerate(all_logs, 1):
            user_date_display = log.get_user_date(test_user.timezone)
            user_time_display = log.get_user_time(test_user.timezone)
            print(f"   {i}. UTC: {log.log_time} -> User TZ: {user_date_display} {user_time_display}")
        
        print("\n🎉 UTC Functionality Test Complete!")
        print("=" * 50)
        
        # Cleanup - remove test logs
        print("\n🧹 Cleaning up test data...")
        for log in all_logs:
            db.session.delete(log)
        
        # Only delete user if we created it
        if not existing_user:
            db.session.delete(test_user)
        
        db.session.commit()
        print("✅ Cleanup complete")

if __name__ == "__main__":
    test_utc_functionality()
