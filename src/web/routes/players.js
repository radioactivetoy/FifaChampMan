import { html, page } from '../html.js';
import { requiredText } from '../form.js';
import { listPlayers, savePlayer, deletePlayer } from '../../repo/players.js';

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
          <td><form id="p${p.id}" method="post" action="/players/${p.id}"></form><input form="p${p.id}" name="name" value="${p.name}" required></td>
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

  app.post('/players/:id', (req, res) => {
    savePlayer(db, { id: Number(req.params.id), name: requiredText(req.body.name, 'Name') });
    res.redirect('/players');
  });

  app.post('/players/:id/delete', (req, res) => {
    deletePlayer(db, Number(req.params.id));
    res.redirect('/players');
  });
}
