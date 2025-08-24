from extensions import db
from models import Pouch, Log
from sqlalchemy import case, func, desc

def get_sorted_pouches(user):
    """
    Get all pouches, sorted by user's preferred brands.
    """
    preferred_brands = user.preferences.preferred_brands or []
    
    preferred_brand_case = case(
        {brand: i for i, brand in enumerate(preferred_brands)},
        value=Pouch.brand,
        else_=len(preferred_brands)
    ).label('preferred_order')

    default_pouches = Pouch.query.filter_by(is_default=True).order_by(
        preferred_brand_case, Pouch.brand, Pouch.nicotine_mg
    ).all()
    
    user_pouches = Pouch.query.filter_by(created_by=user.id).order_by(
        preferred_brand_case, Pouch.brand, Pouch.nicotine_mg
    ).all()

    return default_pouches, user_pouches

def get_quick_add_pouches(user):
    """
    Get a list of pouches for the quick-add section.
    This function prioritizes the user's most logged pouches from their preferred brands.
    If none are found, it falls back to the most logged pouches overall.
    If there's no log history, it falls back to the top pouches from their sorted list.
    """
    pouch_ids = []

    # 1. Try most used from preferred brands
    preferred_brands = user.preferences.preferred_brands or []
    if preferred_brands:
        most_used_preferred = db.session.query(
            Log.pouch_id,
            func.count(Log.pouch_id).label('log_count')
        ).join(Pouch, Pouch.id == Log.pouch_id).filter(
            Log.user_id == user.id,
            Pouch.brand.in_(preferred_brands),
            Log.pouch_id.isnot(None)
        ).group_by(Log.pouch_id).order_by(
            desc('log_count')
        ).limit(6).all()
        pouch_ids = [item.pouch_id for item in most_used_preferred]

    # 2. Fallback to most used overall if no preferred ones were found
    if not pouch_ids:
        most_used_overall = db.session.query(
            Log.pouch_id,
            func.count(Log.pouch_id).label('log_count')
        ).filter(
            Log.user_id == user.id,
            Log.pouch_id.isnot(None)
        ).group_by(Log.pouch_id).order_by(
            desc('log_count')
        ).limit(6).all()
        pouch_ids = [item.pouch_id for item in most_used_overall]

    # Fetch pouches if any were found from logs
    if pouch_ids:
        order_case = case({p_id: i for i, p_id in enumerate(pouch_ids)}, value=Pouch.id)
        return Pouch.query.filter(Pouch.id.in_(pouch_ids)).order_by(order_case).all()
    
    # 3. Fallback to just the top sorted pouches if there is no log history
    default_pouches, user_pouches = get_sorted_pouches(user)
    all_sorted_pouches = default_pouches + user_pouches
    return all_sorted_pouches[:6]


def get_sorted_brands(user):
    """
    Get all unique brand names, sorted by user's preferred brands.
    """
    default_brands_query = db.session.query(Pouch.brand).filter_by(is_default=True).distinct()
    custom_brands_query = db.session.query(Pouch.brand).filter_by(created_by=user.id, is_default=False).distinct()
    
    all_brands_query = default_brands_query.union(custom_brands_query)
    
    brands = {brand[0] for brand in all_brands_query.all()}
    
    brands_list = list(brands)
    preferred_brands = user.preferences.preferred_brands or []

    def sort_key(brand):
        try:
            return (preferred_brands.index(brand), brand)
        except ValueError:
            return (len(preferred_brands), brand)
    
    brands_list.sort(key=sort_key)
    return brands_list
