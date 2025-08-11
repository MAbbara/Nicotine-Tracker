"""remove_health_impact_table

Revision ID: 54c6826b8b0e
Revises: 884d42987a15
Create Date: 2025-08-11 23:44:14.921801

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '54c6826b8b0e'
down_revision = '884d42987a15'
branch_labels = None
depends_on = None


def upgrade():
    # Drop the health_impacts table if it exists
    from sqlalchemy import inspect
    from alembic import context
    
    conn = context.get_bind()
    inspector = inspect(conn)
    tables = inspector.get_table_names()
    
    if 'health_impacts' in tables:
        op.drop_table('health_impacts')


def downgrade():
    # Recreate the health_impacts table if needed to rollback
    op.create_table('health_impacts',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('impact_type', sa.String(length=50), nullable=False),
        sa.Column('value', sa.Float(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
