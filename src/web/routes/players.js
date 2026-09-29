import { html, page } from '../html.js';
import { requiredText } from '../form.js';
import { avatar } from '../components.js';
import { recordUndo } from '../../repo/undo.js';
import { listPlayers, savePlayer, deletePlayer, setPlayerActive, parsePhotoDataUrl, setPlayerPhoto, clearPlayerPhoto, getPlayerPhoto } from '../../repo/players.js';

export function registerPlayerRoutes(app, { db }) {
  app.get('/players', (req, res) => {
    const all = listPlayers(db);
    const [players, inactive] = [all.filter(p => p.active), all.filter(p => !p.active)];
    res.send(page({
      title: 'Players',
      body: html`
        <form method="post" action="/players" class="row">
          <input name="name" placeholder="New player name" required><button class="primary">Add player</button>
        </form>
        <table><thead><tr><th>Name</th><th></th></tr></thead><tbody>
        ${players.map(p => html`<tr>
          <td class="player-cell"><form id="p${p.id}" method="post" action="/players/${p.id}"></form>${avatar(p, { size: 40 })}<input form="p${p.id}" name="name" value="${p.name}" required>
            <form method="post" action="/players/${p.id}/photo" class="inline photo-form">
              <input type="hidden" name="photo"><label class="button-link photo-pick">📷 ${p.hasPhoto ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" data-photo-upload hidden></label>
            </form>
            ${p.hasPhoto ? html`<form method="post" action="/players/${p.id}/photo/delete" class="inline"><button title="Remove photo">✕ photo</button></form>` : ''}</td>
          <td class="actions"><a class="button-link" href="/players/${p.id}">Profile</a> <button form="p${p.id}">Save</button>
            <form method="post" action="/players/${p.id}/deactivate" class="inline"><button title="Hide from new championships; keeps all their history and stats">Deactivate</button></form></td>
        </tr>`)}
        </tbody></table>
        ${inactive.length ? html`<h2>Inactive players</h2>
        <p class="muted">Hidden when creating championships or adding players, but their history, stats and trophies stay. Reactivate to bring them back,
          or delete their data for good (they leave every championship they were in; you can undo that for 30 minutes).</p>
        <table><thead><tr><th>Name</th><th></th></tr></thead><tbody>
        ${inactive.map(p => html`<tr>
          <td class="player-cell">${avatar(p, { size: 40 })}<a href="/players/${p.id}"><strong>${p.name}</strong></a></td>
          <td class="actions">
            <form method="post" action="/players/${p.id}/activate" class="inline"><button class="primary">Reactivate</button></form>
            <form method="post" action="/players/${p.id}/delete" class="inline" onsubmit="return confirm('Delete ${p.name} and all their data? They will be removed from every championship they played in.')"><button class="danger">Delete data</button></form></td>
        </tr>`)}
        </tbody></table>` : ''}`,
    }));
  });

  app.post('/players', (req, res) => {
    savePlayer(db, { name: requiredText(req.body.name, 'Name') });
    res.redirect('/players');
  });

  // The picture comes as a data URL: public/filter.js crops it square and shrinks it before submitting.
  app.post('/players/:id/photo', (req, res) => {
    setPlayerPhoto(db, Number(req.params.id), parsePhotoDataUrl(req.body.photo));
    res.redirect('/players');
  });

  app.post('/players/:id/photo/delete', (req, res) => {
    clearPlayerPhoto(db, Number(req.params.id));
    res.redirect('/players');
  });

  app.get('/players/:id/photo', (req, res) => {
    const photo = getPlayerPhoto(db, Number(req.params.id));
    if (!photo) return res.status(404).send('No photo');
    res.set('Content-Type', photo.type).set('Cache-Control', 'no-cache').send(photo.buffer);
  });

  app.post('/players/:id', (req, res) => {
    savePlayer(db, { id: Number(req.params.id), name: requiredText(req.body.name, 'Name') });
    res.redirect('/players');
  });

  app.post('/players/:id/deactivate', (req, res) => {
    setPlayerActive(db, Number(req.params.id), false);
    res.redirect('/players');
  });

  app.post('/players/:id/activate', (req, res) => {
    setPlayerActive(db, Number(req.params.id), true);
    res.redirect('/players');
  });

  // Only inactive players; everything removed is recorded so it can be undone from the banner.
  app.post('/players/:id/delete', (req, res) => {
    const id = Number(req.params.id);
    const name = listPlayers(db).find(p => p.id === id)?.name ?? 'player';
    recordUndo(db, `Deleted player ${name} and their data`, deletePlayer(db, id));
    res.redirect('/players');
  });
}
