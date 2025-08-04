#!/usr/bin/env python3
"""
Seed script for NicotineTracker database.
This script populates the database with default pouch data.
"""

import os
import sys
from app import create_app
from extensions import db
from models import init_default_pouches, Pouch

def seed_default_pouches():
    """Seed the database with default pouch data."""
    print("🌱 Starting database seeding...")
    
    # Create Flask app context
    app = create_app()
    
    with app.app_context():
        try:
            # Create all tables if they don't exist
            db.create_all()
            print("✅ Database tables created/verified")
            
            # Get initial count
            initial_count = Pouch.query.filter_by(is_default=True).count()
            print(f"📊 Current default pouches in database: {initial_count}")
            
            # Use the existing function to initialize default pouches
            print("🔄 Adding default pouches...")
            init_default_pouches()
            
            # Get final count
            final_count = Pouch.query.filter_by(is_default=True).count()
            added_count = final_count - initial_count
            
            print(f"✅ Seeding completed successfully!")
            print(f"📈 Added {added_count} new default pouches")
            print(f"📊 Total default pouches in database: {final_count}")
            
            # Display all default pouches
            print("\n📋 Default pouches in database:")
            default_pouches = Pouch.query.filter_by(is_default=True).order_by(Pouch.brand, Pouch.nicotine_mg).all()
            for pouch in default_pouches:
                print(f"   • {pouch.brand} - {pouch.nicotine_mg}mg")
                
        except Exception as e:
            print(f"❌ Error during seeding: {e}")
            db.session.rollback()
            sys.exit(1)

def clear_default_pouches():
    """Clear all default pouches from the database."""
    app = create_app()
    
    with app.app_context():
        try:
            count = Pouch.query.filter_by(is_default=True).count()
            if count == 0:
                print("ℹ️  No default pouches to clear")
                return
                
            Pouch.query.filter_by(is_default=True).delete()
            db.session.commit()
            print(f"🗑️  Cleared {count} default pouches from database")
            
        except Exception as e:
            print(f"❌ Error clearing default pouches: {e}")
            db.session.rollback()
            sys.exit(1)

def main():
    """Main function to handle command line arguments."""
    if len(sys.argv) > 1:
        if sys.argv[1] == '--clear':
            print("🗑️  Clearing default pouches...")
            clear_default_pouches()
            return
        elif sys.argv[1] == '--help' or sys.argv[1] == '-h':
            print("NicotineTracker Database Seeder")
            print("Usage:")
            print("  python seed.py          - Seed default pouches")
            print("  python seed.py --clear  - Clear default pouches")
            print("  python seed.py --help   - Show this help message")
            return
        else:
            print(f"❌ Unknown argument: {sys.argv[1]}")
            print("Use 'python seed.py --help' for usage information")
            sys.exit(1)
    
    # Default action: seed the database
    seed_default_pouches()

if __name__ == '__main__':
    main()
