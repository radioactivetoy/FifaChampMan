// ChampMan — export the fctoolshub club list as a CSV for Teams → Import.
//
// Use (about once a year, when a new FC game comes out):
//   1. Open https://fctoolshub.com/en/database/fc27/clubs?sort%5B0%5D=data.overall%3Adesc
//      in your browser (replace fc27 with the current game, e.g. fc28).
//   2. Press F12, open the Console tab, paste this whole file and press Enter.
//   3. It clicks through the pages slowly (the site rate-limits fast browsing; if it answers
//      "Too Many Requests" the script waits a minute and retries). Takes a few minutes;
//      progress is printed in the console. champman-teams.csv downloads at the end.
//   4. In ChampMan: Teams → Import from CSV → choose the file → Import.
//      Existing teams are updated by name, new ones are added.
//   5. Optionally refresh the Champions League template: node tools/create-ucl-template.mjs
//
// Women's teams get " (W)" after their name; a name that still clashes gets its league added.
(async () => {
  const CARD = 'main a[href*="/clubs/"]';
  const WOMEN_LEAGUES = /Frauen|Women|Première Ligue|Liga F/;
  const SKIP_LEAGUES = /FC Tools Hub/;
  const PAUSE_MS = 3000;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const cards = () => [...document.querySelectorAll(CARD)].filter(a => a.querySelector('img'));
  const pageKey = () => cards().map(a => a.href).join();
  const rateLimited = () => /Too Many Requests/i.test(document.body.innerText);
  const nextButton = () => [...document.querySelectorAll('button, a')]
    .find(b => /next page/i.test(`${b.getAttribute('aria-label') ?? ''} ${b.innerText}`));
  const isDisabled = b => !b || b.disabled || b.getAttribute('aria-disabled') === 'true';

  const clubs = new Map(); // keyed by badge URL, which is unique per club
  for (let page = 1; page < 200; page++) {
    for (let i = 0; i < 60 && cards().length === 0; i++) await wait(500);
    for (const a of cards()) {
      const img = [...a.querySelectorAll('img')];
      clubs.set(img[0].src, {
        name: img[0].alt || a.querySelector('span')?.innerText.trim(),
        league: img[1]?.alt ?? '', country: img[2]?.alt ?? '',
        ovr: a.querySelector('.font-bold')?.innerText.trim(),
        badge: img[0].src,
        leagueBadge: (img[1]?.src ?? '').replace('/leagues/dark/', '/leagues/light/'),
        flag: img[2]?.src ?? '',
      });
    }
    console.log(`ChampMan export: page ${page}, ${clubs.size} clubs so far`);
    if (isDisabled(nextButton())) break;

    const before = pageKey();
    await wait(PAUSE_MS);
    let moved = false;
    for (let attempt = 0; attempt < 5 && !moved; attempt++) {
      nextButton()?.click();
      for (let i = 0; i < 60 && pageKey() === before; i++) await wait(500);
      moved = pageKey() !== before && cards().length > 0;
      if (!moved && rateLimited()) {
        console.log('ChampMan export: site says Too Many Requests, waiting 60 s…');
        await wait(60000);
      }
    }
    if (!moved) { console.warn('ChampMan export: could not load the next page; exporting what we have.'); break; }
  }

  const rows = [...clubs.values()].filter(c => !SKIP_LEAGUES.test(c.league))
    .map(c => ({ ...c, name: WOMEN_LEAGUES.test(c.league) ? `${c.name} (W)` : c.name }));
  const count = {};
  rows.forEach(r => { count[r.name] = (count[r.name] ?? 0) + 1; });
  rows.forEach(r => { if (count[r.name] > 1) r.name = `${r.name} (${r.league})`; });

  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = ['name,league,country,ovr,badge,league badge,flag',
    ...rows.map(r => [r.name, r.league, r.country, r.ovr, r.badge, r.leagueBadge, r.flag].map(q).join(','))].join('\n');

  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'champman-teams.csv',
  });
  link.click();
  console.log(`ChampMan export: downloaded champman-teams.csv with ${rows.length} clubs`);
})();
