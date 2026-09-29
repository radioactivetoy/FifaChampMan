import { applyUndo, dismissUndo } from '../../repo/undo.js';

/** Only ever go back to a page of this app. */
const backTo = req => (typeof req.body.back === 'string' && /^\/(?!\/)/.test(req.body.back) ? req.body.back : '/');

export function registerUndoRoutes(app, { db }) {
  app.post('/undo/:id', (req, res) => {
    applyUndo(db, Number(req.params.id));
    res.redirect(backTo(req));
  });

  app.post('/undo/:id/dismiss', (req, res) => {
    dismissUndo(db, Number(req.params.id));
    res.redirect(backTo(req));
  });
}
