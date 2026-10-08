// Spotify closed its API to sites like this (Feb 2026), so this uses Spotify's public
// oEmbed service instead. It needs NO keys and returns each playlist's name and cover.
module.exports = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const ids = [...new Set([...q.matchAll(/playlist[\/:]([A-Za-z0-9]{10,})/g)].map(m => m[1]))].slice(0, 12);
    if (!ids.length)
      return res.status(400).json({ error: 'Paste one or more Spotify playlist links (Share, then Copy link)' });

    const cds = (await Promise.all(ids.map(async id => {
      const r = await fetch('https://open.spotify.com/oembed?url=' +
        encodeURIComponent('https://open.spotify.com/playlist/' + id));
      if (!r.ok) return null;
      const j = await r.json();
      const name = j.title || 'Spotify playlist';
      return {
        id, name, cover: j.thumbnail_url || null, count: 0, dur: 0, embed: true,
        tracks: [{ id, uri: 'spotify:playlist:' + id, title: name, artist: 'SPOTIFY' }]
      };
    }))).filter(Boolean);

    if (!cds.length)
      return res.status(404).json({ error: 'Spotify did not find those playlists. Make sure they are public.' });
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json({ cds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
