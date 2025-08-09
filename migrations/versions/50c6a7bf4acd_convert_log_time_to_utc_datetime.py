"""convert_log_time_to_utc_datetime

Revision ID: 50c6a7bf4acd
Revises: 2147fb57a0f9
Create Date: 2025-08-09 23:08:40.871835

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision = '50c6a7bf4acd'
down_revision = '2147fb57a0f9'
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    
    # Check if we're using SQLite or MySQL/MariaDB
    is_sqlite = connection.dialect.name == 'sqlite'
    
    # Clean up any existing log_new table from previous failed attempts
    try:
        op.drop_table('log_new')
    except Exception:
        # Table doesn't exist, which is fine
        pass
    
    # Create a new table with the updated schema
    op.create_table('log_new',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('log_date', sa.Date(), nullable=False),
        sa.Column('log_time', sa.DateTime(), nullable=False),  # Changed from Time to DateTime
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('pouch_id', sa.Integer(), nullable=True),
        sa.Column('custom_brand', sa.String(length=80), nullable=True),
        sa.Column('custom_nicotine_mg', sa.Integer(), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['pouch_id'], ['pouch.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Copy data from old table to new table with database-specific datetime handling
    if is_sqlite:
        # SQLite version - use datetime('now') for null created_at values
        connection.execute(text("""
            INSERT INTO log_new (id, user_id, log_date, log_time, created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes)
            SELECT id, user_id, log_date, 
                   COALESCE(created_at, datetime('now')) as log_time,
                   created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes
            FROM log
        """))
    else:
        # MySQL/MariaDB version - use NOW() for null created_at values
        connection.execute(text("""
            INSERT INTO log_new (id, user_id, log_date, log_time, created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes)
            SELECT id, user_id, log_date, 
                   COALESCE(created_at, NOW()) as log_time,
                   created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes
            FROM log
        """))
    
    # Drop the old table
    op.drop_table('log')
    
    # Rename the new table
    op.rename_table('log_new', 'log')


def downgrade():
    connection = op.get_bind()
    is_sqlite = connection.dialect.name == 'sqlite'
    
    if is_sqlite:
        # SQLite doesn't support ALTER COLUMN, so we need to recreate the table
        # Create temporary table with Time column
        op.create_table('log_temp',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('log_date', sa.Date(), nullable=False),
            sa.Column('log_time', sa.Time(), nullable=True),  # Back to Time
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('pouch_id', sa.Integer(), nullable=True),
            sa.Column('custom_brand', sa.String(length=80), nullable=True),
            sa.Column('custom_nicotine_mg', sa.Integer(), nullable=True),
            sa.Column('quantity', sa.Integer(), nullable=False),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.ForeignKeyConstraint(['pouch_id'], ['pouch.id'], ),
            sa.ForeignKeyConstraint(['user_id'], ['user.id'], ),
            sa.PrimaryKeyConstraint('id')
        )
        
        # Copy data back, extracting time portion from datetime
        connection.execute(text("""
            INSERT INTO log_temp (id, user_id, log_date, log_time, created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes)
            SELECT id, user_id, log_date, 
                   time(log_time) as log_time,
                   created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes
            FROM log
        """))
        
        # Replace the table
        op.drop_table('log')
        op.rename_table('log_temp', 'log')
    else:
        # MySQL/MariaDB version - can use ALTER COLUMN
        with op.batch_alter_table('log', schema=None) as batch_op:
            # Add temporary time column
            batch_op.add_column(sa.Column('log_time_temp', sa.Time(), nullable=True))
        
        # Extract time portion from datetime
        connection.execute(text("""
            UPDATE log 
            SET log_time_temp = TIME(log_time)
            WHERE log_time IS NOT NULL
        """))
        
        # Drop the datetime column and rename temp column
        with op.batch_alter_table('log', schema=None) as batch_op:
            batch_op.drop_column('log_time')
            batch_op.alter_column('log_time_temp', new_column_name='log_time')
