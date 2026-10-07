// Reads PUBLIC YouTube playlists. Your API key stays here on the server.
const K = process.env.YOUTUBE_API_KEY;
const B = 'https://www.googleapis.com/youtube/v3/';

async function g(path, q) {
  const r = await fetch(B + path + '?' + new URLSearchParams({ ...q, key: K }));
  const j = await r.json();
  if (!r.ok) throw new Error((j.error && j.error.message) || 'YouTube error');
  return j;
}

// "Artist - Song" -> {artist, title}; otherwise use the channel name
function split(t, ch) {
  const m = t.split(/\s[-–—]\s/);
  return m.length > 1
    ? { artist: m[0].trim(), title: m.slice(1).join(' - ').trim() }
    : { artist: (ch || '').replace(/ - Topic$/, ''), title: t };
}

async function toCD(p) {
  const it = await g('playlistItems', { part: 'snippet', playlistId: p.id, maxResults: 50 });
  const tracks = it.items
    .filter(i => i.snippet.resourceId && i.snippet.resourceId.videoId &&
      !['Private video', 'Deleted video'].includes(i.snippet.title))
    .map(i => ({ id: i.snippet.resourceId.videoId, ...split(i.snippet.title, i.snippet.videoOwnerChannelTitle) }));
  // YouTube has no album cover, so cover is null -> the site draws a homemade CD
  return { id: p.id, name: p.snippet.title, cover: null, count: tracks.length, tracks };
}

module.exports = async (req, res) => {
  try {
    if (!K) return res.status(500).json({ error: 'Missing YOUTUBE_API_KEY in Vercel settings' });
    const q = (req.query.q || '').trim();
    let pls;
    const list = q.match(/[?&]list=([\w-]+)/) || q.match(/^(PL[\w-]{10,})$/);
    if (list) {
      pls = (await g('playlists', { part: 'snippet', id: list[1] })).items;
    } else {
      const h = q.match(/@[\w.\-]+/), c = q.match(/(UC[\w-]{22})/);
      const ch = c ? { id: c[1] } : h ? { forHandle: h[0] } : null;
      if (!ch) return res.status(400).json({ error: 'Paste a channel @handle, a channel link, or a playlist link' });
      const cj = await g('channels', { part: 'id', ...ch });
      const cid = cj.items && cj.items[0] && cj.items[0].id;
      if (!cid) return res.status(404).json({ error: 'Channel not found' });
      pls = (await g('playlists', { part: 'snippet', channelId: cid, maxResults: 12 })).items;
    }
    const cds = (await Promise.all(pls.map(toCD))).filter(c => c.count);
    res.setHeader('Cache-Control', 's-maxage=600');
    res.json({ cds });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
