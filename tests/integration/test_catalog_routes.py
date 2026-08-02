"""Catalog route behavior and editorial interface contracts."""

from decimal import Decimal
from pathlib import Path

from bs4 import BeautifulSoup

from models import Pouch, User


PROJECT_ROOT = Path(__file__).resolve().parents[2]
CATALOG_TEMPLATES = (
    'catalog.html', 'add_pouch.html', 'edit_pouch.html', 'search_results.html',
)
BANNED_PALETTE = (
    'bg-indigo-', 'text-indigo-', 'border-indigo-', 'ring-indigo-',
    'outline-indigo-', 'bg-purple-', 'text-purple-', 'bg-violet-',
    'bg-fuchsia-', 'bg-blue-', 'text-blue-',
)


def test_catalog_renders_editorial_sections_semantic_rows_and_one_add_action(
        logged_in_client, test_pouch):
    response = logged_in_client.get('/catalog/')
    document = BeautifulSoup(response.data, 'html.parser')

    assert response.status_code == 200
    assert document.select_one('main h1').get_text(' ', strip=True) == 'Your pouches'
    assert len(document.select('main h1')) == 1
    headings = [item.get_text(' ', strip=True) for item in document.select('main h2')]
    assert 'Saved for quick logging' in headings
    assert 'Browse catalog' in headings
    assert len(document.select('[data-catalog-add-action]')) == 1
    assert document.select_one('form.catalog-search[method="get"][action="/catalog/search"]')
    assert document.select_one('input[name="q"][type="search"]')
    row = document.select_one('article.catalog-row[data-source="custom"]')
    assert row is not None
    text = row.get_text(' ', strip=True)
    assert 'Test Brand' in text
    assert '4 mg' in text
    assert 'Your pouch' in text
    assert row.select_one(f'a[href="/catalog/edit/{test_pouch.id}"]')
    delete = row.select_one('form.catalog-delete-form button[type="submit"]')
    assert delete and delete.get_text(' ', strip=True) == 'Delete'
    assert document.select_one('table') is None
    scripts = [script.get('src', '') for script in document.select('script[src]')]
    assert any('js/catalog/page.js' in source for source in scripts)
    assert not document.select('[onsubmit]')


def test_catalog_forms_keep_decimal_and_csrf_contracts(logged_in_client, test_pouch):
    for path, heading, submit_label in (
        ('/catalog/add', 'Add a pouch', 'Add pouch'),
        (f'/catalog/edit/{test_pouch.id}', 'Edit pouch', 'Save changes'),
    ):
        response = logged_in_client.get(path)
        document = BeautifulSoup(response.data, 'html.parser')
        form = document.select_one('form.catalog-form[method="post"]')

        assert response.status_code == 200
        assert document.select_one('main h1').get_text(' ', strip=True) == heading
        assert len(document.select('main h1')) == 1
        assert form.select_one('input[name="csrf_token"][type="hidden"]')
        assert form.select_one('input.c-field__control[name="brand"][required]')
        strength = form.select_one(
            'input.c-field__control[name="nicotine_mg"][type="number"][required]'
        )
        assert strength.get('min') == '0.01'
        assert strength.get('step') == '0.01'
        assert not strength.has_attr('max')
        button = form.select_one('button.c-button.c-button--primary[type="submit"]')
        assert button.get_text(' ', strip=True) == submit_label
        assert form.select_one('a.c-button.c-button--secondary[href="/catalog/"]')


def test_catalog_search_is_scoped_and_uses_editorial_rows(
        logged_in_client, db_session, test_user):
    own = Pouch(
        brand='Quiet Citrus', nicotine_mg=Decimal('3.50'),
        is_default=False, created_by=test_user.id,
    )
    default = Pouch(
        brand='Quiet Mint', nicotine_mg=Decimal('6.00'), is_default=True,
    )
    other = User(email='other-catalog@example.com', email_verified=True)
    other.set_password('password123')
    db_session.add_all([own, default, other])
    db_session.flush()
    foreign = Pouch(
        brand='Quiet Foreign', nicotine_mg=Decimal('8.00'),
        is_default=False, created_by=other.id,
    )
    db_session.add(foreign)
    db_session.commit()

    response = logged_in_client.get('/catalog/search?q=Quiet')
    document = BeautifulSoup(response.data, 'html.parser')
    page_text = document.get_text(' ', strip=True)

    assert response.status_code == 200
    assert document.select_one('main h1').get_text(' ', strip=True) == 'Search pouches'
    assert document.select_one('input[name="q"]')['value'] == 'Quiet'
    assert 'Quiet Citrus' in page_text
    assert 'Quiet Mint' in page_text
    assert 'Quiet Foreign' not in page_text
    assert len(document.select('article.catalog-row')) == 2
    assert document.select_one('table') is None


def test_create_edit_and_delete_remain_user_owned(
        logged_in_client, db_session, test_user):
    created = logged_in_client.post('/catalog/add', data={
        'brand': 'Calm Orchard',
        'nicotine_mg': '2.75',
    })
    pouch = Pouch.query.filter_by(
        brand='Calm Orchard', created_by=test_user.id,
    ).one()

    assert created.status_code == 302
    assert pouch.nicotine_mg == Decimal('2.75')

    edited = logged_in_client.post(f'/catalog/edit/{pouch.id}', data={
        'brand': 'Calm Cedar',
        'nicotine_mg': '3.25',
    })
    db_session.refresh(pouch)
    assert edited.status_code == 302
    assert pouch.brand == 'Calm Cedar'
    assert pouch.nicotine_mg == Decimal('3.25')

    deleted = logged_in_client.post(f'/catalog/delete/{pouch.id}')
    assert deleted.status_code == 302
    assert db_session.get(Pouch, pouch.id) is None


def test_catalog_templates_use_shared_primitives_and_retire_legacy_palette():
    for name in CATALOG_TEMPLATES:
        source = (PROJECT_ROOT / 'templates' / 'catalog' / name).read_text().casefold()
        for token in BANNED_PALETTE:
            assert token not in source, f'{name}: {token}'
