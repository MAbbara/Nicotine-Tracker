from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify
from models import User, Pouch, Log      # import Log here as well
from extensions import db
from routes.auth import login_required, get_current_user
from sqlalchemy import or_, desc

catalog_bp = Blueprint('catalog', __name__, template_folder="../templates/catalog")

@catalog_bp.route('/')
@login_required
def index():
    """Display pouch catalog"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Catalog index error: No current user found')
            return redirect(url_for('auth.login'))
        
        # Get default pouches
        default_pouches = Pouch.query.filter_by(is_default=True).order_by(
            Pouch.brand, Pouch.nicotine_mg
        ).all()
        
        # Get user's custom pouches
        custom_pouches = Pouch.query.filter_by(
            created_by=user.id, is_default=False
        ).order_by(Pouch.brand, Pouch.nicotine_mg).all()
        
        # Group pouches by brand for better display
        default_brands = {}
        for pouch in default_pouches:
            if pouch.brand not in default_brands:
                default_brands[pouch.brand] = []
            default_brands[pouch.brand].append(pouch)
        
        custom_brands = {}
        for pouch in custom_pouches:
            if pouch.brand not in custom_brands:
                custom_brands[pouch.brand] = []
            custom_brands[pouch.brand].append(pouch)
        
        return render_template('catalog.html', 
                             default_brands=default_brands,
                             custom_brands=custom_brands,
                             default_pouches=default_pouches,
                             custom_pouches=custom_pouches)
        
    except Exception as e:
        current_app.logger.error(f'Catalog index error: {e}')
        flash('An error occurred while loading the catalog.', 'error')
        return render_template('catalog.html', default_brands={}, custom_brands={})

@catalog_bp.route('/add', methods=['GET', 'POST'])
@login_required
def add_pouch():
    """Add a custom pouch"""
    try:
        user = get_current_user()
        
        if request.method == 'POST':
            brand = request.form.get('brand', '').strip()
            nicotine_mg = request.form.get('nicotine_mg', type=int)
            
            # Validation
            if not brand:
                flash('Brand name is required.', 'error')
                return render_template('add_pouch.html')
            
            if not nicotine_mg or nicotine_mg <= 0:
                flash('Nicotine content must be a positive number.', 'error')
                return render_template('add_pouch.html')
            
            if nicotine_mg > 100:
                flash('Nicotine content seems too high. Please verify.', 'warning')
            
            # Check if pouch already exists for this user
            existing_pouch = Pouch.query.filter_by(
                brand=brand,
                nicotine_mg=nicotine_mg,
                created_by=user.id
            ).first()
            
            if existing_pouch:
                flash('This pouch already exists in your custom list.', 'warning')
                return redirect(url_for('catalog.index'))
            
            # Check if it exists in default pouches
            default_pouch = Pouch.query.filter_by(
                brand=brand,
                nicotine_mg=nicotine_mg,
                is_default=True
            ).first()
            
            if default_pouch:
                flash('This pouch already exists in the default catalog.', 'info')
                return redirect(url_for('catalog.index'))
            
            # Create new custom pouch
            new_pouch = Pouch(
                brand=brand,
                nicotine_mg=nicotine_mg,
                is_default=False,
                created_by=user.id
            )
            
            db.session.add(new_pouch)
            db.session.commit()
            
            current_app.logger.info(f'Custom pouch added by user {user.email}: {brand} {nicotine_mg}mg')
            flash(f'Successfully added {brand} ({nicotine_mg}mg) to your catalog!', 'success')
            return redirect(url_for('catalog.index'))
        
        return render_template('add_pouch.html')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Add pouch error: {e}')
        flash('An error occurred while adding the pouch.', 'error')
        return render_template('add_pouch.html')

@catalog_bp.route('/edit/<int:pouch_id>', methods=['GET', 'POST'])
@login_required
def edit_pouch(pouch_id):
    """Edit a custom pouch"""
    try:
        user = get_current_user()
        pouch = Pouch.query.filter_by(
            id=pouch_id, 
            created_by=user.id, 
            is_default=False
        ).first()
        
        if not pouch:
            flash('Pouch not found or you do not have permission to edit it.', 'error')
            return redirect(url_for('catalog.index'))
        
        if request.method == 'POST':
            brand = request.form.get('brand', '').strip()
            nicotine_mg = request.form.get('nicotine_mg', type=int)
            
            # Validation
            if not brand:
                flash('Brand name is required.', 'error')
                return render_template('edit_pouch.html', pouch=pouch)
            
            if not nicotine_mg or nicotine_mg <= 0:
                flash('Nicotine content must be a positive number.', 'error')
                return render_template('edit_pouch.html', pouch=pouch)
            
            # Check for duplicates (excluding current pouch)
            existing_pouch = Pouch.query.filter(
                Pouch.brand == brand,
                Pouch.nicotine_mg == nicotine_mg,
                Pouch.id != pouch.id,
                or_(Pouch.created_by == user.id, Pouch.is_default == True)
            ).first()
            
            if existing_pouch:
                flash('A pouch with this brand and nicotine content already exists.', 'warning')
                return render_template('edit_pouch.html', pouch=pouch)
            
            # Update pouch
            pouch.brand = brand
            pouch.nicotine_mg = nicotine_mg
            
            db.session.commit()
            
            current_app.logger.info(f'Custom pouch edited by user {user.email}: {brand} {nicotine_mg}mg')
            flash(f'Successfully updated {brand} ({nicotine_mg}mg)!', 'success')
            return redirect(url_for('catalog.index'))
        
        return render_template('edit_pouch.html', pouch=pouch)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Edit pouch error: {e}')
        flash('An error occurred while editing the pouch.', 'error')
        return redirect(url_for('catalog.index'))

@catalog_bp.route('/delete/<int:pouch_id>', methods=['POST'])
@login_required
def delete_pouch(pouch_id):
    """Delete a custom pouch"""
    try:
        user = get_current_user()
        pouch = Pouch.query.filter_by(
            id=pouch_id, 
            created_by=user.id, 
            is_default=False
        ).first()
        
        if not pouch:
            flash('Pouch not found or you do not have permission to delete it.', 'error')
            return redirect(url_for('catalog.index'))
        
        # Check if pouch is being used in logs
        logs_using_pouch = Log.query.filter_by(pouch_id=pouch.id).count()
        
        if logs_using_pouch > 0:
            flash(f'Cannot delete this pouch as it is used in {logs_using_pouch} log entries. '
                  'Please update or delete those logs first.', 'warning')
            return redirect(url_for('catalog.index'))
        
        brand_name = pouch.brand
        nicotine_mg = pouch.nicotine_mg
        
        db.session.delete(pouch)
        db.session.commit()
        
        current_app.logger.info(f'Custom pouch deleted by user {user.email}: {brand_name} {nicotine_mg}mg')
        flash(f'Successfully deleted {brand_name} ({nicotine_mg}mg) from your catalog.', 'success')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete pouch error: {e}')
        flash('An error occurred while deleting the pouch.', 'error')
    
    return redirect(url_for('catalog.index'))

@catalog_bp.route('/search')
@login_required
def search():
    """Search pouches"""
    try:
        user = get_current_user()
        query = request.args.get('q', '').strip()
        
        if not query:
            return redirect(url_for('catalog.index'))
        
        # Search in both default and custom pouches
        search_pattern = f'%{query}%'
        
        default_results = Pouch.query.filter(
            Pouch.is_default == True,
            Pouch.brand.ilike(search_pattern)
        ).order_by(Pouch.brand, Pouch.nicotine_mg).all()
        
        custom_results = Pouch.query.filter(
            Pouch.created_by == user.id,
            Pouch.is_default == False,
            Pouch.brand.ilike(search_pattern)
        ).order_by(Pouch.brand, Pouch.nicotine_mg).all()
        
        return render_template('search_results.html',
                             query=query,
                             default_results=default_results,
                             custom_results=custom_results)
        
    except Exception as e:
        current_app.logger.error(f'Search error: {e}')
        flash('An error occurred during search.', 'error')
        return redirect(url_for('catalog.index'))

@catalog_bp.route('/api/pouches')
@login_required
def api_pouches():
    """API endpoint to get pouches for dropdowns"""
    try:
        user = get_current_user()
        
        # Get all available pouches for this user
        default_pouches = Pouch.query.filter_by(is_default=True).all()
        custom_pouches = Pouch.query.filter_by(created_by=user.id, is_default=False).all()
        
        pouches_data = []
        
        # Add default pouches
        for pouch in default_pouches:
            pouches_data.append({
                'id': pouch.id,
                'brand': pouch.brand,
                'nicotine_mg': pouch.nicotine_mg,
                'display_name': f'{pouch.brand} ({pouch.nicotine_mg}mg)',
                'is_custom': False
            })
        
        # Add custom pouches
        for pouch in custom_pouches:
            pouches_data.append({
                'id': pouch.id,
                'brand': pouch.brand,
                'nicotine_mg': pouch.nicotine_mg,
                'display_name': f'{pouch.brand} ({pouch.nicotine_mg}mg) [Custom]',
                'is_custom': True
            })
        
        # Sort by brand name
        pouches_data.sort(key=lambda x: (x['brand'], x['nicotine_mg']))
        
        return jsonify({
            'success': True,
            'pouches': pouches_data
        })
        
    except Exception as e:
        current_app.logger.error(f'API pouches error: {e}')
        return jsonify({
            'success': False,
            'error': 'Unable to load pouches'
        })

@catalog_bp.route('/api/brands')
@login_required
def api_brands():
    """API endpoint to get unique brands"""
    try:
        user = get_current_user()
        
        # Get unique brands from both default and custom pouches
        default_brands = db.session.query(Pouch.brand).filter_by(is_default=True).distinct().all()
        custom_brands = db.session.query(Pouch.brand).filter_by(created_by=user.id, is_default=False).distinct().all()
        
        brands = set()
        for brand_tuple in default_brands + custom_brands:
            brands.add(brand_tuple[0])
        
        brands_list = sorted(list(brands))
        
        return jsonify({
            'success': True,
            'brands': brands_list
        })
        
    except Exception as e:
        current_app.logger.error(f'API brands error: {e}')
        return jsonify({
            'success': False,
            'error': 'Unable to load brands'
        })

@catalog_bp.route('/api/strengths/<brand>')
@login_required
def api_strengths(brand):
    """API endpoint to get nicotine strengths for a specific brand"""
    try:
        user = get_current_user()
        
        # Get strengths for the specified brand
        default_strengths = db.session.query(Pouch.nicotine_mg).filter_by(
            brand=brand, is_default=True
        ).distinct().all()
        
        custom_strengths = db.session.query(Pouch.nicotine_mg).filter_by(
            brand=brand, created_by=user.id, is_default=False
        ).distinct().all()
        
        strengths = set()
        for strength_tuple in default_strengths + custom_strengths:
            strengths.add(strength_tuple[0])
        
        strengths_list = sorted(list(strengths))
        
        return jsonify({
            'success': True,
            'strengths': strengths_list
        })
        
    except Exception as e:
        current_app.logger.error(f'API strengths error: {e}')
        return jsonify({
            'success': False,
            'error': 'Unable to load strengths'
        })
