const express = require('express');
const router = express.Router();

/**
 * GET /api/v1/reference/validation
 * Returns all reference data in one call
 */
router.get('/validation', async (req, res) => {
  try {
    const db = req.app.locals.db;

    const [sites, categories, brands, suppliers, subCategories, currencies, subAreas] = await Promise.all([
      db.prepare('SELECT id, site_id, name, code, active FROM sites WHERE active = 1 ORDER BY name').then(s => s.all()),
      db.prepare('SELECT id, name, active FROM categories WHERE active = 1 ORDER BY name').then(s => s.all()),
      db.prepare('SELECT id, name, active FROM brands WHERE active = 1 ORDER BY name').then(s => s.all()),
      db.prepare('SELECT id, name, contact_person, email, phone, active FROM suppliers WHERE active = 1 ORDER BY name').then(s => s.all()),
      db.prepare('SELECT id, category_id, name, active FROM sub_categories WHERE active = 1 ORDER BY name').then(s => s.all()),
      db.prepare('SELECT id, name, code, symbol, active FROM currencies WHERE active = 1 ORDER BY name').then(s => s.all()),
      db.prepare('SELECT id, name, active FROM sub_areas WHERE active = 1 ORDER BY name').then(s => s.all())
    ]);

    res.json({
      status: 'success',
      data: {
        sites: sites.results || sites,
        categories: categories.results || categories,
        brands: brands.results || brands,
        suppliers: suppliers.results || suppliers,
        subCategories: subCategories.results || subCategories,
        currencies: currencies.results || currencies,
        subAreas: subAreas.results || subAreas
      }
    });
  } catch (err) {
    console.error('Get validation data error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/reference/sites
 */
router.get('/sites', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, site_id, name, code, active FROM sites WHERE active = 1 ORDER BY name');
    const result = await stmt.all();
    res.json({ status: 'success', data: result.results || result });
  } catch (err) {
    console.error('Get sites error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/reference/categories
 */
router.get('/categories', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, name, active FROM categories WHERE active = 1 ORDER BY name');
    const result = await stmt.all();
    res.json({ status: 'success', data: result.results || result });
  } catch (err) {
    console.error('Get categories error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/reference/brands
 */
router.get('/brands', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, name, active FROM brands WHERE active = 1 ORDER BY name');
    const result = await stmt.all();
    res.json({ status: 'success', data: result.results || result });
  } catch (err) {
    console.error('Get brands error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * GET /api/v1/reference/suppliers
 */
router.get('/suppliers', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const stmt = await db.prepare('SELECT id, name, contact_person, email, phone, active FROM suppliers WHERE active = 1 ORDER BY name');
    const result = await stmt.all();
    res.json({ status: 'success', data: result.results || result });
  } catch (err) {
    console.error('Get suppliers error:', err);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

module.exports = router;
