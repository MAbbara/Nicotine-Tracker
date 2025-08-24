from extensions import db
from models import Pouch, Log
from sqlalchemy import case, func, desc, or_

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
        preferred_brand_case, Pouch.brand, desc(Pouch.nicotine_mg)
    ).all()
    
    user_pouches = Pouch.query.filter_by(created_by=user.id).order_by(
        preferred_brand_case, Pouch.brand, desc(Pouch.nicotine_mg)
    ).all()

    return default_pouches, user_pouches

def get_all_pouches(user):
    preferred_brands = user.preferences.preferred_brands or []
    
    preferred_brand_case = case(
        {brand: i for i, brand in enumerate(preferred_brands)},
        value=Pouch.brand,
        else_=len(preferred_brands)
    ).label('preferred_order')

    pouches = Pouch.query.filter(
        or_(
            Pouch.is_default == True,
            Pouch.created_by == user.id
        )
    ).order_by(
        preferred_brand_case,
        Pouch.brand,
        desc(Pouch.nicotine_mg)
    ).all()

    return pouches


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
