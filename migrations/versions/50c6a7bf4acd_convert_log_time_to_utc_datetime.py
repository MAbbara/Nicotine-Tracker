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
    # SQLite doesn't support ALTER COLUMN, so we need to recreate the table
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
    
    # Copy data from old table to new table, using created_at as the UTC datetime for all records
    connection = op.get_bind()
    
    # Copy all records, setting log_time to created_at (which is already UTC)
    connection.execute(text("""
        INSERT INTO log_new (id, user_id, log_date, log_time, created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes)
        SELECT id, user_id, log_date, 
               COALESCE(created_at, datetime('now')) as log_time,
               created_at, pouch_id, custom_brand, custom_nicotine_mg, quantity, notes
        FROM log
    """))
    
    # Drop the old table
    op.drop_table('log')
    
    # Rename the new table
    op.rename_table('log_new', 'log')


def downgrade():
    # Convert DateTime back to Time
    # This is a lossy operation - we'll extract just the time portion
    op.alter_column('log', 'log_time', nullable=True)
    
    # Create temporary time column
    op.add_column('log', sa.Column('log_time_temp', sa.Time(), nullable=True))
    
    # Extract time portion from datetime
    connection = op.get_bind()
    connection.execute(text("""
        UPDATE log 
        SET log_time_temp = time(log_time)
        WHERE log_time IS NOT NULL
    """))
    
    # Drop the datetime column
    op.drop_column('log', 'log_time')
    
    # Rename temp column back to log_time
    op.alter_column('log', 'log_time_temp', new_column_name='log_time')
