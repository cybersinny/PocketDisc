// Reads PUBLIC Spotify playlists. Your keys stay here on the server.
const B = 'https://api.spotify.com/v1/';

async function token() {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'Spotify login failed');
  return j.access_token;
}

module.exports = async (req, res) => {
  try {
    if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET)
      return res.status(500).json({ error: 'Missing Spotify keys in Vercel settings' });
    const q = (req.query.q || '').trim();
    const H = { Authorization: 'Bearer ' + (await token()) };
    const get = async u => {
      const r = await fetch(B + u, { headers: H });
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Spotify error ' + r.status);
      return j;
    };
    const pl = q.match(/playlist[\/:]([A-Za-z0-9]{10,})/);
    const us = q.match(/user[\/:]([^\/?\s]+)/);
    let ids;
    if (pl) ids = [pl[1]];
    else if (us) ids = (await get('users/' + us[1] + '/playlists?limit=12')).items.filter(Boolean).map(p => p.id);
    else return res.status(400).json({ error: 'Paste a Spotify playlist link or a profile link' });

    const cds = (await Promise.all(ids.map(async id => {
      const p = await get('playlists/' + id);
      // Spotify has renamed these fields before, so accept both shapes
      const raw = (p.items && p.items.items) || (p.tracks && p.tracks.items) || [];
      const tracks = raw.map(e => e && (e.item || e.track))
        .filter(t => t && t.id && !t.is_local && t.type !== 'episode')
        .map(t => ({ id: t.id, title: t.name, artist: (t.artists || []).map(a => a.name).join(', '), dur: Math.round(t.duration_ms / 1000) }));
      return {
        id: p.id, name: p.name, count: tracks.length,
        cover: (p.images && p.images[0] && p.images[0].url) || null,
        dur: tracks.reduce((a, t) => a + t.dur, 0), tracks
      };
    }))).filter(c => c.count);
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json({ cds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
