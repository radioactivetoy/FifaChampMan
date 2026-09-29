import { html, page } from '../html.js';
import { requiredText } from '../form.js';
import { avatar } from '../components.js';
import { listPlayers, savePlayer, deletePlayer, parsePhotoDataUrl, setPlayerPhoto, clearPlayerPhoto, getPlayerPhoto } from '../../repo/players.js';

export function registerPlayerRoutes(app, { db }) {
  app.get('/players', (req, res) => {
    const players = listPlayers(db);
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
            <form method="post" action="/players/${p.id}/delete" class="inline" onsubmit="return confirm('Delete this player?')"><button class="danger">Delete</button></form></td>
        </tr>`)}
        </tbody></table>`,
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

  app.post('/players/:id/delete', (req, res) => {
    deletePlayer(db, Number(req.params.id));
    res.redirect('/players');
  });
}
